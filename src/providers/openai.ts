import OpenAI from "openai";
import { APIError } from "openai";
import type {
  AgentTool,
  Message,
  Provider,
  ProviderStreamOptions,
  StreamChunk,
  ToolExecutionResult,
} from "./types";
import {
  usesOpenAIChatCompletions,
  type ModelPreset,
  type ReasoningEffort,
  type ReasoningSummary,
} from "../settings/types";
import type { ToolSettings } from "../settings/tool-settings";
import { DEFAULT_CONTEXT_POLICY } from "../context/policy";
import { runValidatedTool } from "./tool-exec";
import {
  loadRelaySalt,
  persistRelaySalt,
} from "../settings/relay-routing-cache";

const OPENAI_REQUEST_TIMEOUT_MS = 120_000;
const OPENAI_FIRST_EVENT_TIMEOUT_MS = 60_000;

// Self-hosted OpenAI relays (e.g. claude-relay-service) hash the
// prompt_cache_key / session_id to bind each request to a fixed backend
// account. When that account is unhealthy the relay returns HTTP 5xx with
// no SSE events. We auto-retry with a bumped salt suffix on the cache key —
// the new sha256 lands the request on a different backend bucket — and
// persist the salt that finally produced a response so subsequent requests
// for the same paper reuse the healthy backend (preserving long-prefix
// prompt cache hits). Retry only happens BEFORE any chunk has been yielded
// to the user; mid-stream failures fall through to the existing error path.
const MAX_RELAY_RETRY = 3;
const MAX_OUTPUT_CONTINUATIONS = 3;
const OUTPUT_COMPLETION_MARKER = "[ZAI_COMPLETE]";
const OUTPUT_CONTINUATION_PROMPT =
  "Continue the same answer exactly from where it was cut off. Do not repeat existing text. Complete every remaining part of the user's request. When and only when the answer is fully complete, end with [ZAI_COMPLETE] on its own line.";

// OpenAI Responses-API tool loop. Three load-bearing decisions, all aligned
// with OpenAI Codex's harness model:
//
// 1. INVARIANT: `store: false`. We do NOT rely on server-persisted response
//    item IDs. Every iteration re-sends the full conversation `input` —
//    user/assistant turns, function calls, function-call outputs.
//    GOTCHA: previously we tried to chain via `previous_response_id`; that
//    broke the moment a turn had `store:false` (no persisted ID).
//    REF: CLAUDE.md "Development Lessons", Codex `responses/streaming.rs`.
//
// 2. INVARIANT: `parallel_tool_calls: false`. Tools run strictly sequentially
//    so each tool's output is in the input list before the next call is
//    issued. WHY: lets later calls see earlier passages/ranges in the same
//    turn (the typical Codex "search → read range" pattern).
//
// 3. `maxToolIterations` is a SAFETY FUSE, not routing logic. We do not
//    branch behavior on iteration count; we only stop the loop when the
//    fuse blows. Default comes from policy (single source of truth).

interface ResponseUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
}

type ResponseEvent = {
  type?: string;
  delta?: string;
  item_id?: string;
  message?: string;
  item?: ResponseOutputItemLike;
  response?: {
    error?: { message?: string } | null;
    usage?: ResponseUsage;
    incomplete_details?: { reason?: string } | null;
  };
};

type ResponseOutputItemLike =
  | ResponseFunctionCallLike
  | ResponseMessageLike
  | ResponseReasoningLike
  | ResponseMcpCallLike
  | ResponseMcpListToolsLike
  | ResponseMcpApprovalRequestLike;

