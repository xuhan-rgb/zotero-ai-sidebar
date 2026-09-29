import { describe, expect, it } from "vitest";
import {
  reasoningEffortOptionsForPreset,
  effectiveReasoningEffort,
} from "../../src/settings/reasoning";
import type { ModelPreset } from "../../src/settings/types";

const preset = (
  model: string,
  provider: ModelPreset["provider"] = "openai",
): ModelPreset => ({
  id: "test",
  label: "test",
  model,
  provider,
  apiKey: "test",
  baseUrl: "",
  maxTokens: 32768,
  extras:
    provider === "anthropic"
      ? { vendor: model.startsWith("deepseek") ? "deepseek" : "claude" }
      : {},
});

describe("model reasoning capabilities", () => {
  it.each([
    [
      "gpt-5.6-sol",
      "openai",
      ["none", "low", "medium", "high", "xhigh", "max"],
    ],
    ["gpt-5.4-mini", "openai", ["none", "low", "medium", "high", "xhigh"]],
    ["gpt-5.3-codex", "openai", ["low", "medium", "high", "xhigh"]],
    ["gpt-5", "openai", ["minimal", "low", "medium", "high"]],
    ["gpt-6-astra", "openai", ["low", "medium", "high", "xhigh", "max"]],
    [
      "claude-opus-4-7",
      "anthropic",
      ["none", "low", "medium", "high", "xhigh", "max"],
    ],
    [
      "claude-sonnet-4-6",
      "anthropic",
      ["none", "low", "medium", "high", "max"],
    ],
    [
      "claude-haiku-4-5-20251001",
      "anthropic",
      ["none", "low", "medium", "high", "xhigh"],
    ],
    ["deepseek-v4-pro", "anthropic", ["none", "low", "high", "max"]],
    ["deepseek-v4-flash", "openai", ["none", "low", "high", "max"]],
    ["gpt-4.1", "openai", []],
    ["unknown-model", "openai", []],
    ["claude-opus-4-9", "anthropic", []],
    ["gpt-5.4-pro", "openai", []],
  ] as const)(
    "%s exposes only its supported levels",
    (model, provider, expected) => {
      expect(
        reasoningEffortOptionsForPreset(preset(model, provider)).map(
          ([value]) => value,
        ),
      ).toEqual(expected);
    },
  );

  it("uses separate model choices before the legacy preset-wide value", () => {
    const p = preset("gpt-5.6-sol");
    p.extras = {
      reasoningEffort: "xhigh",
      reasoningEffortByModel: {
        "gpt-5.6-sol": "medium",
        "gpt-5.3-codex": "high",
      },
    };
    expect(effectiveReasoningEffort(p)).toBe("medium");
    expect(effectiveReasoningEffort({ ...p, model: "gpt-5.3-codex" })).toBe(
      "high",
    );
  });

  it("preserves the historical highest Claude and DeepSeek settings", () => {
    for (const model of ["claude-sonnet-4-6", "deepseek-v4-pro"]) {
      const p = preset(model, "anthropic");
      p.extras!.reasoningEffort = "xhigh";
      expect(effectiveReasoningEffort(p)).toBe("max");
    }
  });

  it("maps unsupported levels without changing valid choices", () => {
    expect(
      effectiveReasoningEffort({
        ...preset("gpt-5.3-codex"),
        extras: { reasoningEffort: "none" },
      }),
    ).toBe("low");
    expect(
      effectiveReasoningEffort({
        ...preset("deepseek-v4-pro"),
        extras: { reasoningEffort: "medium" },
      }),
    ).toBe("high");
    expect(
      effectiveReasoningEffort({
        ...preset("deepseek-v4-pro"),
        extras: { reasoningEffort: "low" },
      }),
    ).toBe("low");
    expect(
      effectiveReasoningEffort({
        ...preset("unknown"),
        extras: { reasoningEffort: "xhigh" },
      }),
    ).toBeUndefined();
  });
});

describe("balanced defaults", () => {
  it.each([
    ["gpt-5.6-sol", "openai", "medium"],
    ["gpt-5.3-codex", "openai", "medium"],
    ["claude-opus-4-7", "anthropic", "medium"],
    ["claude-haiku-4-5-20251001", "anthropic", "medium"],
    ["deepseek-v4-flash", "openai", "high"],
    ["deepseek-v4-pro", "anthropic", "high"],
  ] as const)("%s defaults to %s / %s", (model, provider, expected) => {
    expect(effectiveReasoningEffort(preset(model, provider))).toBe(expected);
  });
});
