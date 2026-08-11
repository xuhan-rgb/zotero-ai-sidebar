import { describe, expect, it } from "vitest";

import {
  loadFullDocumentModelSelection,
  resolveFullDocumentModelSelection,
  resolveFullDocumentTranslationConfig,
  saveFullDocumentModelSelection,
} from "../../src/translate/full-document-provider";
import type { PrefsStore } from "../../src/settings/storage";
import type { ModelPreset } from "../../src/settings/types";

function prefs(values: Record<string, string>): PrefsStore {
  return {
    get: (key) => values[key],
    set: (key, value) => {
      values[key] = value;
    },
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

  it("uses a global full-translation selection after its first override", () => {
    const secondary: ModelPreset = {
      ...preset,
      id: "preset-2",
      label: "Secondary",
      model: "secondary-model",
      models: ["secondary-model", "secondary-fast"],
    };
    const values = {
      "extensions.zotero-ai-sidebar.presets": JSON.stringify([
        preset,
        secondary,
      ]),
      "extensions.zotero-ai-sidebar.translateSettings": JSON.stringify({
        presetId: "preset-1",
        model: "translation-model",
        thinking: "low",
      }),
    };
    const store = prefs(values);

    expect(resolveFullDocumentModelSelection(store)).toMatchObject({
      selection: {
        presetId: "preset-1",
        model: "translation-model",
        thinking: "low",
      },
      inherited: true,
    });

    saveFullDocumentModelSelection(store, {
      presetId: "preset-2",
      model: "secondary-fast",
      thinking: "high",
    });

    expect(loadFullDocumentModelSelection(store)).toEqual({
      presetId: "preset-2",
      model: "secondary-fast",
      thinking: "high",
    });
    expect(resolveFullDocumentModelSelection(store)).toMatchObject({
      selection: {
        presetId: "preset-2",
        model: "secondary-fast",
        thinking: "high",
      },
      inherited: false,
    });
    expect(resolveFullDocumentTranslationConfig(store)).toMatchObject({
      preset: { id: "preset-2" },
      model: "secondary-fast",
      thinking: "high",
    });
  });

  it("falls back to the default translation model when the saved choice disappears", () => {
    const store = prefs({
      "extensions.zotero-ai-sidebar.presets": JSON.stringify([preset]),
      "extensions.zotero-ai-sidebar.translateSettings": JSON.stringify({
        presetId: "preset-1",
        model: "translation-model",
        thinking: "low",
      }),
      "extensions.zotero-ai-sidebar.fullTranslationModelSelection":
        JSON.stringify({
          presetId: "deleted-preset",
          model: "deleted-model",
          thinking: "xhigh",
        }),
    });

    expect(resolveFullDocumentModelSelection(store)).toMatchObject({
      selection: {
        presetId: "preset-1",
        model: "translation-model",
        thinking: "low",
      },
      inherited: true,
    });
  });
});