export interface ResponseFunctionCallLike {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

interface ResponseMessageLike {
  type: "message";
  role?: "assistant";
  content?: Array<{ type?: string; text?: string; refusal?: string }>;
}

interface ResponseReasoningLike {
  type: "reasoning";
  summary?: Array<{ text?: string }>;
}

interface ResponseMcpCallLike {
  type: "mcp_call";
  id: string;
  server_label: string;
  name: string;
  status?: "in_progress" | "completed" | "incomplete" | "calling" | "failed";
  error?: string | null;
}

interface ResponseMcpListToolsLike {
  type: "mcp_list_tools";
  id: string;
  server_label: string;
  tools?: Array<{ name?: string }>;
  error?: string | null;
}

interface ResponseMcpApprovalRequestLike {
  type: "mcp_approval_request";
  id: string;
  server_label: string;
  name: string;
}

interface FunctionCallOutputItem {
  type: "function_call_output";
  call_id: string;
  output: string;
}

export class OpenAIProvider implements Provider {
  async *stream(
    messages: Message[],
    systemPrompt: string,
    preset: ModelPreset,
    signal: AbortSignal,
    options: ProviderStreamOptions = {},
  ): AsyncIterable<StreamChunk> {
    const client = new OpenAI({
      apiKey: preset.apiKey,
      ...(preset.baseUrl ? { baseURL: preset.baseUrl } : {}),
      timeout: OPENAI_REQUEST_TIMEOUT_MS,
      maxRetries: 0,
      dangerouslyAllowBrowser: true,
    });

    if (usesOpenAIChatCompletions(preset)) {
      yield* this.streamChatCompletions(
        client,
        messages,
        systemPrompt,
        preset,
        signal,
        options,
      );
      return;
    }

    const hostedTools = openAIHostedToolSpecs(options.toolSettings);
    if (options.tools?.length || hostedTools.length) {
      yield* this.streamWithTools(
        client,
        messages,
        systemPrompt,
        preset,
        signal,
        options,
      );
      return;
    }

    // Same relay-routing retry pattern as streamWithTools. See comments on
    // MAX_RELAY_RETRY for the why; this branch is the no-tools shortcut.
    const useRelayRouting = shouldUseRelayRouting(preset, options);
    const routingItemKey = options.relayRoutingItemKey ?? null;
    let salt = useRelayRouting
      ? await loadRelaySalt(preset.id, preset.model, routingItemKey)
      : 0;

    let stream: AsyncIterable<unknown> | null = null;
    const retryLimit = useRelayRouting ? MAX_RELAY_RETRY : 0;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= retryLimit; attempt++) {
      try {
        stream = (await client.responses.create(
          {
            model: preset.model,
            instructions: systemPrompt,
            input: withFrontBlock(
              toOpenAIInput(messages) as Array<{
                role?: string;
                content?: unknown;
              }>,
              options.pinnedFullText,
            ) as never,
            ...maxOutputTokensParam(preset),
            ...promptCacheParams(preset, options, salt),
            ...responsesReasoningParam(preset),
            stream: true,
            store: false,
          },
          responsesRequestOptions(preset, options, signal, salt),
        )) as unknown as AsyncIterable<unknown>;
        break;
      } catch (err) {
        lastErr = err;
        if (
          attempt < retryLimit &&
          !signal.aborted &&
          isRetryableRelayError(err)
        ) {
          salt += 1;
          continue;
        }
        break;
      }
    }
    if (!stream) {
      const finalMessage =
        useRelayRouting && isRetryableRelayError(lastErr)
          ? `上游中继路由 ${retryLimit + 1} 次均返回 5xx（${errMsg(lastErr)}）。可能后端账号全部异常，建议切换 preset 或稍后重试。`
          : errMsg(lastErr);
      yield { type: "error", message: finalMessage };
      return;
    }

    let streamHadError = false;
    try {
      for await (const event of streamEventsWithFirstEventTimeout(
        stream,
        signal,
      )) {
        const chunk = responseEventToChunk(event as ResponseEvent);
        if (chunk) {
          if (chunk.type === "error") streamHadError = true;
          yield chunk;
        }
      }
    } catch (err) {
      yield { type: "error", message: errMsg(err) };
      return;
    }

    if (useRelayRouting && !streamHadError) {
      persistRelaySalt(preset.id, preset.model, routingItemKey, salt).catch(
        () => undefined,
      );
    }
  }

  private async *streamChatCompletions(
    client: OpenAI,
    messages: Message[],
    systemPrompt: string,
    preset: ModelPreset,
    signal: AbortSignal,
    options: ProviderStreamOptions = {},
  ): AsyncIterable<StreamChunk> {
    const tools = options.tools ?? [];
    const toolMap = new Map(tools.map((t) => [t.name, t]));
    const chatTools = tools.length
      ? tools.map(chatCompletionToolSpec)
      : undefined;
    const maxIterations =
      options.maxToolIterations ?? DEFAULT_CONTEXT_POLICY.maxToolIterations;

    // Accumulate the full conversation including tool turns across iterations.
    const chatMessages: ChatMessage[] = toChatMessages(messages, systemPrompt);
    let frontBlock: string | undefined = options.pinnedFullText;

    for (let iteration = 0; iteration <= maxIterations; iteration++) {
      let stream: AsyncIterable<unknown>;
      try {
        stream = (await client.chat.completions.create(
          {
            model: preset.model,
            messages: withFrontBlock(
              chatMessages as Array<{ role?: string; content?: unknown }>,
              frontBlock,
            ) as ChatMessage[],
            max_tokens: preset.maxTokens,
            stream: true,
            stream_options: { include_usage: true },
            ...promptCacheParams(preset, options),
            ...(chatTools
              ? {
                  tools: chatTools,
                  tool_choice: "auto",
                  parallel_tool_calls: false,
                }
              : {}),
            ...chatCompletionReasoningParam(preset),
          } as never,
          responsesRequestOptions(preset, options, signal),
        )) as unknown as AsyncIterable<unknown>;
      } catch (err) {
        yield { type: "error", message: errMsg(err) };
        return;
      }

      // Accumulate streaming deltas into a complete assistant message.
      let textContent = "";
      // DeepSeek (and some relays) stream reasoning_content separately. It must
      // be passed back verbatim in the assistant message for the next turn or
      // the API returns 400 "reasoning_content must be passed back".
      let reasoningContent = "";
      const toolCallsAcc: Map<
        number,
        { id: string; name: string; arguments: string }
      > = new Map();
      let finishReason: string | null = null;
      let usage: ChatCompletionUsage | undefined;

      try {
        for await (const event of stream) {
          const e = event as ChatCompletionEvent;
          const choice = e.choices?.[0];
          if (choice) {
            const delta = choice.delta;
            if (delta?.reasoning_content) {
              reasoningContent += delta.reasoning_content;
              yield { type: "thinking_delta", text: delta.reasoning_content };
            }
            if (delta?.content) {
              textContent += delta.content;
              yield { type: "text_delta", text: delta.content };
            }
            // Accumulate tool call fragments by index.
            // GOTCHA: initialize name/arguments to '' then only use +=.
            // Initializing from the first delta AND then doing += doubles the name.
            for (const tc of delta?.tool_calls ?? []) {
              const idx = tc.index ?? 0;
              if (!toolCallsAcc.has(idx)) {
                toolCallsAcc.set(idx, {
                  id: tc.id ?? "",
                  name: "",
                  arguments: "",
                });
              }
              const acc = toolCallsAcc.get(idx)!;
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name += tc.function.name;
              if (tc.function?.arguments)
                acc.arguments += tc.function.arguments;
            }
            if (choice.finish_reason) finishReason = choice.finish_reason;
          }
          if (e.usage) usage = e.usage;
        }
      } catch (err) {
        yield { type: "error", message: errMsg(err) };
        return;
      }

      if (usage) yield chatUsageChunk(usage);

      // No tool calls — natural exit.
      if (finishReason !== "tool_calls" || toolCallsAcc.size === 0) {
        return;
      }

      // Build the assistant message with tool_calls and append to history.
      const toolCallItems = Array.from(toolCallsAcc.entries())
        .sort(([a], [b]) => a - b)
        .map(([, tc]) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        }));

