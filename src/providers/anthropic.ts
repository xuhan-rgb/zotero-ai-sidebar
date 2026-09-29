import { effectiveReasoningEffort, collapseReasoningForPreset } from '../settings/reasoning';
import Anthropic from '@anthropic-ai/sdk';
import type {
  AgentTool,
  Provider,
  Message,
  ProviderStreamOptions,
  StreamChunk,
} from './types';
import {
  findClaudeDescriptor,
  type AnthropicVendor,
  type ModelPreset,
  type ReasoningEffort,
  type TranslateThinking,
} from '../settings/types';
import { DEFAULT_CONTEXT_POLICY } from '../context/policy';
import { runValidatedTool, type ToolRunOutcome } from './tool-exec';

// Builds the Anthropic `system` array. The system prompt is block 1
// (ephemeral cache). When a front block (paper full text) is present it
// becomes block 2 with its own 1h-TTL cache breakpoint — the feature exists
// to survive the user's reading time between turns.
export function toAnthropicSystem(
  systemPrompt: string,
  pinnedFullText: string | undefined,
): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [
    { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
  ];
  if (pinnedFullText) {
    blocks.push({
      type: 'text',
      text: `[Paper full text]\n${pinnedFullText}`,
      cache_control: { type: 'ephemeral', ttl: '1h' },
    });
  }
  return blocks;
}

