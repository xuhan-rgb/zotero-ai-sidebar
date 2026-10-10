import { beforeEach as localeBeforeEach, afterEach as localeAfterEach, vi as localeVi } from "vitest";
// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import {
  createReasoningControls,
  mergeReasoningEffortByModel,
} from "../../src/modules/reasoning-controls";
import type { ModelPreset } from "../../src/settings/types";

const preset: ModelPreset = {
  id: "p1",
  label: "Test",
  provider: "openai",
  apiKey: "",
  baseUrl: "https://example.test",
  model: "gpt-5.6-sol",
  models: ["gpt-5.6-sol", "gpt-5.6-terra"],
  maxTokens: 1000,
  extras: {},
};

describe("per-model reasoning controls", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps distinct selections when models are refreshed", () => {
    const controls = createReasoningControls(document, preset, [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
    ]);
    const selects = controls.element.querySelectorAll("select");
    expect(selects[0].dataset.explicit).toBeUndefined();
    expect(selects[1].dataset.explicit).toBeUndefined();
    selects[0].value = "high";
    selects[0].dispatchEvent(new Event("change", { bubbles: true }));
    selects[1].value = "low";
    selects[1].dispatchEvent(new Event("change", { bubbles: true }));

    controls.refresh(preset, ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna"]);

    expect(controls.values()).toEqual({
      "gpt-5.6-terra": "low",
      "gpt-5.6-sol": "high",
      "gpt-5.6-luna": "medium",
    });
    expect(controls.element.querySelectorAll("select")).toHaveLength(3);
  });

  it("shows the saved effective effort after switching to Claude options", () => {
    const claude: ModelPreset = {
      ...preset,
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      model: "claude-opus-4-6",
      models: ["claude-opus-4-6"],
      extras: {
        vendor: "claude",
        reasoningEffortByModel: { "claude-opus-4-6": "xhigh" },
      },
    };
    const controls = createReasoningControls(document, preset, preset.models!);
    controls.refresh(claude, claude.models!);

    expect(controls.element.querySelector("select")!.value).toBe("max");
    expect(controls.values()).toEqual({ "claude-opus-4-6": "max" });
  });

  it("leaves an absent map absent until a selection is explicitly changed", () => {
    const untouched = mergeReasoningEffortByModel(undefined, {});
    const changed = mergeReasoningEffortByModel(undefined, {
      "gpt-5.6-sol": "high",
      "gpt-5.6-terra": "low",
    });

    expect(untouched).toBeUndefined();
    expect(changed).toEqual({
      "gpt-5.6-sol": "high",
      "gpt-5.6-terra": "low",
    });
  });

  it("marks unsupported model options as disabled service defaults", () => {
    const controls = createReasoningControls(document, preset, [
      "custom-model",
    ]);
    const select = controls.element.querySelector("select")!;
    expect(select.disabled).toBe(true);
    expect(select.options[0].textContent).toBe("服务商默认（不发送推理参数）");
    expect(controls.values()).toEqual({});
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
