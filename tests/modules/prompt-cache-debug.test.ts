import { describe, it, expect } from "vitest";
import {
  buildPromptCacheDebug,
  shortHash,
} from "../../src/modules/prompt-cache-debug";
import type { ModelPreset } from "../../src/settings/types";

const base: Omit<ModelPreset, "provider"> = {
  id: "p1",
  label: "p1",
  apiKey: "k",
  baseUrl: "",
  model: "m",
  maxTokens: 1,
};

const build = (preset: ModelPreset) =>
  buildPromptCacheDebug({
    preset,
    promptCacheKey: "ck",
    systemPrompt: "sys",
    tools: [{ name: "t", parameters: {} }],
  });

describe("shortHash", () => {
  it("is deterministic and 8 hex chars", () => {
    expect(shortHash("hello")).toMatch(/^[0-9a-f]{8}$/);
    expect(shortHash("hello")).toBe(shortHash("hello"));
  });

  it("changes with input", () => {
    expect(shortHash("a")).not.toBe(shortHash("b"));
  });
});

describe("buildPromptCacheDebug", () => {
  it("anthropic: cache_control mechanism, no prompt_cache_key, no reasoning", () => {
    const d = build({ ...base, provider: "anthropic" });
    expect(d.provider).toBe("anthropic");
    expect(d.requestPath).toBe("anthropic.messages");
    expect(d.promptCacheKeySent).toBe(false);
    expect(d.reasoningSent).toBe(false);
    expect(d.promptCacheMechanism).toContain("cache_control");
  });

  it("official OpenAI: sends prompt_cache_key via Responses", () => {
    const d = build({ ...base, provider: "openai", baseUrl: "" });
    expect(d.requestPath).toBe("openai.responses");
    expect(d.promptCacheKeySent).toBe(true);
    expect(d.endpoint).toContain("api.openai.com");
  });

  it("official OpenAI gpt-5: gets 24h prompt-cache retention", () => {
    const d = build({ ...base, provider: "openai", model: "gpt-5" });
    expect(d.promptCacheRetention).toBe("24h");
  });

  it("non-official OpenAI relay: uses relay prompt_cache_key + session_id", () => {
    const d = build({
      ...base,
      provider: "openai",
      baseUrl: "https://relay.example/v1",
    });
    expect(d.promptCacheKeySent).toBe(true);
    expect(d.promptCacheMechanism).toContain("Relay");
  });

  it("non-official OpenAI with relay cache disabled: prompt_cache_key not sent", () => {
    const d = build({
      ...base,
      provider: "openai",
      baseUrl: "https://relay.example/v1",
      extras: { enableRelayPromptCache: false },
    });
    expect(d.promptCacheKeySent).toBe(false);
  });

  it("includes front-block fingerprint only when pinned full text is present", () => {
    const preset: ModelPreset = { ...base, provider: "anthropic" };
    const without = buildPromptCacheDebug({
      preset,
      promptCacheKey: "ck",
      systemPrompt: "sys",
      tools: [],
    });
    expect(without.frontBlockHash).toBeUndefined();
    const withPin = buildPromptCacheDebug({
      preset,
      promptCacheKey: "ck",
      systemPrompt: "sys",
      pinnedFullText: "the paper",
      tools: [],
    });
    expect(withPin.frontBlockHash).toMatch(/^[0-9a-f]{8}$/);
    expect(withPin.frontBlockChars).toBe("the paper".length);
  });
});