// Anthropic Messages-streaming adapter.
// The Codex-style agent tool loop runs here when `options.tools` is non-empty
// (see streamWithTools, mirroring providers/openai.ts); otherwise the original
// single-shot streaming path handles plain chat / translate / connectivity.
// NOTE: hosted tools (`options.toolSettings` web search / MCP) are still
// OpenAI-only — only the local Zotero tools cross to Anthropic for now.
export class AnthropicProvider implements Provider {
  async *stream(
    messages: Message[],
    systemPrompt: string,
    preset: ModelPreset,
    signal: AbortSignal,
    options: ProviderStreamOptions = {},
  ): AsyncIterable<StreamChunk> {
    const client = new Anthropic({
      apiKey: preset.apiKey,
      ...(preset.baseUrl ? { baseURL: preset.baseUrl } : {}),
      dangerouslyAllowBrowser: true,
    });

    if (options.tools?.length) {
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

    const baseRequest = {
      model: preset.model,
      max_tokens: preset.maxTokens,
      system: toAnthropicSystem(systemPrompt, options.pinnedFullText),
      messages: toAnthropicMessages(messages),
    };
    // Chat reads the selected model's effort; translation supplies its own
    // transient thinking setting. Forward the resulting provider-specific body.
    const requestBody: Record<string, unknown> = { ...baseRequest };
    const thinkingExtras = buildAnthropicThinking(preset);
    if (thinkingExtras) Object.assign(requestBody, thinkingExtras);

    let stream: AsyncIterable<unknown>;
    try {
      stream = (await client.messages.stream(
        requestBody as Parameters<typeof client.messages.stream>[0],
        { signal },
      )) as AsyncIterable<unknown>;
    } catch (err) {
      yield { type: 'error', message: errMsg(err) };
      return;
    }

    let latestUsage:
      | {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
        }
      | undefined;
    try {
      for await (const event of stream) {
        const e = event as {
          type: string;
          delta?: { type: string; text?: string; thinking?: string };
          usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
        };
        if (e.type === 'content_block_delta') {
          if (e.delta?.type === 'text_delta' && e.delta.text != null) {
            yield { type: 'text_delta', text: e.delta.text };
          } else if (e.delta?.type === 'thinking_delta' && e.delta.thinking != null) {
            yield { type: 'thinking_delta', text: e.delta.thinking };
          }
        } else if (e.type === 'message_delta' && e.usage) {
          latestUsage = e.usage;
        }
      }
      if (latestUsage) {
        yield {
          type: 'usage',
          input: latestUsage.input_tokens ?? 0,
          output: latestUsage.output_tokens ?? 0,
          ...(typeof latestUsage.cache_read_input_tokens === 'number'
            ? { cacheRead: latestUsage.cache_read_input_tokens }
            : {}),
        };
      }
    } catch (err) {
      yield { type: 'error', message: errMsg(err) };
    }
  }

  // Codex-style agent tool loop on the Messages API. Mirrors
  // providers/openai.ts streamWithTools: forward the local tools, parse the
  // model's tool_use blocks, run them through the shared harness, feed the
  // results back, and loop until the model answers without calling a tool or
  // the maxToolIterations safety fuse blows.
  private async *streamWithTools(
    client: Anthropic,
    messages: Message[],
    systemPrompt: string,
    preset: ModelPreset,
    signal: AbortSignal,
    options: ProviderStreamOptions,
  ): AsyncIterable<StreamChunk> {
    const tools = options.tools ?? [];
    const anthropicTools = toAnthropicTools(tools);
    const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
    const permissionMode = options.permissionMode ?? 'default';
    const maxIterations =
      options.maxToolIterations ?? DEFAULT_CONTEXT_POLICY.maxToolIterations;
    const thinkingExtras = buildAnthropicThinking(preset);

    // The conversation grows across iterations: the original turns, then each
    // assistant turn (thinking + text + tool_use) we replay verbatim, then a
    // user turn carrying the tool_result blocks we synthesize locally.
    const conversation = toAnthropicMessages(
      messages,
    ) as unknown as AnthropicMessageParam[];
    // zotero_get_full_pdf can pin paper full text as the system front block
    // for the rest of the loop (mirrors the OpenAI frontBlock handling).
    let frontBlock: string | undefined = options.pinnedFullText;

    for (let iteration = 0; iteration <= maxIterations; iteration++) {
      const requestBody: Record<string, unknown> = {
        model: preset.model,
        max_tokens: preset.maxTokens,
        system: toAnthropicSystem(systemPrompt, frontBlock),
        messages: conversation,
        tools: anthropicTools,
      };
      if (thinkingExtras) Object.assign(requestBody, thinkingExtras);

      let stream: AsyncIterable<unknown>;
      try {
        stream = (await client.messages.stream(
          requestBody as Parameters<typeof client.messages.stream>[0],
          { signal },
        )) as AsyncIterable<unknown>;
      } catch (err) {
        yield { type: 'error', message: errMsg(err) };
        return;
      }

      const blocks: DraftBlock[] = [];
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      let cacheRead: number | undefined;
      try {
        for await (const event of stream) {
          const e = event as AnthropicStreamEvent;
          switch (e.type) {
            case 'message_start':
              inputTokens = e.message?.usage?.input_tokens;
              cacheRead = e.message?.usage?.cache_read_input_tokens;
              break;
            case 'content_block_start': {
              const cb = e.content_block;
              if (e.index == null || !cb) break;
              if (cb.type === 'text') {
                blocks[e.index] = { type: 'text', text: cb.text ?? '' };
              } else if (cb.type === 'thinking') {
                blocks[e.index] = {
                  type: 'thinking',
                  thinking: cb.thinking ?? '',
                  signature: cb.signature ?? '',
                };
              } else if (cb.type === 'redacted_thinking') {
                blocks[e.index] = { type: 'redacted_thinking', data: cb.data ?? '' };
              } else if (cb.type === 'tool_use') {
                blocks[e.index] = {
                  type: 'tool_use',
                  id: cb.id ?? '',
                  name: cb.name ?? '',
                  json: '',
                };
              }
              break;
            }
            case 'content_block_delta': {
              const b = e.index == null ? undefined : blocks[e.index];
              const d = e.delta;
              if (!b || !d) break;
              if (d.type === 'text_delta' && d.text != null && b.type === 'text') {
                b.text += d.text;
                yield { type: 'text_delta', text: d.text };
              } else if (
                d.type === 'thinking_delta' &&
                d.thinking != null &&
                b.type === 'thinking'
              ) {
                b.thinking += d.thinking;
                yield { type: 'thinking_delta', text: d.thinking };
              } else if (
                d.type === 'signature_delta' &&
                d.signature != null &&
                b.type === 'thinking'
              ) {
                b.signature += d.signature;
              } else if (
                d.type === 'input_json_delta' &&
                d.partial_json != null &&
                b.type === 'tool_use'
              ) {
                b.json += d.partial_json;
              }
              break;
            }
            case 'message_delta':
              if (e.usage?.output_tokens != null) outputTokens = e.usage.output_tokens;
              if (e.usage?.input_tokens != null) inputTokens = e.usage.input_tokens;
              if (e.usage?.cache_read_input_tokens != null)
                cacheRead = e.usage.cache_read_input_tokens;
              break;
            default:
              break;
          }
        }
      } catch (err) {
        yield { type: 'error', message: errMsg(err) };
        return;
      }

      if (inputTokens != null || outputTokens != null) {
        yield {
          type: 'usage',
          input: inputTokens ?? 0,
          output: outputTokens ?? 0,
          ...(cacheRead != null ? { cacheRead } : {}),
        };
      }

      const present = blocks.filter(Boolean);
      const toolUses = present.filter(
        (b): b is Extract<DraftBlock, { type: 'tool_use' }> => b.type === 'tool_use',
      );
      // Natural exit: the model answered without (more) tool calls.
      if (toolUses.length === 0) return;

      // Parse each call's arguments once, so the input we replay in the
      // assistant turn is byte-identical to what we hand the tool.
      const argsById = new Map<string, unknown>();
      const parseFailed = new Set<string>();
      for (const call of toolUses) {
        if (!call.json.trim()) {
          argsById.set(call.id, {});
          continue;
        }
        try {
          argsById.set(call.id, JSON.parse(call.json));
        } catch {
          argsById.set(call.id, {});
          parseFailed.add(call.id);
        }
      }

      // Replay the assistant turn verbatim. WHY signatures matter: with
      // extended thinking on, Anthropic REQUIRES the original thinking block
      // (with its signature) to precede the tool_use it accompanies; dropping
      // it 400s the next request. So we rebuild the turn in stream order,
      // skipping only empty text blocks.
      conversation.push({
        role: 'assistant',
        content: present
          .filter((b) => !(b.type === 'text' && !b.text))
          .map((b) => draftToContentBlock(b, argsById)),
      });

      const toolResults: Array<Record<string, unknown>> = [];
      for (const call of toolUses) {
        yield {
          type: 'tool_call',
          name: call.name,
          status: 'started',
          summary: `调用 Zotero 工具: ${call.name}`,
        };

        const outcome: ToolRunOutcome = parseFailed.has(call.id)
          ? {
              status: 'error',
              result: {
                output: `Invalid JSON arguments for local tool: ${call.name}`,
                summary: `工具参数 JSON 无效: ${call.name}`,
              },
            }
          : await runValidatedTool(
              toolMap,
              call.name,
              argsById.get(call.id),
              signal,
              permissionMode,
            );

        if (outcome.result.frontBlock) frontBlock = outcome.result.frontBlock;
        yield {
          type: 'tool_call',
          name: call.name,
          status: outcome.status,
          summary: outcome.result.summary,
          context: outcome.result.context,
        };

        // Native multimodal tool_result: text first, then the image blocks the
        // tool wants the model to SEE (e.g. arxiv_get_figure). Anthropic
        // accepts image blocks directly inside tool_result.content, so unlike
        // the OpenAI path we do not need a synthetic follow-up user turn.
        const content: Array<Record<string, unknown>> = [
          { type: 'text', text: outcome.result.output || '(no tool output)' },
        ];
        if (outcome.result.images?.length) {
          for (const image of outcome.result.images) {
            content.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: anthropicImageMediaType(image.mediaType),
                data: dataUrlPayload(image.dataUrl),
              },
            });
          }
          yield { type: 'tool_images', images: outcome.result.images };
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content,
          ...(outcome.status === 'error' ? { is_error: true } : {}),
        });
      }

      conversation.push({ role: 'user', content: toolResults });
    }

    // Safety fuse blew. INVARIANT: never silently truncate — surface it so the
    // user sees the loop bound was the limiter, not the model.
    yield {
      type: 'error',
      message:
        'Tool loop stopped because the model exceeded the local tool iteration limit.',
    };
  }
}

