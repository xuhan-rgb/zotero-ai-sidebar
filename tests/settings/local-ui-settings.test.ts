import { describe, expect, it } from "vitest";
import type { PrefsStore } from "../../src/settings/storage";
import {
  DEFAULT_FULL_TRANSLATION_READING_SETTINGS,
  DEFAULT_LOCAL_UI_SETTINGS,
  normalizeLocalUiSettings,
  loadLocalUiSettings,
  saveLocalUiSettings,
} from "../../src/settings/local-ui-settings";

function memPrefs(): PrefsStore {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key),
    set: (key, value) => map.set(key, value),
  };
}

describe("local UI settings storage", () => {
  it("keeps ChatGLM as a built-in WEB provider", () => {
    expect(
      normalizeLocalUiSettings({
        chatSendMode: "web",
        webPromptProvider: "chatglm",
      }).webPromptProvider,
    ).toBe("chatglm");
  });

  it("persists Z.ai independently of the domestic GLM provider", () => {
    const prefs = memPrefs();
    saveLocalUiSettings(
      prefs,
      normalizeLocalUiSettings({
        chatSendMode: "web",
        webPromptProvider: "zai",
      }),
    );
    expect(loadLocalUiSettings(prefs).webPromptProvider).toBe("zai");
    expect(
      normalizeLocalUiSettings({ webPromptProvider: "chatglm" })
        .webPromptProvider,
    ).toBe("chatglm");
  });

  it("keeps Kimi as a built-in WEB provider and migrates the former custom entry", () => {
    const settings = normalizeLocalUiSettings({
      chatSendMode: "web",
      webPromptProvider: "custom:kimi-com",
      customWebProviders: [
        {
          id: "kimi-com",
          name: "kimi.com",
          template: "chatgpt-like",
          homeUrl: "https://www.kimi.com/",
          newConversationUrl: "https://www.kimi.com/",
          selectors: {
            composer: ["[contenteditable='true']"],
            send: ["button[type='submit']"],
            stop: [],
            answers: ["article"],
            attachmentPreviews: [],
            attachmentUploading: [],
          },
        },
      ],
    });
    expect(settings.webPromptProvider).toBe("kimi");
    expect(settings.customWebProviders).toEqual([]);
    expect(
      normalizeLocalUiSettings({ webPromptProvider: "kimi" })
        .webPromptProvider,
    ).toBe("kimi");
  });

  it("returns defaults for missing or invalid settings", () => {
    expect(loadLocalUiSettings(memPrefs())).toEqual(DEFAULT_LOCAL_UI_SETTINGS);
    const prefs = memPrefs();
    prefs.set("extensions.zotero-ai-sidebar.localUiSettings", "{bad");
    expect(loadLocalUiSettings(prefs)).toEqual(DEFAULT_LOCAL_UI_SETTINGS);
  });

  it("round trips and clamps chat font size", () => {
    const prefs = memPrefs();
    saveLocalUiSettings(prefs, {
      ...DEFAULT_LOCAL_UI_SETTINGS,
      chatFontSizePx: 16,
    });
    expect(loadLocalUiSettings(prefs).chatFontSizePx).toBe(16);

    saveLocalUiSettings(prefs, {
      ...DEFAULT_LOCAL_UI_SETTINGS,
      chatFontSizePx: 99,
    });
    expect(loadLocalUiSettings(prefs).chatFontSizePx).toBe(22);

    saveLocalUiSettings(prefs, {
      ...DEFAULT_LOCAL_UI_SETTINGS,
      chatFontSizePx: 1,
    });
    expect(loadLocalUiSettings(prefs).chatFontSizePx).toBe(11);
  });

  it("defaults to the classic embedded layout and persists explicit alternatives", () => {
    const prefs = memPrefs();
    expect(loadLocalUiSettings(prefs)).toMatchObject({
      chatLayout: "classic",
      sidebarDisplayMode: "embedded",
    });

    saveLocalUiSettings(prefs, {
      ...DEFAULT_LOCAL_UI_SETTINGS,
      chatLayout: "compact",
      sidebarDisplayMode: "docked",
    });
    expect(loadLocalUiSettings(prefs)).toMatchObject({
      chatLayout: "compact",
      sidebarDisplayMode: "docked",
    });

    prefs.set(
      "extensions.zotero-ai-sidebar.localUiSettings",
      JSON.stringify({ sidebarDisplayMode: "companion" }),
    );
    expect(loadLocalUiSettings(prefs).sidebarDisplayMode).toBe("docked");

    prefs.set(
      "extensions.zotero-ai-sidebar.localUiSettings",
      JSON.stringify({
        chatLayout: "unknown",
        sidebarDisplayMode: "floating",
      }),
    );
    expect(loadLocalUiSettings(prefs)).toMatchObject({
      chatLayout: "classic",
      sidebarDisplayMode: "embedded",
    });
  });

  it("persists API/WEB mode and the selected web provider", () => {
    const prefs = memPrefs();
    saveLocalUiSettings(prefs, {
      ...DEFAULT_LOCAL_UI_SETTINGS,
      chatSendMode: "web",
      webPromptProvider: "deepseek",
    });
    expect(loadLocalUiSettings(prefs)).toMatchObject({
      chatSendMode: "web",
      webPromptProvider: "deepseek",
    });

    prefs.set(
      "extensions.zotero-ai-sidebar.localUiSettings",
      JSON.stringify({ chatSendMode: "unknown", webPromptProvider: "unknown" }),
    );
    expect(loadLocalUiSettings(prefs)).toMatchObject({
      chatSendMode: "api",
      webPromptProvider: "chatgpt",
    });
  });

  it("persists and normalizes DeepSeek Web controls", () => {
    const prefs = memPrefs();
    saveLocalUiSettings(prefs, {
      ...DEFAULT_LOCAL_UI_SETTINGS,
      deepseekWeb: {
        mode: "vision",
        deepThinking: false,
        webSearch: true,
      },
    });
    expect(loadLocalUiSettings(prefs).deepseekWeb).toEqual({
      mode: "vision",
      deepThinking: false,
      webSearch: true,
    });

    prefs.set(
      "extensions.zotero-ai-sidebar.localUiSettings",
      JSON.stringify({
        deepseekWeb: {
          mode: "unknown",
          deepThinking: "yes",
          webSearch: 1,
        },
      }),
    );
    expect(loadLocalUiSettings(prefs).deepseekWeb).toEqual(
      DEFAULT_LOCAL_UI_SETTINGS.deepseekWeb,
    );
  });

  it("persists ChatGPT Web reasoning strength independently", () => {
    const prefs = memPrefs();
    saveLocalUiSettings(prefs, {
      ...DEFAULT_LOCAL_UI_SETTINGS,
      chatgptWeb: { reasoningEffort: "high" },
    });
    expect(loadLocalUiSettings(prefs).chatgptWeb).toEqual({
      reasoningEffort: "high",
    });

    prefs.set(
      "extensions.zotero-ai-sidebar.localUiSettings",
      JSON.stringify({ chatgptWeb: { reasoningEffort: "unknown" } }),
    );
    expect(loadLocalUiSettings(prefs).chatgptWeb).toEqual(
      DEFAULT_LOCAL_UI_SETTINGS.chatgptWeb,
    );
  });

  it("migrates the temporarily unsupported DeepSeek expert mode to fast", () => {
    const prefs = memPrefs();
    prefs.set(
      "extensions.zotero-ai-sidebar.localUiSettings",
      JSON.stringify({
        deepseekWeb: {
          mode: "expert",
          deepThinking: true,
          webSearch: false,
        },
      }),
    );
    expect(loadLocalUiSettings(prefs).deepseekWeb.mode).toBe("fast");
  });

  it("migrates the former combined send target", () => {
    const prefs = memPrefs();
    prefs.set(
      "extensions.zotero-ai-sidebar.localUiSettings",
      JSON.stringify({ chatSendTarget: "deepseek" }),
    );
    expect(loadLocalUiSettings(prefs)).toMatchObject({
      chatSendMode: "web",
      webPromptProvider: "deepseek",
    });
  });

  it("normalizes custom ChatGPT-like Web providers and keeps invalid selectors out", () => {
    const settings = normalizeLocalUiSettings({
      customWebProviders: [
        {
          id: "paper-site",
          name: " Paper Site ",
          template: "chatgpt-like",
          homeUrl: "https://example.com/chat",
          newConversationUrl: "https://example.com/chat/new",
          selectors: {
            composer: [" textarea ", "textarea", "javascript:alert(1)"],
            send: ["button.send"],
            stop: [],
            answers: [".answer"],
            reasoning: [],
            attachmentPreviews: [".file"],
            attachmentUploading: [".loading"],
          },
        },
        {
          id: "chatgpt",
          name: "Collision",
          template: "chatgpt-like",
          homeUrl: "https://bad.example",
          newConversationUrl: "https://bad.example/new",
          selectors: {
            composer: ["textarea"],
            send: ["button"],
            stop: [],
            answers: [".answer"],
            attachmentPreviews: [],
            attachmentUploading: [],
          },
        },
      ],
    });
    expect(settings.customWebProviders).toHaveLength(1);
    expect(settings.customWebProviders[0]).toMatchObject({
      id: "paper-site",
      name: "Paper Site",
      homeUrl: "https://example.com/chat",
      newConversationUrl: "https://example.com/chat/new",
    });
    expect(settings.customWebProviders[0].selectors.composer).toEqual([
      "textarea",
    ]);
    expect(
      normalizeLocalUiSettings({
        webPromptProvider: "custom:paper-site",
        customWebProviders: settings.customWebProviders,
      }).webPromptProvider,
    ).toBe("custom:paper-site");
  });

  it("migrates custom selector defaults concatenated by the legacy prompt dialog", () => {
    const settings = normalizeLocalUiSettings({
      webPromptProvider: "custom:sorryios",
      customWebProviders: [
        {
          id: "sorryios",
          name: "sorryios",
          template: "chatgpt-like",
          homeUrl: "https://sorryios.ai/",
          newConversationUrl: "https://sorryios.ai/",
          selectors: {
            composer: ["textarea[contenteditable='true']"],
            send: [
              "button[type='submit']button[aria-label*='Send']button[aria-label*='发送']",
            ],
            stop: ["button[aria-label*='Stop']button[aria-label*='停止']"],
            answers: ["[data-message-author-role='assistant']article"],
            attachmentPreviews: ["[class*='attachment'][class*='file']"],
            attachmentUploading: [
              "[role='progressbar'][aria-busy='true']",
            ],
          },
        },
      ],
    });
    expect(settings.webPromptProvider).toBe("custom:sorryios");
    expect(settings.customWebProviders[0].selectors.composer).toEqual([
      "textarea",
      "[contenteditable='true']",
    ]);
    expect(settings.customWebProviders[0].selectors.send).toEqual([
      "button[type='submit']",
      "button[aria-label*='Send']",
      "button[aria-label*='发送']",
    ]);
  });

  it("persists full-translation reading preferences", () => {
    const prefs = memPrefs();
    const reading = {
      ...DEFAULT_FULL_TRANSLATION_READING_SETTINGS,
      languageMode: "translation" as const,
      layout: "interleaved" as const,
      markerStyle: "circled" as const,
      markerColorMode: "single" as const,
      markerColor: "#336699",
      lineBreakMode: "sentence-semicolon" as const,
    };

    saveLocalUiSettings(prefs, {
      ...DEFAULT_LOCAL_UI_SETTINGS,
      fullTranslationReading: reading,
    });

    expect(loadLocalUiSettings(prefs).fullTranslationReading).toEqual(reading);
  });

  it("normalizes invalid reading preferences without losing an empty custom marker", () => {
    const prefs = memPrefs();
    prefs.set(
      "extensions.zotero-ai-sidebar.localUiSettings",
      JSON.stringify({
        chatFontSizePx: 13,
        fullTranslationReading: {
          languageMode: "invalid",
          layout: "invalid",
          markerStyle: "custom",
          customMarker: "",
          markerColorMode: "invalid",
          markerColor: "red",
          lineBreakMode: "invalid",
        },
      }),
    );

    expect(loadLocalUiSettings(prefs).fullTranslationReading).toEqual({
      ...DEFAULT_FULL_TRANSLATION_READING_SETTINGS,
      markerStyle: "custom",
      customMarker: "",
    });
  });
});