      chatMessages.push({
        role: "assistant",
        content: textContent || null,
        ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
        tool_calls: toolCallItems,
      } as ChatMessage);

      // Execute each tool and append role:tool messages.
      for (const tc of toolCallItems) {
        yield {
          type: "tool_call",
          name: tc.function.name,
          status: "started",
          summary: `调用 Zotero 工具: ${tc.function.name}`,
        };
        const callLike: ResponseFunctionCallLike = {
          type: "function_call",
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        };
        const result = await executeToolCall(
          callLike,
          toolMap,
          signal,
          options.permissionMode ?? "default",
        );
        if (result.result.frontBlock) frontBlock = result.result.frontBlock;
        yield {
          type: "tool_call",
          name: tc.function.name,
          status: result.status,
          summary: result.result.summary,
          context: result.result.context,
        };
        chatMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result.result.output,
        } as ChatMessage);
      }
    }

    yield {
      type: "error",
      message:
        "Tool loop stopped because the model exceeded the local tool iteration limit.",
    };
  }

  private async *streamWithTools(
    client: OpenAI,
    messages: Message[],
    systemPrompt: string,
    preset: ModelPreset,
    signal: AbortSignal,
    options: ProviderStreamOptions,
  ): AsyncIterable<StreamChunk> {
    const tools = options.tools ?? [];
    const openAITools = [
      ...tools.map(openAIToolSpec),
      ...openAIHostedToolSpecs(options.toolSettings),
    ];
    const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
    // `input` accumulates across iterations: original messages, then each
    // function_call we replay, then each function_call_output we synthesize
    // from local tool execution. The model sees the same shape every turn.
    const input: unknown[] = toOpenAIInput(messages);
    let frontBlock: string | undefined = options.pinnedFullText;
    const maxIterations =
      options.maxToolIterations ?? DEFAULT_CONTEXT_POLICY.maxToolIterations;

    // Relay-routing salt state: load any previously-known healthy salt for
    // this (preset, model, itemKey) tuple. Retry is allowed ONLY on the
    // first iteration before any content chunk has been emitted; later
    // iterations or mid-stream failures fall through to the existing
    // error path so the user does not see partial answers wiped out.
    const useRelayRouting = shouldUseRelayRouting(preset, options);
    const routingItemKey = options.relayRoutingItemKey ?? null;
    let salt = useRelayRouting
      ? await loadRelaySalt(preset.id, preset.model, routingItemKey)
      : 0;
    let saltPersisted = false;
    let outputContinuations = 0;

    for (let iteration = 0; iteration <= maxIterations; iteration++) {
      let stream: AsyncIterable<unknown> | null = null;
      const retryLimit =
        iteration === 0 && useRelayRouting ? MAX_RELAY_RETRY : 0;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt <= retryLimit; attempt++) {
        try {
          stream = (await client.responses.create(
            {
              model: preset.model,
              instructions: systemPrompt,
              input: withFrontBlock(
                input as Array<{ role?: string; content?: unknown }>,
                frontBlock,
              ),
              ...maxOutputTokensParam(preset),
              ...promptCacheParams(preset, options, salt),
              ...responsesReasoningParam(preset),
              tools: openAITools,
              tool_choice: "auto",
              parallel_tool_calls: false,
              stream: true,
              store: false,
            } as never,
            responsesRequestOptions(preset, options, signal, salt),
          )) as unknown as AsyncIterable<unknown>;
          break;
        } catch (err) {
          lastErr = err;
          if (
            attempt < retryLimit &&
            !signal.aborted &&
            isRetryableRelayError(err)
          ) {
            salt += 1;
            continue;
          }
          break;
        }
      }
      if (!stream) {
        const finalMessage =
          useRelayRouting && isRetryableRelayError(lastErr)
            ? `上游中继路由 ${retryLimit + 1} 次均返回 5xx（${errMsg(lastErr)}）。可能后端账号全部异常，建议切换 preset 或稍后重试。`
            : errMsg(lastErr);
        yield { type: "error", message: finalMessage };
        return;
      }

      const calls: ResponseFunctionCallLike[] = [];
      let usage: ResponseUsage | undefined;
      let failed = false;
      let terminalEvent = false;
      let incompleteReason = "";
      let iterationText = "";
      const expectsCompletionMarker = outputContinuations > 0;
      let markerTail = "";

      try {
        for await (const event of streamEventsWithFirstEventTimeout(
          stream,
          signal,
        )) {
          const e = event as ResponseEvent;
          switch (e.type) {
            case "response.created":
              yield {
                type: "status",
                message: "OpenAI 已接收请求，等待模型开始处理",
              };
              break;
            case "response.in_progress":
              yield {
                type: "status",
                message: hostedToolsStatus(options.toolSettings),
              };
              break;
            case "response.output_text.delta":
              if (e.delta) {
                iterationText += e.delta;
                if (expectsCompletionMarker) {
                  markerTail += e.delta;
                  const keep = OUTPUT_COMPLETION_MARKER.length + 16;
                  if (markerTail.length > keep) {
                    const visible = markerTail.slice(0, -keep);
                    markerTail = markerTail.slice(-keep);
                    yield { type: "text_delta", text: visible };
                  }
                } else {
                  yield { type: "text_delta", text: e.delta };
                }
              }
              break;
            case "response.reasoning_text.delta":
            case "response.reasoning_summary_text.delta":
              if (e.delta) yield { type: "thinking_delta", text: e.delta };
              break;
            case "response.output_item.done":
              if (e.item) {
                if (isFunctionCall(e.item)) calls.push(e.item);
                const hostedChunk = hostedOutputItemToChunk(e.item);
                if (hostedChunk) yield hostedChunk;
              }
              break;
            case "response.web_search_call.in_progress":
              yield {
                type: "tool_call",
                name: "web_search",
                status: "started",
                summary: "正在使用内置联网搜索",
              };
              break;
            case "response.web_search_call.searching":
              break;
            case "response.web_search_call.completed":
              yield {
                type: "tool_call",
                name: "web_search",
                status: "completed",
                summary: "内置联网搜索完成",
              };
              break;
            case "response.completed":
              terminalEvent = true;
              usage = e.response?.usage;
              break;
            case "response.incomplete":
              terminalEvent = true;
              usage = e.response?.usage;
              incompleteReason =
                e.response?.incomplete_details?.reason || "unknown";
              break;
            case "response.failed":
              terminalEvent = true;
              yield {
                type: "error",
                message: e.response?.error?.message || "OpenAI response failed",
              };
              failed = true;
              break;
            case "error":
              terminalEvent = true;
              yield {
                type: "error",
                message: e.message || "OpenAI stream error",
              };
              failed = true;
              break;
            default:
              break;
          }
          if (failed) break;
        }
      } catch (err) {
        yield { type: "error", message: errMsg(err) };
        return;
      }

      let completedByMarker = false;
      if (expectsCompletionMarker) {
        const markerAt = markerTail.lastIndexOf(OUTPUT_COMPLETION_MARKER);
        if (
          markerAt >= 0 &&
          !markerTail.slice(markerAt + OUTPUT_COMPLETION_MARKER.length).trim()
        ) {
          const visible = markerTail
            .slice(0, markerAt)
            .replace(/[ \t]*\n?[ \t]*$/, "");
          if (visible) yield { type: "text_delta", text: visible };
          completedByMarker = true;
        } else if (markerTail) {
          yield { type: "text_delta", text: markerTail };
        }
      }

      if (failed) return;

      // Some compatible relays omit response.completed after a function call.
      // A fully assembled call can still run safely. Text output is different:
      // output_item.done may precede an abruptly closed stream, so it must go
      // through the continuation path below unless a terminal event arrived.
      if (!terminalEvent && calls.length > 0) terminalEvent = true;

      // Persist the salt that just produced a successful first-stream-pass.
      // Subsequent chats for the same paper start from this salt, keeping
      // them pinned to the same (now-known-healthy) relay backend account
      // so long-prefix prompt cache hits accumulate. Fire-and-forget; the
      // write is queued behind any in-flight relay-routing writes.
      if (useRelayRouting && !saltPersisted && iteration === 0) {
        saltPersisted = true;
        // Fire-and-forget: the JSON write is best-effort. Any failure (disk
        // full, permission) gets swallowed so an unhandled rejection cannot
        // leak into Zotero's event loop. Next chat for this paper would
        // simply rediscover the salt from scratch.
        persistRelaySalt(preset.id, preset.model, routingItemKey, salt).catch(
          () => undefined,
        );
      }

      if (usage) yield usageChunk(usage);

      if (completedByMarker) return;

      const compatibleMissingUsage =
        !isOfficialOpenAIEndpoint(preset) && terminalEvent && !usage;
      const continuationReason =
        incompleteReason === "max_output_tokens"
          ? "回答达到单次输出上限"
          : !terminalEvent
            ? "回答流提前结束"
            : expectsCompletionMarker
              ? "回答尚未覆盖全部要求"
              : compatibleMissingUsage
                ? "回答结束状态缺少用量"
                : "";
      if (
        continuationReason &&
        calls.length === 0 &&
        iterationText &&
        (!incompleteReason || incompleteReason === "max_output_tokens") &&
        outputContinuations < MAX_OUTPUT_CONTINUATIONS
      ) {
        outputContinuations += 1;
        input.push(
          { role: "assistant", content: iterationText },
          { role: "user", content: OUTPUT_CONTINUATION_PROMPT },
        );
        yield {
          type: "status",
          message: `${continuationReason}，正在自动续写（${outputContinuations}/${MAX_OUTPUT_CONTINUATIONS}）`,
        };
        continue;
      }

      if (incompleteReason) {
        yield {
          type: "error",
          message:
            incompleteReason === "max_output_tokens"
              ? "回答再次达到最大输出长度，已保留当前内容；请发送“继续”完成剩余部分。"
              : `OpenAI response incomplete: ${incompleteReason}`,
        };
        return;
      }

      if (!terminalEvent) {
        yield {
          type: "error",
          message: "回答多次续写后仍未收到完成标记，请发送“继续”完成剩余部分。",
        };
        return;
      }

      if (expectsCompletionMarker) {
        yield {
          type: "error",
          message: "回答多次续写后仍未覆盖全部要求，请发送“继续”完成剩余部分。",
        };
        return;
      }

      // Natural exit: model produced text-only output. No tool calls ⇒ done.
      if (calls.length === 0) {
        return;
      }

      // Replay function_call items into `input` BEFORE running them. The
      // Responses API requires the call to appear in the request that also
      // contains its function_call_output, otherwise the next turn errors.
      input.push(...calls.map(functionCallReplayItem));

      for (const call of calls) {
        yield {
          type: "tool_call",
          name: call.name,
          status: "started",
          summary: `调用 Zotero 工具: ${call.name}`,
        };
        const result = await executeToolCall(
          call,
          toolMap,
          signal,
          options.permissionMode ?? "default",
        );
        if (result.result.frontBlock) frontBlock = result.result.frontBlock;
        yield {
          type: "tool_call",
          name: call.name,
          status: result.status,
          summary: result.result.summary,
          context: result.result.context,
        };
        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: result.result.output,
        } satisfies FunctionCallOutputItem);

        // OpenAI's `function_call_output` is text only, so a tool that
        // wants the model to actually SEE images (e.g. arxiv_get_figure)
        // returns them on `result.images`. Deliver each one as an
        // `input_image` block on a synthetic follow-up user turn — the
        // model then handles it like any user-attached image.
        if (result.result.images?.length) {
          yield {
            type: "tool_images",
            images: result.result.images,
          };
          input.push({
            role: "user",
            content: [
              {
                type: "input_text",
                text: `[Attached by tool ${call.name}]`,
              },
              ...result.result.images.map((image) => ({
                type: "input_image" as const,
                image_url: image.dataUrl,
              })),
            ],
          } as never);
        }
      }
    }

    // Safety-fuse blew. INVARIANT: never silently truncate; surface as error
    // so the user can see the loop bound was the limiter, not the model.
    yield {
      type: "error",
      message:
        "Tool loop stopped because the model exceeded the local tool iteration limit.",
    };
  }
}