// Maps the harness's structured AgentTools onto Anthropic's `tools` shape.
// `parameters` is already a JSON Schema object, which is exactly what
// Anthropic's `input_schema` expects.
export function toAnthropicTools(
  tools: AgentTool[],
): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

interface AnthropicMessageParam {
  role: 'user' | 'assistant';
  content: string | Array<Record<string, unknown>>;
}

// A content block accumulated while streaming one assistant turn. `json` holds
// the partial_json fragments for a tool_use; `signature` the signature_delta
// fragments for a thinking block.
type DraftBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: 'tool_use'; id: string; name: string; json: string };

function draftToContentBlock(
  block: DraftBlock,
  argsById: Map<string, unknown>,
): Record<string, unknown> {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'thinking':
      return {
        type: 'thinking',
        thinking: block.thinking,
        signature: block.signature,
      };
    case 'redacted_thinking':
      return { type: 'redacted_thinking', data: block.data };
    case 'tool_use':
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: argsById.get(block.id) ?? {},
      };
  }
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  message?: { usage?: AnthropicUsage };
  content_block?: {
    type: string;
    id?: string;
    name?: string;
    text?: string;
    thinking?: string;
    signature?: string;
    data?: string;
  };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    signature?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: AnthropicUsage;
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: {
        type: 'base64';
        media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
        data: string;
      };
    };

