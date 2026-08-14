import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  OpenAIProvider,
  openAIHostedToolSpecs,
  toOpenAIInput,
  withFrontBlock,
} from "../../src/providers/openai";
import type { ModelPreset } from "../../src/settings/types";
import type { StreamChunk } from "../../src/providers/types";

const requestLog = vi.hoisted(() => ({
  requests: [] as Array<{
    input?: unknown;
    tools?: unknown[];
    reasoning?: unknown;
    prompt_cache_key?: string;
    prompt_cache_retention?: string;
    parallel_tool_calls?: boolean;
    headers?: Record<string, string>;
  }>,
  chatRequests: [] as Array<{ model?: string }>,
  // When > 0, FakeOpenAI throws an APIError(500) on the next N calls and
  // then succeeds. Lets tests exercise the relay-routing retry loop without
  // depending on a live relay.
  retry5xxRemaining: 0,
  retry5xxRequestNumbers: [] as number[],
  incompleteResponsesRemaining: 0,
  unterminatedResponsesRemaining: 0,
}));

vi.mock("openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openai")>();
  const fakeStream = async function* () {
    yield { type: "response.output_text.delta", delta: "Hi" };
    yield { type: "response.output_text.delta", delta: " there" };
    yield {
      type: "response.completed",
      response: {
        usage: {
          input_tokens: 7,
          output_tokens: 2,
          input_tokens_details: { cached_tokens: 0 },
        },
      },
    };
  };
  class FakeOpenAI {
    toolCallCount = 0;
    responses = {
      create: async (
        params: {
          stream?: boolean;
          tools?: unknown[];
          input?: unknown;
        },
        options?: { headers?: Record<string, string> },
      ) => {
        requestLog.requests.push({
          ...params,
          input:
            params.input == null
              ? undefined
              : JSON.parse(JSON.stringify(params.input)),
          headers: options?.headers,
        });
        const requestNumber = requestLog.requests.length;
        if (requestLog.retry5xxRequestNumbers.includes(requestNumber)) {
          requestLog.retry5xxRequestNumbers =
            requestLog.retry5xxRequestNumbers.filter(
              (candidate) => candidate !== requestNumber,
            );
          throw new actual.APIError(
            500,
            { message: "Network connection failed" },
            undefined,
            new Headers(),
          );
        }
        if (requestLog.retry5xxRemaining > 0) {
          requestLog.retry5xxRemaining -= 1;
          throw new actual.APIError(
            500,
            { message: "Network connection failed" },
            undefined,
            new Headers(),
          );
        }
        if (requestLog.incompleteResponsesRemaining > 0) {
          requestLog.incompleteResponsesRemaining -= 1;
          return (async function* () {
            yield {
              type: "response.output_text.delta",
              delta: "Partial answer",
            };
            yield {
              type: "response.incomplete",
              response: {
                incomplete_details: { reason: "max_output_tokens" },
                usage: { input_tokens: 8, output_tokens: 100 },
              },
            };
          })();
        }
        if (requestLog.unterminatedResponsesRemaining > 0) {
          requestLog.unterminatedResponsesRemaining -= 1;
          return (async function* () {
            yield {
              type: "response.output_text.delta",
              delta: "Interrupted answer",
            };
            yield {
              type: "response.output_item.done",
              item: {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "Interrupted answer" }],
              },
            };
          })();
        }
        const hasFunctionTool = params.tools?.some(
          (tool) =>
            typeof tool === "object" &&
            tool != null &&
            (tool as { type?: unknown }).type === "function",
        );
        if (params.tools?.length && !hasFunctionTool) {
          const continuing = JSON.stringify(params.input).includes(
            "[ZAI_COMPLETE]",
          );
          return (async function* () {
            yield {
              type: "response.web_search_call.in_progress",
              item_id: "ws_1",
            };
            yield {
              type: "response.web_search_call.searching",
              item_id: "ws_1",
            };
            yield {
              type: "response.web_search_call.completed",
              item_id: "ws_1",
            };
            yield {
              type: "response.output_item.done",
              item: {
                type: "mcp_list_tools",
                id: "mcp_list_1",
                server_label: "arxiv",
                tools: [{ name: "search" }],
              },
            };
            yield {
              type: "response.output_text.delta",
              delta: continuing ? "Web result\n[ZAI_COMPLETE]" : "Web result",
            };
            yield {
              type: "response.completed",
              response: { usage: { input_tokens: 11, output_tokens: 3 } },
            };
          })();
        }
        if (params.tools?.length) {
          this.toolCallCount++;
          return this.toolCallCount === 1
            ? (async function* () {
                yield {
                  type: "response.output_item.done",
                  item: {
                    type: "reasoning",
                    id: "rs_test_reasoning_item",
                    summary: [{ type: "summary_text", text: "need a tool" }],
                  },
                };
                yield {
                  type: "response.output_item.done",
                  item: {
                    type: "function_call",
                    call_id: "call_1",
                    name: "zotero_get_full_pdf",
                    arguments: "{}",
                  },
                };
                yield { type: "response.completed", response: {} };
              })()
            : (async function* () {
                yield {
                  type: "response.output_text.delta",
                  delta: "Summary from tool output",
                };
                yield {
                  type: "response.output_item.done",
                  item: {
                    type: "message",
                    role: "assistant",
                    content: [
                      { type: "output_text", text: "Summary from tool output" },
                    ],
                  },
                };
                yield {
                  type: "response.completed",
                  response: { usage: { input_tokens: 10, output_tokens: 4 } },
                };
              })();
        }
        if (params.stream) return fakeStream();
        return fakeStream();
      },
    };
    chat = {
      completions: {
        create: async (params: { model?: string }) => {
          requestLog.chatRequests.push({ model: params.model });
          return (async function* () {
            yield {
              choices: [{ delta: { content: "Chat" }, finish_reason: null }],
            };
            yield {
              choices: [{ delta: {}, finish_reason: "stop" }],
              usage: { prompt_tokens: 2, completion_tokens: 1 },
            };
          })();
        },
      },
    };
  }
  return { ...actual, default: FakeOpenAI };
});

