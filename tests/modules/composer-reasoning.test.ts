import { beforeEach as localeBeforeEach, afterEach as localeAfterEach, vi as localeVi } from "vitest";
import { describe, expect, it, vi } from "vitest";
import { renderComposerReasoningSelect } from "../../src/modules/composer-reasoning";
import { effectiveReasoningEffort } from "../../src/settings/reasoning";
import { loadPresets, savePresets } from "../../src/settings/storage";
import type { ModelPreset } from "../../src/settings/types";

const preset: ModelPreset = {
  id: "deepseek",
  label: "deepseek1",
  provider: "openai",
  apiKey: "test",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  maxTokens: 32768,
  extras: { reasoningEffort: "xhigh" },
};

describe("composer reasoning selector", () => {
  it("shows native DeepSeek options and persists a changed selection for this model", () => {
    const values = new Map<string, string>();
    const prefs = {
      get: (key: string) => values.get(key),
      set: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const onChange = (next: ModelPreset) => savePresets(prefs, [next]);
    const root = renderComposerReasoningSelect(
      document,
      preset,
      false,
      onChange,
    );
    const select = root.querySelector("select")!;
    expect(root.querySelector("span")).toBeNull();
    expect(select.getAttribute("aria-label")).toBe("推理强度");
    expect(Array.from(select.options, (option) => option.value)).toEqual([
      "none",
      "low",
      "high",
      "max",
    ]);
    expect(select.value).toBe("high");
    select.value = "low";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const saved = loadPresets(prefs)[0];
    expect(effectiveReasoningEffort(saved)).toBe("low");
    expect(
      renderComposerReasoningSelect(
        document,
        saved,
        false,
        onChange,
      ).querySelector("select")!.value,
    ).toBe("low");
  });

  it("changes the available range with the selected model and preserves other choices", () => {
    const onChange = vi.fn();
    const configured: ModelPreset = {
      ...preset,
      model: "gpt-5.6-sol",
      extras: {
        reasoningEffortByModel: {
          "deepseek-v4-flash": "max",
          "gpt-5.6-sol": "medium",
        },
      },
    };
    const select = renderComposerReasoningSelect(
      document,
      configured,
      false,
      onChange,
    ).querySelector("select")!;
    expect(select.value).toBe("medium");
    expect(Array.from(select.options, (option) => option.value)).toContain(
      "xhigh",
    );
    select.value = "max";
    select.dispatchEvent(new Event("change"));
    expect(onChange.mock.calls[0][0].extras.reasoningEffortByModel).toEqual({
      "deepseek-v4-flash": "max",
      "gpt-5.6-sol": "max",
    });
  });

  it("disables changes while sending and uses service default for unknown models", () => {
    const onChange = vi.fn();
    const busy = renderComposerReasoningSelect(
      document,
      preset,
      true,
      onChange,
    ).querySelector("select")!;
    expect(busy.disabled).toBe(true);
    busy.dispatchEvent(new Event("change"));
    expect(onChange).not.toHaveBeenCalled();
    const unknown = renderComposerReasoningSelect(
      document,
      { ...preset, model: "custom" },
      false,
      onChange,
    ).querySelector("select")!;
    expect(unknown.disabled).toBe(true);
    expect(unknown.textContent).toBe("服务商默认");
  });
});

// These regression cases exercise the existing Chinese interface.
localeBeforeEach(() => {
  localeVi.stubGlobal("Cc", {
    "@mozilla.org/intl/ospreferences;1": {
      getService: () => ({ systemLocales: ["zh-CN"] }),
    },
  });
  localeVi.stubGlobal("Ci", { mozIOSPreferences: {} });
});
localeAfterEach(() => localeVi.unstubAllGlobals());