type AnthropicMessage = {
  role: Message['role'];
  content: string | AnthropicContentBlock[];
};

export function toAnthropicMessages(messages: Message[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const message of messages) {
    if (!message.images?.length) {
      out.push({ role: message.role, content: message.content });
      continue;
    }

    if (message.role === 'user') {
      const content: AnthropicContentBlock[] = [];
      if (message.content) content.push({ type: 'text', text: message.content });
      content.push(...imageContentBlocks(message.images));
      out.push({ role: 'user', content });
      continue;
    }

    // Anthropic forbids image blocks on assistant turns (image content is a
    // user-side concept). An assistant message may still carry images in our
    // history — a figure delivered via `tool_images` in an earlier tool loop
    // turn lands on `assistant.images`. Replaying it as an assistant image
    // block is rejected upstream (the relay returns an empty stream →
    // "request ended without sending any chunks").
    //
    // To keep the figure visible across turns (matching the OpenAI path's
    // synthetic-user replay) WITHOUT breaking Anthropic's role-alternation
    // rule, we fold the images into the PRECEDING user turn instead of
    // inserting a new one, and replay the assistant turn as text only. If
    // there is no preceding user turn to attach to, the images are dropped
    // (the model can re-fetch via the tool).
    const prev = out[out.length - 1];
    if (prev?.role === 'user') {
      const prevContent = toContentBlocks(prev.content);
      prevContent.push({
        type: 'text',
        text: '[Tool-fetched figure(s), kept for visual context.]',
      });
      prevContent.push(...imageContentBlocks(message.images));
      prev.content = prevContent;
    }
    out.push({ role: 'assistant', content: message.content });
  }
  return out;
}

function imageContentBlocks(
  images: NonNullable<Message['images']>,
): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [];
  images.forEach((image, index) => {
    const label = image.marker ?? `[Image #${index + 1}]`;
    blocks.push({ type: 'text', text: `<image name=${label}>` });
    blocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: anthropicImageMediaType(image.mediaType),
        data: dataUrlPayload(image.dataUrl),
      },
    });
    blocks.push({ type: 'text', text: '</image>' });
  });
  return blocks;
}

function toContentBlocks(
  content: string | AnthropicContentBlock[],
): AnthropicContentBlock[] {
  if (Array.isArray(content)) return content;
  return content ? [{ type: 'text', text: content }] : [];
}

function anthropicImageMediaType(
  mediaType: string,
): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  switch (mediaType) {
    case 'image/jpeg':
    case 'image/png':
    case 'image/gif':
    case 'image/webp':
      return mediaType;
    default:
      return 'image/png';
  }
}