const preset: ModelPreset = {
  id: "o",
  label: "GPT",
  provider: "openai",
  apiKey: "sk",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5.2",
  maxTokens: 1000,
};

// Backing store for the relay-routing cache JSON. Persistence happens
// fire-and-forget after a successful stream, so each test starts fresh.
let relayRoutingStore = "{}";

describe("OpenAIProvider", () => {
  beforeEach(() => {
    requestLog.requests = [];
    requestLog.chatRequests = [];
    requestLog.retry5xxRemaining = 0;
    requestLog.retry5xxRequestNumbers = [];
    requestLog.incompleteResponsesRemaining = 0;
    requestLog.unterminatedResponsesRemaining = 0;
    relayRoutingStore = "{}";
    // Provide a Zotero global so loadRelaySalt / persistRelaySalt have a
    // backing File API. They tolerate a missing global but logging would
    // be noisy; this keeps tests focused on the retry behavior itself.
    Object.defineProperty(globalThis, "Zotero", {
      configurable: true,
      value: {
        Profile: { dir: "/tmp/zotero-profile" },
        DataDirectory: { dir: "/tmp/zotero-data" },
        File: {
          getContentsAsync: async () => relayRoutingStore,
          putContentsAsync: async (_path: string, contents: string) => {
            relayRoutingStore = contents;
          },
        },
      },
    });
  });

  it("emits text deltas then usage", async () => {
    const p = new OpenAIProvider();
    const got: StreamChunk[] = [];
    for await (const c of p.stream(
      [{ role: "user", content: "hi" }],
      "be helpful",
      preset,
      new AbortController().signal,
    )) {
      got.push(c);
    }
    expect(got).toEqual([
      { type: "text_delta", text: "Hi" },
      { type: "text_delta", text: " there" },
      { type: "usage", input: 7, output: 2, cacheRead: 0 },
    ]);
    expect(requestLog.requests[0].reasoning).toEqual({
      effort: "xhigh",
      summary: "concise",
    });
    expect(requestLog.requests[0].prompt_cache_key).toBe("zai:openai");
    expect(requestLog.requests[0].prompt_cache_retention).toBe("24h");
  });

  it("uses the detected transport independently for each model", async () => {
    const p = new OpenAIProvider();
    const multiModelPreset: ModelPreset = {
      ...preset,
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
      models: ["deepseek-v4-flash", "deepseek-v4-pro"],
      extras: { openaiChatCompletionsModels: ["deepseek-v4-pro"] },
    };

    for await (const _ of p.stream(
      [{ role: "user", content: "hi" }],
      "be helpful",
      multiModelPreset,
      new AbortController().signal,
    )) {
      // Drain the Chat Completions stream.
    }
    for await (const _ of p.stream(
      [{ role: "user", content: "hi" }],
      "be helpful",
      { ...multiModelPreset, model: "deepseek-v4-flash" },
      new AbortController().signal,
    )) {
      // Drain the Responses stream.
    }

    expect(requestLog.chatRequests).toEqual([{ model: "deepseek-v4-pro" }]);
    expect(requestLog.requests).toHaveLength(1);
  });

  it("keeps Responses reasoning and enables relay cache on non-official endpoints by default", async () => {
    const p = new OpenAIProvider();
    for await (const _ of p.stream(
      [{ role: "user", content: "hi" }],
      "be helpful",
      {
        ...preset,
        baseUrl: "http://relay.example/openai",
      },
      new AbortController().signal,
    )) {
      // Drain the stream so the request is issued.
    }

    expect(requestLog.requests[0].reasoning).toEqual({
      effort: "xhigh",
      summary: "concise",
    });
    expect(requestLog.requests[0].prompt_cache_key).toBe("zai:openai");
    expect(requestLog.requests[0].headers).toEqual({
      session_id: "zai:openai",
    });
  });

  it("sends prompt cache key and session header to configured OpenAI relay", async () => {
    const p = new OpenAIProvider();
    for await (const _ of p.stream(
      [{ role: "user", content: "hi" }],
      "be helpful",
      {
        ...preset,
        baseUrl: "https://relay.example/openai",
      },
      new AbortController().signal,
      { promptCacheKey: "zai:openai:preset-1:gpt-5.5:item-3" },
    )) {
      // Drain the stream so the request is issued.
    }

    expect(requestLog.requests[0].prompt_cache_key).toBe(
      "zai:openai:preset-1:gpt-5_5:item-3",
    );
    expect(requestLog.requests[0].prompt_cache_retention).toBeUndefined();
    expect(requestLog.requests[0].headers).toEqual({
      session_id: "zai:openai:preset-1:gpt-5_5:item-3",
    });
  });

  it("sends relay session header on Responses tool-loop requests", async () => {
    const p = new OpenAIProvider();
    for await (const _ of p.stream(
      [{ role: "user", content: "总结当前论文" }],
      "be helpful",
      {
        ...preset,
        baseUrl: "https://relay.example/openai",
      },
      new AbortController().signal,
      {
        promptCacheKey: "zai:openai:preset-1:gpt-5.5:item-3",
        tools: [
          {
            name: "zotero_get_full_pdf",
            description: "Read the current PDF.",
            parameters: { type: "object", properties: {} },
            execute: async () => ({
              output: "Full paper text is now provided at the top.",
              frontBlock: "FULL PAPER",
            }),
          },
        ],
        maxToolIterations: 1,
      },
    )) {
      // Drain the stream so both tool-loop requests are issued.
    }

    expect(requestLog.requests).toHaveLength(2);
    expect(requestLog.requests[0].parallel_tool_calls).toBe(false);
    for (const request of requestLog.requests) {
      expect(request.prompt_cache_key).toBe(
        "zai:openai:preset-1:gpt-5_5:item-3",
      );
      expect(request.headers).toEqual({
        session_id: "zai:openai:preset-1:gpt-5_5:item-3",
      });
    }
  });

  it("allows parallel tool planning only when explicitly requested", async () => {
    const p = new OpenAIProvider();

    for await (const _ of p.stream(
      [{ role: "user", content: "分析网络结构" }],
      "be helpful",
      preset,
      new AbortController().signal,
      {
        tools: [
          {
            name: "zotero_get_full_pdf",
            description: "Read the current PDF.",
            parameters: { type: "object", properties: {} },
            execute: async () => ({ output: "paper" }),
          },
        ],
        maxToolIterations: 1,
        parallelToolCalls: true,
      },
    )) {
      // Drain the stream so the request is issued.
    }

    expect(requestLog.requests[0].parallel_tool_calls).toBe(true);
  });

  it("retries a relay 5xx on a later Responses tool-loop request", async () => {
    requestLog.retry5xxRequestNumbers = [2];
    const p = new OpenAIProvider();
    const chunks: StreamChunk[] = [];

    for await (const chunk of p.stream(
      [{ role: "user", content: "总结当前论文" }],
      "be helpful",
      {
        ...preset,
        baseUrl: "https://relay.example/openai",
      },
      new AbortController().signal,
      {
        promptCacheKey: "zai:openai:preset-1:gpt-5.5:item-3",
        tools: [
          {
            name: "zotero_get_full_pdf",
            description: "Read the current PDF.",
            parameters: { type: "object", properties: {} },
            execute: async () => ({ output: "FULL PAPER" }),
          },
        ],
        maxToolIterations: 2,
      },
    )) {
      chunks.push(chunk);
    }

    expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
    expect(chunks).toContainEqual({
      type: "text_delta",
      text: "Summary from tool output",
    });
    expect(requestLog.requests).toHaveLength(3);
    expect(requestLog.requests.map((request) => request.headers)).toEqual([
      { session_id: "zai:openai:preset-1:gpt-5_5:item-3" },
      { session_id: "zai:openai:preset-1:gpt-5_5:item-3" },
      { session_id: "zai:openai:preset-1:gpt-5_5:item-3:s1" },
    ]);
  });

  it("does not send relay cache keys after cache test disables the preset", async () => {
    const p = new OpenAIProvider();
    for await (const _ of p.stream(
      [{ role: "user", content: "hi" }],
      "be helpful",
      {
        ...preset,
        baseUrl: "https://relay.example/openai",
        extras: {
          ...preset.extras,
          enableRelayPromptCache: false,
        },
      },
      new AbortController().signal,
      { promptCacheKey: "zai:openai:preset-1:gpt-5.5:item-3" },
    )) {
      // Drain the stream so the request is issued.
    }

    expect(requestLog.requests[0].prompt_cache_key).toBeUndefined();
    expect(requestLog.requests[0].headers).toBeUndefined();
  });

  it("omits Responses reasoning on non-official endpoints only when cache-priority is explicit", async () => {
    const p = new OpenAIProvider();
    for await (const _ of p.stream(
      [{ role: "user", content: "hi" }],
      "be helpful",
      {
        ...preset,
        baseUrl: "http://relay.example/openai",
        extras: {
          ...preset.extras,
          omitResponsesReasoningForCache: true,
          reasoningEffort: "high",
        },
      },
      new AbortController().signal,
    )) {
      // Drain the stream so the request is issued.
    }

    expect(requestLog.requests[0].reasoning).toBeUndefined();
  });

  it("prepends manual pinned full text when no tools are present", async () => {
    const p = new OpenAIProvider();
    for await (const _ of p.stream(
      [{ role: "user", content: "总结全文" }],
      "be helpful",
      preset,
      new AbortController().signal,
      { pinnedFullText: "PAPER BODY" },
    )) {
      // Drain the stream so the request is issued.
    }

    expect(requestLog.requests[0].input).toEqual([
      { role: "user", content: "[Paper full text]\nPAPER BODY" },
      { role: "user", content: "总结全文" },
    ]);
  });

  it("prepends manual pinned full text on the first tool-loop request", async () => {
    const p = new OpenAIProvider();
    for await (const _ of p.stream(
      [{ role: "user", content: "总结全文" }],
      "be helpful",
      preset,
      new AbortController().signal,
      {
        pinnedFullText: "PINNED PAPER",
        tools: [
          {
            name: "zotero_get_full_pdf",
            description: "Read the current PDF.",
            parameters: { type: "object", properties: {} },
            execute: async () => ({
              output: "Full paper text is now provided at the top.",
              frontBlock: "PINNED PAPER",
            }),
          },
        ],
        maxToolIterations: 1,
      },
    )) {
      // Drain the stream so all tool-loop requests are issued.
    }

    expect(requestLog.requests[0].input).toEqual([
      { role: "user", content: "[Paper full text]\nPINNED PAPER" },
      { role: "user", content: "总结全文" },
    ]);
  });

  it("executes local tools and feeds outputs back to the model", async () => {
    const p = new OpenAIProvider();
    const got: StreamChunk[] = [];

    for await (const c of p.stream(
      [{ role: "user", content: "总结当前论文" }],
      "be helpful",
      preset,
      new AbortController().signal,
      {
        tools: [
          {
            name: "zotero_get_full_pdf",
            description: "Read the current PDF.",
            parameters: { type: "object", properties: {} },
            execute: async () => ({
              output: "[Paper full text]\ncontent",
              summary: "读取 PDF 全文",
              context: { planMode: "full_pdf", fullTextChars: 7 },
            }),
          },
        ],
        maxToolIterations: 2,
      },
    )) {
      got.push(c);
    }

    expect(got).toEqual([
      {
        type: "tool_call",
        name: "zotero_get_full_pdf",
        status: "started",
        summary: "调用 Zotero 工具: zotero_get_full_pdf",
      },
      {
        type: "tool_call",
        name: "zotero_get_full_pdf",
        status: "completed",
        summary: "读取 PDF 全文",
        context: { planMode: "full_pdf", fullTextChars: 7 },
      },
      { type: "text_delta", text: "Summary from tool output" },
      { type: "usage", input: 10, output: 4 },
    ]);
    expect(requestLog.requests).toHaveLength(2);
    expect(requestLog.requests[1].input).toEqual([
      { role: "user", content: "总结当前论文" },
      {
        type: "function_call",
        call_id: "call_1",
        name: "zotero_get_full_pdf",
        arguments: "{}",
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: "[Paper full text]\ncontent",
      },
    ]);
  });

  it("continues a tool-enabled response truncated by max output tokens", async () => {
    requestLog.incompleteResponsesRemaining = 1;
    const p = new OpenAIProvider();
    const got: StreamChunk[] = [];

    for await (const chunk of p.stream(
      [{ role: "user", content: "请完整总结论文" }],
      "be helpful",
      preset,
      new AbortController().signal,
      {
        toolSettings: {
          webSearchMode: "live",
          mcpServers: [],
          arxivMcp: {
            enabled: false,
            serverLabel: "arxiv",
            serverUrl: "",
            allowedTools: [],
            requireApproval: "never",
          },
        },
      },
    )) {
      got.push(chunk);
    }

    expect(
      got
        .filter((chunk) => chunk.type === "text_delta")
        .map((chunk) => chunk.text)
        .join(""),
    ).toBe("Partial answerWeb result");
    expect(got).toContainEqual({ type: "usage", input: 8, output: 100 });
    expect(requestLog.requests).toHaveLength(2);
    expect(requestLog.requests[1]?.input).toEqual([
      { role: "user", content: "请完整总结论文" },
      { role: "assistant", content: "Partial answer" },
      {
        role: "user",
        content:
          "Continue the same answer exactly from where it was cut off. Do not repeat existing text. Complete every remaining part of the user's request. When and only when the answer is fully complete, end with [ZAI_COMPLETE] on its own line.",
      },
    ]);
  });

  it("repeatedly continues compatible streams until a response completes", async () => {
    requestLog.unterminatedResponsesRemaining = 2;
    const p = new OpenAIProvider();
    const got: StreamChunk[] = [];

    for await (const chunk of p.stream(
      [{ role: "user", content: "请完整总结论文" }],
      "be helpful",
      { ...preset, baseUrl: "https://relay.example/v1" },
      new AbortController().signal,
      {
        toolSettings: {
          webSearchMode: "live",
          mcpServers: [],
          arxivMcp: {
            enabled: false,
            serverLabel: "arxiv",
            serverUrl: "",
            allowedTools: [],
            requireApproval: "never",
          },
        },
      },
    )) {
      got.push(chunk);
    }

    expect(
      got
        .filter((chunk) => chunk.type === "text_delta")
        .map((chunk) => chunk.text)
        .join(""),
    ).toBe("Interrupted answerInterrupted answerWeb result");
    expect(got.some((chunk) => chunk.type === "error")).toBe(false);
    expect(requestLog.requests).toHaveLength(3);
    expect(requestLog.requests[1]?.input).toEqual([
      { role: "user", content: "请完整总结论文" },
      { role: "assistant", content: "Interrupted answer" },
      {
        role: "user",
        content:
          "Continue the same answer exactly from where it was cut off. Do not repeat existing text. Complete every remaining part of the user's request. When and only when the answer is fully complete, end with [ZAI_COMPLETE] on its own line.",
      },
    ]);
    expect(requestLog.requests[2]?.input).toEqual([
      { role: "user", content: "请完整总结论文" },
      { role: "assistant", content: "Interrupted answer" },
      {
        role: "user",
        content:
          "Continue the same answer exactly from where it was cut off. Do not repeat existing text. Complete every remaining part of the user's request. When and only when the answer is fully complete, end with [ZAI_COMPLETE] on its own line.",
      },
      { role: "assistant", content: "Interrupted answer" },
      {
        role: "user",
        content:
          "Continue the same answer exactly from where it was cut off. Do not repeat existing text. Complete every remaining part of the user's request. When and only when the answer is fully complete, end with [ZAI_COMPLETE] on its own line.",
      },
    ]);
  });

  it("surfaces local tool images and sends them to the next model request", async () => {
    const p = new OpenAIProvider();
    const got: StreamChunk[] = [];
    const image = {
      id: "fig-3",
      name: "Figure 3",
      marker: "[Figure 3]",
      mediaType: "image/png",
      dataUrl: "data:image/png;base64,abc",
      size: 3,
    };

    for await (const c of p.stream(
      [{ role: "user", content: "解释 Figure 3" }],
      "be helpful",
      preset,
      new AbortController().signal,
      {
        tools: [
          {
            name: "zotero_get_full_pdf",
            description: "Tool with image.",
            parameters: { type: "object", properties: {} },
            execute: async () => ({
              output: "[Figure attached]",
              summary: "读取图 3",
              images: [image],
            }),
          },
        ],
        maxToolIterations: 2,
      },
    )) {
      got.push(c);
    }

    expect(got).toContainEqual({ type: "tool_images", images: [image] });
    expect(requestLog.requests[1].input).toContainEqual({
      role: "user",
      content: [
        { type: "input_text", text: "[Attached by tool zotero_get_full_pdf]" },
        { type: "input_image", image_url: image.dataUrl },
      ],
    });
  });

  it("blocks approval-required tools unless YOLO is enabled", async () => {
    const p = new OpenAIProvider();
    const got: StreamChunk[] = [];

    for await (const c of p.stream(
      [{ role: "user", content: "write note" }],
      "be helpful",
      preset,
      new AbortController().signal,
      {
        tools: [
          {
            name: "zotero_get_full_pdf",
            description: "Pretend write tool.",
            parameters: { type: "object", properties: {} },
            requiresApproval: true,
            execute: async () => ({ output: "should not run" }),
          },
        ],
        maxToolIterations: 1,
        permissionMode: "default",
      },
    )) {
      got.push(c);
    }

    expect(got).toContainEqual({
      type: "tool_call",
      name: "zotero_get_full_pdf",
      status: "error",
      summary: "需要审批: zotero_get_full_pdf",
      context: undefined,
    });
  });

  it("passes hosted web and MCP tools to OpenAI without local execution", async () => {
    const p = new OpenAIProvider();
    const got: StreamChunk[] = [];

    for await (const c of p.stream(
      [{ role: "user", content: "查一下这篇 arXiv 后续工作" }],
      "be helpful",
      preset,
      new AbortController().signal,
      {
        toolSettings: {
          webSearchMode: "live",
          mcpServers: [],
          arxivMcp: {
            enabled: true,
            serverLabel: "arxiv",
            serverUrl: "https://example.test/mcp",
            allowedTools: ["search"],
            requireApproval: "never",
          },
        },
      },
    )) {
      got.push(c);
    }

    expect(requestLog.requests[0].tools).toEqual([
      { type: "web_search", search_context_size: "high" },
      {
        type: "mcp",
        server_label: "arxiv",
        server_url: "https://example.test/mcp",
        allowed_tools: ["search"],
        require_approval: "never",
        server_description:
          "Configurable arXiv MCP search server. Let the model decide when to search or fetch paper metadata.",
      },
    ]);
    expect(got).toEqual([
      {
        type: "tool_call",
        name: "web_search",
        status: "started",
        summary: "正在使用内置联网搜索",
      },
      {
        type: "tool_call",
        name: "web_search",
        status: "completed",
        summary: "内置联网搜索完成",
      },
      {
        type: "tool_call",
        name: "mcp:arxiv/list_tools",
        status: "completed",
        summary: "MCP 工具列表已获取: 1 个工具",
      },
      { type: "text_delta", text: "Web result" },
      { type: "usage", input: 11, output: 3 },
    ]);
  });

  it("builds hosted tool specs from tool settings", () => {
    expect(openAIHostedToolSpecs(undefined)).toEqual([]);
    expect(
      openAIHostedToolSpecs({
        webSearchMode: "cached",
        mcpServers: [],
        arxivMcp: {
          enabled: false,
          serverLabel: "arxiv",
          serverUrl: "",
          allowedTools: ["search"],
          requireApproval: "never",
        },
      }),
    ).toEqual([{ type: "web_search", search_context_size: "medium" }]);
  });

  it("builds hosted MCP specs from generic MCP settings", () => {
    expect(
      openAIHostedToolSpecs({
        webSearchMode: "disabled",
        mcpServers: [
          {
            id: "docs",
            enabled: true,
            serverLabel: "docs",
            serverUrl: "https://docs.example/mcp",
            allowedTools: ["search"],
            requireApproval: "never",
          },
        ],
        arxivMcp: {
          enabled: false,
          serverLabel: "arxiv",
          serverUrl: "",
          allowedTools: ["search"],
          requireApproval: "never",
        },
      }),
    ).toEqual([
      {
        type: "mcp",
        server_label: "docs",
        server_url: "https://docs.example/mcp",
        allowed_tools: ["search"],
        require_approval: "never",
        server_description:
          'User-configured MCP server "docs". Let the model decide when to call its allowed tools.',
      },
    ]);
  });

  it("converts screenshot attachments into Responses image inputs", () => {
    expect(
      toOpenAIInput([
        {
          role: "user",
          content: "分析这张图",
          images: [
            {
              id: "img-1",
              marker: "[Image #1]",
              name: "shot.png",
              mediaType: "image/png",
              dataUrl: "data:image/png;base64,abc",
              size: 3,
            },
          ],
        },
      ]),
    ).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "分析这张图" },
          { type: "input_text", text: "<image name=[Image #1]>" },
          {
            type: "input_image",
            image_url: "data:image/png;base64,abc",
            detail: "high",
          },
          { type: "input_text", text: "</image>" },
        ],
      },
    ]);
  });

  it("replays assistant-attached tool images as user visual context for Responses", () => {
    const image = {
      id: "fig-3",
      marker: "[Figure 3]",
      name: "Figure 3",
      mediaType: "image/png",
      dataUrl: "data:image/png;base64,abc",
      size: 3,
    };

    expect(
      toOpenAIInput([
        {
          role: "assistant",
          content: "Figure 3 shows the occupancy trade-off.",
          images: [image],
        },
      ]),
    ).toEqual([
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "[Images attached to the following assistant message for visual context.]",
          },
          { type: "input_text", text: "<image name=[Figure 3]>" },
          {
            type: "input_image",
            image_url: "data:image/png;base64,abc",
            detail: "high",
          },
          { type: "input_text", text: "</image>" },
        ],
      },
      {
        role: "assistant",
        content: "Figure 3 shows the occupancy trade-off.",
      },
    ]);
  });

  it("keeps follow-up requests valid after an assistant message has images", async () => {
    const p = new OpenAIProvider();
    const image = {
      id: "fig-3",
      marker: "[Figure 3]",
      name: "Figure 3",
      mediaType: "image/png",
      dataUrl: "data:image/png;base64,abc",
      size: 3,
    };

    for await (const _ of p.stream(
      [
        { role: "user", content: "解释 Figure 3" },
        {
          role: "assistant",
          content: "横轴是 Azimuth Resolution.",
          images: [image],
        },
        { role: "user", content: "图中横标的范围是多少" },
      ],
      "be helpful",
      preset,
      new AbortController().signal,
    )) {
      // Drain the stream so the request is issued.
    }

    expect(requestLog.requests[0].input).toEqual([
      { role: "user", content: "解释 Figure 3" },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "[Images attached to the following assistant message for visual context.]",
          },
          { type: "input_text", text: "<image name=[Figure 3]>" },
          {
            type: "input_image",
            image_url: "data:image/png;base64,abc",
            detail: "high",
          },
          { type: "input_text", text: "</image>" },
        ],
      },
      { role: "assistant", content: "横轴是 Azimuth Resolution." },
      { role: "user", content: "图中横标的范围是多少" },
    ]);
  });

  it("feeds zotero_get_full_pdf frontBlock into the next tool-loop request", async () => {
    const p = new OpenAIProvider();
    for await (const _ of p.stream(
      [{ role: "user", content: "总结全文" }],
      "be helpful",
      preset,
      new AbortController().signal,
      {
        tools: [
          {
            name: "zotero_get_full_pdf",
            description: "Read the current PDF.",
            parameters: { type: "object", properties: {} },
            execute: async () => ({
              output: "Full paper text is now provided at the top.",
              frontBlock: "PAPER FROM TOOL",
            }),
          },
        ],
        maxToolIterations: 2,
      },
    )) {
      // Drain the stream so the second request is issued after tool execution.
    }

    expect(requestLog.requests[1].input).toEqual([
      { role: "user", content: "[Paper full text]\nPAPER FROM TOOL" },
      { role: "user", content: "总结全文" },
      {
        type: "function_call",
        call_id: "call_1",
        name: "zotero_get_full_pdf",
        arguments: "{}",
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: "Full paper text is now provided at the top.",
      },
    ]);
  });
});

