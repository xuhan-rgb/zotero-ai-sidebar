import { describe, expect, it } from "vitest";
import {
  buildTranslatePreset,
  cleanTranslationOutput,
  isTranslationPlaceholderReply,
  translationNeedsRetry,
} from "../../src/translate/translator";
import type { ModelPreset } from "../../src/settings/types";

const baseOpenAi: ModelPreset = {
  id: "o",
  label: "GPT",
  provider: "openai",
  apiKey: "sk",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5.4-mini",
  models: ["gpt-5.4-mini"],
  maxTokens: 8192,
  extras: { reasoningEffort: "high", reasoningSummary: "concise" },
};

const baseAnthropic: ModelPreset = {
  id: "c",
  label: "Claude",
  provider: "anthropic",
  apiKey: "sk-a",
  baseUrl: "https://api.anthropic.com",
  model: "claude-opus-4-7",
  models: ["claude-opus-4-7"],
  maxTokens: 8192,
  extras: { vendor: "claude" },
};

describe("buildTranslatePreset", () => {
  it("keeps the OpenAI path semantics: tight maxTokens, reasoning fields rewritten", () => {
    const out = buildTranslatePreset({
      sentence: "hello",
      preset: baseOpenAi,
      model: "",
      thinking: "low",
      signal: new AbortController().signal,
    });
    // 384 ceiling is preserved exactly — translation output is short and we
    // never want OpenAI to emit a long completion.
    expect(out.maxTokens).toBe(384);
    expect(out.extras?.reasoningEffort).toBe("low");
    expect(out.extras?.reasoningSummary).toBe("none");
    // OpenAI path must NOT carry the Anthropic translateThinking signal,
    // otherwise the Anthropic provider would mis-fire if reused.
    expect(out.extras?.translateThinking).toBeUndefined();
  });

  it("signals translateThinking on the Anthropic path", () => {
    const out = buildTranslatePreset({
      sentence: "hello",
      preset: baseAnthropic,
      model: "",
      thinking: "medium",
      signal: new AbortController().signal,
    });
    expect(out.extras?.translateThinking).toBe("medium");
    expect(out.extras?.vendor).toBe("claude");
    // Reasoning fields must NOT leak onto the Anthropic preset — the
    // existing chat-path AnthropicProvider would silently ignore them but
    // they shouldn't be there.
    expect(out.extras?.reasoningEffort).toBeUndefined();
    expect(out.extras?.reasoningSummary).toBeUndefined();
  });

  it("raises maxTokens on the Anthropic path so thinking + output both fit", () => {
    const out = buildTranslatePreset({
      sentence: "hello",
      preset: baseAnthropic,
      model: "",
      thinking: "high",
      signal: new AbortController().signal,
    });
    // For 'high' (4096 budget) we expect at least 4096 + 384 buffer.
    expect(out.maxTokens).toBeGreaterThanOrEqual(4096 + 384);
  });

  it("OpenAI path maps 'off' to reasoning_effort='none'", () => {
    const out = buildTranslatePreset({
      sentence: "hello",
      preset: baseOpenAi,
      model: "",
      thinking: "off",
      signal: new AbortController().signal,
    });
    expect(out.extras?.reasoningEffort).toBe("none");
    expect(out.extras?.reasoningSummary).toBe("none");
    expect(out.maxTokens).toBe(384);
  });

  it("Anthropic path keeps maxTokens tight when level is 'off' (no thinking budget needed)", () => {
    const out = buildTranslatePreset({
      sentence: "hello",
      preset: baseAnthropic,
      model: "",
      thinking: "off",
      signal: new AbortController().signal,
    });
    expect(out.extras?.translateThinking).toBe("off");
    expect(out.maxTokens).toBe(384);
  });

  it("keeps maxTokens tight for compat vendor (no thinking) on Anthropic path", () => {
    const compat: ModelPreset = {
      ...baseAnthropic,
      extras: { vendor: "compat" },
    };
    const out = buildTranslatePreset({
      sentence: "hello",
      preset: compat,
      model: "",
      thinking: "high",
      signal: new AbortController().signal,
    });
    // Compat won't send a thinking field, so we don't need to grow the cap.
    expect(out.maxTokens).toBe(384);
  });
});

describe("translation retry guard", () => {
  it("retries English paraphrases for English source sentences", () => {
    expect(
      translationNeedsRetry(
        "We describe a new model based on heterogeneous tasks.",
        "This is a new model based on heterogeneous tasks.",
      ),
    ).toBe(true);
  });

  it("accepts Simplified Chinese translations with retained terms", () => {
    expect(
      translationNeedsRetry(
        "We describe π0.5, a new model based on π0.",
        "我们介绍 π0.5，这是一个基于 π0 的新模型。",
      ),
    ).toBe(false);
  });

  it("retries replies that ask the user to provide translation content", () => {
    const reply = "好的，请提供需要翻译的英文内容。";

    expect(isTranslationPlaceholderReply(reply)).toBe(true);
    expect(translationNeedsRetry("Introduction", reply)).toBe(true);
  });

  it("retries short conversational replies instead of storing them as headings", () => {
    const reply = "打扰一下，我能不能问你一个问题？";

    expect(isTranslationPlaceholderReply(reply)).toBe(true);
    expect(translationNeedsRetry("Introduction", reply)).toBe(true);
  });

  it("keeps legitimate translations that describe an inability", () => {
    const translation = "很抱歉，我们无法在单任务设置中完成该评估。";

    expect(isTranslationPlaceholderReply(translation)).toBe(false);
  });

  it("removes common translation labels from model output", () => {
    expect(cleanTranslationOutput("译文：你好")).toBe("你好");
    expect(cleanTranslationOutput("Translation: 你好")).toBe("你好");
  });
});