// GOTCHA: Anthropic's image source expects raw base64, NOT a `data:` URL.
// We strip the `data:image/png;base64,` prefix here. OpenAI takes the full
// data-URL via `input_image.image_url`, so the providers diverge on this.
function dataUrlPayload(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Anthropic's thinking configuration has three dialects we have to dispatch
// between (see settings/types.ts AnthropicVendor for the rationale):
//
//   - Claude (modern: Opus 4.7 / 4.6, Sonnet 4.6, Mythos):
//       thinking: { type: "adaptive" } + output_config: { effort }
//     Opus 4.7 REJECTS the legacy `enabled` mode with a 400.
//
//   - Claude (older: Sonnet 4.5/Haiku 4.5/etc.):
//       thinking: { type: "enabled", budget_tokens: N }
//     `output_config.effort` is unsupported on these models.
//
//   - DeepSeek (Anthropic-format endpoint):
//       thinking: { type: "enabled" } + output_config: { effort }
//     Current native efforts are low/high/max; the legacy stored xhigh
//     alias still represents max for this adapter.
//
// Returning null omits the thinking configuration. Translation settings
// take precedence over the saved per-model chat selection.
export function buildAnthropicThinking(
  preset: ModelPreset,
): Record<string, unknown> | null {
  // Translate flow writes a transient `extras.translateThinking` (with an
  // explicit "off" choice). Chat flow doesn't — instead we read the
  // persisted reasoningEffort the user picked in the composer footer / the
  // preset card. Compat vendor is never given a thinking field regardless.
  const hasChatEffort = preset.extras?.reasoningEffort !== undefined
    || preset.extras?.reasoningEffortByModel?.[preset.model] !== undefined;
  const level = preset.extras?.translateThinking
    ?? reasoningEffortToThinking(hasChatEffort ? effectiveReasoningEffort(preset) : undefined);
  if (!level) return null;
  const vendor: AnthropicVendor = preset.extras?.vendor ?? 'compat';
  if (vendor === 'compat') return null;
  // Explicit "off". Claude defaults to no-thinking when the field is omitted,
  // so for vendor=claude we just return null. DeepSeek is the opposite —
  // its `thinking` default is `enabled`, so we MUST send `disabled` to
  // actually turn thinking off; otherwise the API still thinks.
  if (level === 'off') {
    return vendor === 'deepseek' ? { thinking: { type: 'disabled' } } : null;
  }
  if (vendor === 'deepseek') {
    return {
      thinking: { type: 'enabled' },
      // Preserve old translation xhigh as max, while sending native low
      // independently for current model configurations.
      output_config: { effort: level === 'xhigh' ? 'max' : collapseReasoningForPreset(preset, level) ?? 'high' },
    };
  }
  const descriptor = findClaudeDescriptor(preset.model);
  if (descriptor.thinkingDialect === 'adaptive') {
    return {
      thinking: { type: 'adaptive' },
      output_config: { effort: claudeAdaptiveEffort(descriptor, level) },
    };
  }
  return {
    thinking: { type: 'enabled', budget_tokens: claudeBudgetTokens(level) },
  };
}

// Helpers below only ever run for non-'off' levels — buildAnthropicThinking
// short-circuits the 'off' case before reaching either of them.
type ActiveThinking = Exclude<TranslateThinking, 'off'> | 'max';

// Map the preset's reasoningEffort (OpenAI-shaped enum) onto our internal
// TranslateThinking levels for the chat flow. The 'none' / 'minimal' values
// — which OpenAI exposes for "no/very-light reasoning" — get folded into
// 'off' so the UX stays "thinking on" by default; setting effort to 'low'
// or above is what actually triggers Anthropic thinking on chat.
function reasoningEffortToThinking(
  effort: ReasoningEffort | undefined,
): TranslateThinking | 'max' | null {
  if (!effort) return null;
  if (effort === 'none' || effort === 'minimal') return 'off';
  return effort;
}

function claudeAdaptiveEffort(
  descriptor: { acceptsXhigh?: boolean },
  level: ActiveThinking,
): string {
  // xhigh is Opus-4.7-only per Anthropic's effort-availability matrix; on
  // Sonnet 4.6 / Opus 4.6 we promote it to `max` (the next strongest level
  // they actually accept) so xhigh users still get heavy thinking.
  if (level === 'xhigh' && !descriptor.acceptsXhigh) return 'max';
  return level;
}

function claudeBudgetTokens(level: ActiveThinking): number {
  switch (level) {
    case 'low':
      return 1024;
    case 'medium':
      return 2048;
    case 'high':
      return 4096;
    case 'xhigh':
    case 'max':
      return 8192;
  }
}
