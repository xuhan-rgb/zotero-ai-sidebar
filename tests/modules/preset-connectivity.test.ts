import { afterEach, describe, expect, it, vi } from "vitest";

import {
  detectOpenAIModelTransports,
  testPresetConnectivity,
} from "../../src/modules/preset-utils";
import type { ModelPreset } from "../../src/settings/types";

const preset: ModelPreset = {
  id: "deepseek",
  label: "DeepSeek",
  provider: "openai",
  apiKey: "sk-test",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-pro",
  models: ["deepseek-v4-flash", "deepseek-v4-pro"],
  maxTokens: 8192,
};

describe("preset connectivity protocol detection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers Responses then saves Chat Completions when the model rejects Responses", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        requests.push({
          url,
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        if (url.endsWith("/responses")) {
          return new Response(
            JSON.stringify({
              error: {
                message:
                  "Codex integration with deepseek-v4-pro will be available starting early August 2026. Please use deepseek-v4-flash instead for now.",
                type: "invalid_request_error",
                code: "invalid_request_error",
              },
            }),
            { status: 400 },
          );
        }
        if (url.endsWith("/chat/completions")) {
          return new Response(JSON.stringify({ choices: [] }), { status: 200 });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    const result = await testPresetConnectivity(
      preset,
      new AbortController().signal,
    );

    expect(requests.map(({ url }) => url)).toEqual([
      "https://api.deepseek.com/responses",
      "https://api.deepseek.com/chat/completions",
    ]);
    expect(requests.map(({ body }) => body.model)).toEqual([
      "deepseek-v4-pro",
      "deepseek-v4-pro",
    ]);
    expect(result.preset.extras?.openaiChatCompletionsModels).toEqual([
      "deepseek-v4-pro",
    ]);
    expect(result.preset.extras?.openaiUseChatCompletions).toBeUndefined();
    expect(result.message).toContain("已切换为 Chat Completions");
  });

  it("detects the transport for every model when a configuration is added", async () => {
    const requests: Array<{ url: string; model: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        requests.push({ url, model: body.model });
        if (url.endsWith("/responses") && body.model === "deepseek-v4-flash") {
          return new Response(null, { status: 200 });
        }
        if (url.endsWith("/responses") && body.model === "deepseek-v4-pro") {
          return new Response(
            JSON.stringify({
              error: {
                message:
                  "Codex integration with deepseek-v4-pro will be available later. Please use deepseek-v4-flash instead for now.",
              },
            }),
            { status: 400 },
          );
        }
        if (
          url.endsWith("/chat/completions") &&
          body.model === "deepseek-v4-pro"
        ) {
          return new Response(null, { status: 200 });
        }
        throw new Error(`Unexpected request: ${url} / ${String(body.model)}`);
      }),
    );

    const detected = await detectOpenAIModelTransports(
      preset,
      new AbortController().signal,
    );

    expect(requests).toEqual([
      {
        url: "https://api.deepseek.com/responses",
        model: "deepseek-v4-flash",
      },
      {
        url: "https://api.deepseek.com/responses",
        model: "deepseek-v4-pro",
      },
      {
        url: "https://api.deepseek.com/chat/completions",
        model: "deepseek-v4-pro",
      },
    ]);
    expect(detected.model).toBe("deepseek-v4-pro");
    expect(detected.extras?.openaiChatCompletionsModels).toEqual([
      "deepseek-v4-pro",
    ]);
  });

  it("does not hide authentication errors behind a Chat Completions fallback", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(String(input));
        return new Response(
          JSON.stringify({
            error: { message: "Invalid API key", type: "authentication_error" },
          }),
          { status: 401 },
        );
      }),
    );

    await expect(
      testPresetConnectivity(preset, new AbortController().signal),
    ).rejects.toThrow("HTTP 401");
    expect(urls).toEqual(["https://api.deepseek.com/responses"]);
  });
});
