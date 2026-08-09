import { describe, expect, it } from "vitest";

import { resolveFullDocumentTranslationConfig } from "../../src/translate/full-document-provider";
import type { PrefsStore } from "../../src/settings/storage";
import type { ModelPreset } from "../../src/settings/types";

function prefs(values: Record<string, string>): PrefsStore {
  return {
    get: (key) => values[key],
    set: () => undefined,
  };
}

const preset: ModelPreset = {
  id: "preset-1",
  label: "Primary",
  provider: "openai",
  apiKey: "test-key",
  baseUrl: "https://example.invalid/v1",
  model: "preset-model",
  models: ["preset-model", "translation-model"],
  maxTokens: 8192,
  extras: {},
};

describe("resolveFullDocumentTranslationConfig", () => {
  it("reuses the configured translation preset, model, and thinking level", () => {
    const store = prefs({
      "extensions.zotero-ai-sidebar.presets": JSON.stringify([preset]),
      "extensions.zotero-ai-sidebar.translateSettings": JSON.stringify({
        enabled: true,
        presetId: "preset-1",
        model: "translation-model",
        thinking: "low",
      }),
    });

    expect(resolveFullDocumentTranslationConfig(store)).toMatchObject({
      preset: { id: "preset-1" },
      model: "translation-model",
      thinking: "low",
    });
  });

  it("requires an available account preset", () => {
    expect(() => resolveFullDocumentTranslationConfig(prefs({}))).toThrow(
      "请先在设置中配置一个账号。",
    );
  });
});