export function functionCallReplayItem(
  call: ResponseFunctionCallLike,
): ResponseFunctionCallLike {
  return {
    type: "function_call",
    call_id: call.call_id,
    name: call.name,
    arguments: call.arguments,
  };
}

async function executeToolCall(
  call: ResponseFunctionCallLike,
  toolMap: Map<string, AgentTool>,
  signal: AbortSignal,
  permissionMode: "default" | "yolo",
): Promise<{ status: "completed" | "error"; result: ToolExecutionResult }> {
  // The abort check / unknown-tool / requiresApproval gate / execution live in
  // the shared runValidatedTool (CLAUDE.md non-negotiable "No hidden Zotero
  // writes"). Here we only translate the Responses-API function_call into the
  // parsed args it expects; a malformed JSON arg string is the one error shape
  // unique to this provider.
  let args: unknown;
  try {
    args = call.arguments ? JSON.parse(call.arguments) : {};
  } catch {
    return {
      status: "error",
      result: {
        output: `Invalid JSON arguments for local tool: ${call.name}`,
        summary: `工具参数 JSON 无效: ${call.name}`,
      },
    };
  }

  return runValidatedTool(toolMap, call.name, args, signal, permissionMode);
}

function openAIToolSpec(tool: AgentTool): Record<string, unknown> {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: false,
  };
}