describe("withFrontBlock", () => {
  it("returns the list unchanged when no front block is given", () => {
    const items = [{ role: "user", content: "hi" }];
    expect(withFrontBlock(items, undefined)).toBe(items);
  });

  it("prepends the front block at index 0 for the Responses input", () => {
    const items = [{ role: "user", content: "hi" }];
    expect(withFrontBlock(items, "PAPER")).toEqual([
      { role: "user", content: "[Paper full text]\nPAPER" },
      { role: "user", content: "hi" },
    ]);
  });

  it("inserts the front block after a leading system message", () => {
    const items = [
      { role: "system", content: "SYS" },
      { role: "user", content: "hi" },
    ];
    expect(withFrontBlock(items, "PAPER")).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "[Paper full text]\nPAPER" },
      { role: "user", content: "hi" },
    ]);
  });

  it("keeps a pinned-paper follow-up request prefixed by the previous request", async () => {
    const { toApiMessages } = await import("../../src/context/message-format");
    const user1 = {
      role: "user" as const,
      content: "first",
      context: {
        planMode: "full_pdf" as const,
        fullTextChars: 10,
        promptCacheLedger: "none",
      },
    };
    const api1 = toApiMessages([user1], { message: user1 });
    user1.context.promptCacheWireContent = api1[0].content as string;

    const assistant1 = { role: "assistant" as const, content: "answer" };
    const user2 = { role: "user" as const, content: "second" };
    const api2 = toApiMessages([user1, assistant1, user2], { message: user2 });
    const input1 = withFrontBlock(
      toOpenAIInput(api1) as Array<{ role?: string; content?: unknown }>,
      "PAPER BODY",
    );
    const input2 = withFrontBlock(
      toOpenAIInput(api2) as Array<{ role?: string; content?: unknown }>,
      "PAPER BODY",
    );

    expect(input2.slice(0, input1.length)).toEqual(input1);
  });
});