export function openAIHostedToolSpecs(
  settings: ToolSettings | undefined,
): Record<string, unknown>[] {
  if (!settings) return [];
  const specs: Record<string, unknown>[] = [];
  if (settings.webSearchMode !== "disabled") {
    specs.push({
      type: "web_search",
      search_context_size:
        settings.webSearchMode === "live" ? "high" : "medium",
    });
  }
  for (const server of settings.mcpServers ?? []) {
    if (!server.enabled || !server.serverUrl) continue;
    specs.push({
      type: "mcp",
      server_label: server.serverLabel,
      server_url: server.serverUrl,
      ...(server.allowedTools.length
        ? { allowed_tools: server.allowedTools }
        : {}),
      require_approval: server.requireApproval,
      server_description: `User-configured MCP server "${server.serverLabel}". Let the model decide when to call its allowed tools.`,
    });
  }
  const arxiv = settings.arxivMcp;
  if (arxiv.enabled && arxiv.serverUrl) {
    specs.push({
      type: "mcp",
      server_label: arxiv.serverLabel,
      server_url: arxiv.serverUrl,
      allowed_tools: arxiv.allowedTools,
      require_approval: arxiv.requireApproval,
      server_description:
        "Configurable arXiv MCP search server. Let the model decide when to search or fetch paper metadata.",
    });
  }
  return specs;
}

function hostedOutputItemToChunk(
  item: ResponseOutputItemLike,
): StreamChunk | null {
  if (isMcpCall(item)) {
    return {
      type: "tool_call",
      name: `mcp:${item.server_label}/${item.name}`,
      status: item.error || item.status === "failed" ? "error" : "completed",
      summary: item.error
        ? `MCP 调用失败: ${item.error}`
        : `MCP 调用完成: ${item.server_label}/${item.name}`,
    };
  }
  if (isMcpListTools(item)) {
    return {
      type: "tool_call",
      name: `mcp:${item.server_label}/list_tools`,
      status: item.error ? "error" : "completed",
      summary: item.error
        ? `MCP 工具列表获取失败: ${item.error}`
        : `MCP 工具列表已获取: ${item.tools?.length ?? 0} 个工具`,
    };
  }
  if (isMcpApprovalRequest(item)) {
    return {
      type: "tool_call",
      name: `mcp:${item.server_label}/${item.name}`,
      status: "error",
      summary:
        "MCP 请求人工审批；当前插件暂不支持审批回传，请在设置中改为 never 后重试。",
    };
  }
  return null;
}

// Prepends the paper full text as a front block immediately after the system
// prompt and before conversation history. Used by both OpenAI tool loops.
// Returns the SAME array reference when no front block is set (no behavior
// change). The Responses `input` has no leading system item (the system
// prompt is the separate `instructions` field), so for it the block goes at
// index 0; Chat Completions keeps the system message at index 0, so the block
// goes at index 1.
export function withFrontBlock(
  items: Array<{ role?: string; content?: unknown }>,
  frontBlock: string | undefined,
): Array<{ role?: string; content?: unknown }> {
  if (!frontBlock) return items;
  const block = { role: "user", content: `[Paper full text]\n${frontBlock}` };
  if (items[0]?.role === "system") {
    return [items[0], block, ...items.slice(1)];
  }
  return [block, ...items];
}

export function toOpenAIInput(messages: Message[]): unknown[] {
  const input: unknown[] = [];
  for (const message of messages) {
    if (!message.images?.length) {
      input.push({ role: message.role, content: message.content });
      continue;
    }

    if (message.role === "user") {
      input.push({
        role: "user",
        content: responsesImageContent(message.content, message.images),
      });
      continue;
    }

    // OpenAI Responses only allows `output_text`/`refusal` content blocks on
    // assistant messages. Tool figures are stored on assistant bubbles for UI,
    // so replay them as a synthetic user image context before the answer.
    input.push({
      role: "user",
      content: responsesImageContent(
        "[Images attached to the following assistant message for visual context.]",
        message.images,
      ),
    });
    input.push({ role: "assistant", content: message.content });
  }
  return input;
}

function responsesImageContent(
  text: string | undefined,
  images: NonNullable<Message["images"]>,
): Array<Record<string, string>> {
  const content: Array<Record<string, string>> = [];
  if (text) {
    content.push({
      type: "input_text",
      text,
    });
  }
  images.forEach((image, index) => {
    const label = image.marker ?? `[Image #${index + 1}]`;
    content.push({
      type: "input_text",
      text: `<image name=${label}>`,
    });
    content.push({
      type: "input_image",
      image_url: image.dataUrl,
      detail: "high",
    });
    content.push({
      type: "input_text",
      text: "</image>",
    });
  });
  return content;
}

function isFunctionCall(
  item: ResponseOutputItemLike,
): item is ResponseFunctionCallLike {
  return (
    item.type === "function_call" &&
    typeof item.call_id === "string" &&
    typeof item.name === "string" &&
    typeof item.arguments === "string"
  );
}

function isMcpCall(item: ResponseOutputItemLike): item is ResponseMcpCallLike {
  return (
    item.type === "mcp_call" &&
    typeof item.server_label === "string" &&
    typeof item.name === "string"
  );
}

function isMcpListTools(
  item: ResponseOutputItemLike,
): item is ResponseMcpListToolsLike {
  return (
    item.type === "mcp_list_tools" && typeof item.server_label === "string"
  );
}

function isMcpApprovalRequest(
  item: ResponseOutputItemLike,
): item is ResponseMcpApprovalRequestLike {
  return (
    item.type === "mcp_approval_request" &&
    typeof item.server_label === "string" &&
    typeof item.name === "string"
  );
}

function reasoningOptions(preset: ModelPreset): {
  effort: ReasoningEffort;
  summary?: Exclude<ReasoningSummary, "none">;
} {
  // GOTCHA: 'none' must omit the `summary` key entirely — the API rejects
  // an explicit `summary: 'none'` value. Default to 'concise' so the
  // sidebar's collapsible thinking block has something to render.
  const summary = preset.extras?.reasoningSummary ?? "concise";
  return {
    effort: preset.extras?.reasoningEffort ?? "xhigh",
    ...(summary === "none" ? {} : { summary }),
  };
}

function responsesReasoningParam(preset: ModelPreset): {
  reasoning?: ReturnType<typeof reasoningOptions>;
} {
  if (!shouldSendResponsesReasoning(preset)) return {};
  return { reasoning: reasoningOptions(preset) };
}

function shouldSendResponsesReasoning(preset: ModelPreset): boolean {
  // Never silently weaken the user's selected reasoning effort. The only
  // exception is an explicit cache-priority preset option for non-official
  // OpenAI-compatible relays where this optional field breaks long-prefix
  // caching.
  if (!isOfficialOpenAIEndpoint(preset)) {
    return preset.extras?.omitResponsesReasoningForCache !== true;
  }
  return true;
}

function maxOutputTokensParam(preset: ModelPreset): {
  max_output_tokens?: number;
} {
  return preset.extras?.omitMaxOutputTokens === true
    ? {}
    : { max_output_tokens: preset.maxTokens };
}

function promptCacheParams(
  preset: ModelPreset,
  options: ProviderStreamOptions,
  salt: number = 0,
): { prompt_cache_key?: string; prompt_cache_retention?: "24h" } {
  if (!shouldSendPromptCacheKey(preset)) return {};
  const key = saltedCacheKey(
    stablePromptCacheKey(options.promptCacheKey),
    salt,
  );
  if (!key) return {};
  return {
    prompt_cache_key: key,
    ...(isOfficialOpenAIEndpoint(preset) &&
    supportsExtendedPromptCache(preset.model)
      ? { prompt_cache_retention: "24h" as const }
      : {}),
  };
}

function responsesRequestOptions(
  preset: ModelPreset,
  options: ProviderStreamOptions,
  signal: AbortSignal,
  salt: number = 0,
): { signal: AbortSignal; headers?: Record<string, string> } {
  const key = shouldSendRelaySessionId(preset)
    ? saltedCacheKey(stablePromptCacheKey(options.promptCacheKey), salt)
    : "";
  return key ? { signal, headers: { session_id: key } } : { signal };
}

// Append `:s<salt>` to a base cache key when salt > 0. We do this AFTER
// stablePromptCacheKey's 64-char slice — the salt itself is short (max
// ":s9999" = 6 chars) so the total stays within any reasonable relay limit
// while keeping the base key recognizable in logs.
function saltedCacheKey(baseKey: string, salt: number): string {
  if (!baseKey) return baseKey;
  if (salt <= 0) return baseKey;
  return `${baseKey}:s${salt}`;
}

// Whether this preset + request combo participates in relay-routing retry.
// Gate: the request must already be using prompt_cache_key + session_id
// (i.e. a non-official OpenAI-compatible relay with caching enabled). For
// official api.openai.com or relays that opted out of caching, retry would
// not help (their failures aren't sticky-session bound).
function shouldUseRelayRouting(
  preset: ModelPreset,
  options: ProviderStreamOptions,
): boolean {
  return shouldSendRelaySessionId(preset) && !!options.promptCacheKey;
}

// Recognize a 5xx server error from the OpenAI SDK that occurred BEFORE
// any stream content was produced. The relay returns these synchronously
// (no SSE events) when its bound backend account is dead, so retrying with
// a different cache_key salt routes to a fresh account.
function isRetryableRelayError(err: unknown): boolean {
  if (!(err instanceof APIError)) return false;
  const status = err.status;
  return typeof status === "number" && status >= 500 && status < 600;
}

function shouldSendPromptCacheKey(preset: ModelPreset): boolean {
  return isOfficialOpenAIEndpoint(preset) || shouldSendRelayPromptCache(preset);
}

function shouldSendRelaySessionId(preset: ModelPreset): boolean {
  return shouldSendRelayPromptCache(preset);
}

function isOfficialOpenAIEndpoint(preset: ModelPreset): boolean {
  const baseUrl = preset.baseUrl.trim();
  if (!baseUrl) return true;
  try {
    return new URL(baseUrl).hostname === "api.openai.com";
  } catch {
    return false;
  }
}

function shouldSendRelayPromptCache(preset: ModelPreset): boolean {
  return (
    !isOfficialOpenAIEndpoint(preset) &&
    preset.extras?.enableRelayPromptCache !== false
  );
}

function supportsExtendedPromptCache(model: string): boolean {
  return /^(gpt-5|gpt-4\.1)(?:[.-]|$)/i.test(model.trim());
}

function stablePromptCacheKey(value: string | undefined): string {
  const cleaned = (value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9:_-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 64);
  return cleaned || "zai:openai";
}

function responseEventToChunk(event: ResponseEvent): StreamChunk | null {
  switch (event.type) {
    case "response.created":
      return {
        type: "status",
        message: "OpenAI 已接收请求，等待模型开始处理",
      };
    case "response.in_progress":
      return { type: "status", message: "模型正在处理请求" };
    case "response.output_text.delta":
      return event.delta ? { type: "text_delta", text: event.delta } : null;
    case "response.reasoning_text.delta":
    case "response.reasoning_summary_text.delta":
      return event.delta ? { type: "thinking_delta", text: event.delta } : null;
    case "response.completed": {
      const usage = event.response?.usage;
      return usage ? usageChunk(usage) : null;
    }
    case "response.failed":
      return {
        type: "error",
        message: event.response?.error?.message || "OpenAI response failed",
      };
    case "error":
      return { type: "error", message: event.message || "OpenAI stream error" };
    default:
      return null;
  }
}

function usageChunk(usage: ResponseUsage): StreamChunk {
  return {
    type: "usage",
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    ...(typeof usage.input_tokens_details?.cached_tokens === "number"
      ? { cacheRead: usage.input_tokens_details.cached_tokens }
      : {}),
  };
}

// Chat Completions wire types. Kept minimal — only fields we read or write.
type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | Array<unknown> }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ChatCompletionEvent {
  choices?: Array<{
    delta?: {
      content?: string | null;
      // DeepSeek-R1 streams chain-of-thought here; must be replayed in the
      // next assistant message or the API returns 400.
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: ChatCompletionUsage;
}

interface ChatCompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

function toChatMessages(
  messages: Message[],
  systemPrompt: string,
): ChatMessage[] {
  const result: ChatMessage[] = [];
  if (systemPrompt) result.push({ role: "system", content: systemPrompt });
  for (const msg of messages) {
    const text = Array.isArray(msg.content)
      ? msg.content
          .filter((b) => b.type === "text")
          .map((b) => (b as { type: "text"; text: string }).text)
          .join("\n")
      : msg.content;
    if (msg.images?.length) {
      if (msg.role === "user") {
        result.push({
          role: "user",
          content: chatImageContent(text, msg.images),
        });
      } else {
        result.push({
          role: "user",
          content: chatImageContent(
            "[Images attached to the following assistant message for visual context.]",
            msg.images,
          ),
        });
        result.push({ role: "assistant", content: text });
      }
    } else {
      result.push({ role: msg.role as "user" | "assistant", content: text });
    }
  }
  return result;
}

function chatImageContent(
  text: string | undefined,
  images: NonNullable<Message["images"]>,
): Array<unknown> {
  const parts: Array<unknown> = [];
  if (text) parts.push({ type: "text", text });
  for (const img of images) {
    parts.push({
      type: "image_url",
      image_url: { url: img.dataUrl, detail: "high" },
    });
  }
  return parts;
}

function chatCompletionToolSpec(tool: AgentTool): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function chatCompletionReasoningParam(
  preset: ModelPreset,
): Record<string, unknown> {
  const effort = preset.extras?.reasoningEffort;
  if (!effort || effort === "none") return {};
  // Chat Completions uses top-level reasoning_effort (not nested reasoning.effort).
  return { reasoning_effort: effort === "xhigh" ? "high" : effort };
}

function chatUsageChunk(usage: ChatCompletionUsage): StreamChunk {
  const deepSeekInput =
    (usage.prompt_cache_hit_tokens ?? 0) +
    (usage.prompt_cache_miss_tokens ?? 0);
  const cacheRead =
    typeof usage.prompt_cache_hit_tokens === "number"
      ? usage.prompt_cache_hit_tokens
      : typeof usage.prompt_tokens_details?.cached_tokens === "number"
        ? usage.prompt_tokens_details.cached_tokens
        : undefined;
  return {
    type: "usage",
    input: usage.prompt_tokens ?? deepSeekInput,
    output: usage.completion_tokens ?? 0,
    ...(cacheRead != null ? { cacheRead } : {}),
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function* streamEventsWithFirstEventTimeout<T>(
  stream: AsyncIterable<T>,
  signal: AbortSignal,
): AsyncIterable<T> {
  const iterator = stream[Symbol.asyncIterator]();
  let first = true;
  try {
    while (true) {
      const next = first
        ? await nextWithFirstEventTimeout(iterator, signal)
        : await iterator.next();
      first = false;
      if (next.done) return;
      yield next.value;
    }
  } finally {
    await iterator.return?.();
  }
}

function nextWithFirstEventTimeout<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal,
): Promise<IteratorResult<T>> {
  if (signal.aborted) return Promise.reject(new Error("Request was aborted."));
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
    };
    const settleResolve = (
      value: IteratorResult<T> | PromiseLike<IteratorResult<T>>,
    ) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const settleReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const onAbort = () => {
      settleReject(new Error("Request was aborted."));
    };
    const timeout = setTimeout(() => {
      settleReject(
        new Error(
          `OpenAI 流式响应在 ${Math.round(
            OPENAI_FIRST_EVENT_TIMEOUT_MS / 1000,
          )} 秒内没有返回任何事件。通常是当前 Base URL 不支持 hosted web_search/MCP 流式事件，或上游联网检索被卡住。`,
        ),
      );
    }, OPENAI_FIRST_EVENT_TIMEOUT_MS);
    signal.addEventListener("abort", onAbort, { once: true });
    iterator.next().then(
      (value) => settleResolve(value),
      (err) => settleReject(err),
    );
  });
}

function hostedToolsStatus(settings: ToolSettings | undefined): string {
  if (!settings) return "模型正在处理请求";
  if (settings.webSearchMode === "live") {
    return "模型正在处理请求；Live 联网会搜索网页，但不保证下载/解析 PDF 全文";
  }
  if (settings.webSearchMode === "cached") {
    return "模型正在处理请求；联网搜索已启用，但不保证下载/解析 PDF 全文";
  }
  if (
    settings.mcpServers?.some((server) => server.enabled && server.serverUrl)
  ) {
    return "模型正在处理请求；MCP 工具已作为可用工具提供";
  }
  if (settings.arxivMcp.enabled && settings.arxivMcp.serverUrl) {
    return "模型正在处理请求；arXiv MCP 已作为可用工具提供";
  }
  return "模型正在处理请求";
}
