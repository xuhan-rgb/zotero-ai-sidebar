import { describe, expect, it } from "vitest";
import type { PrefsStore } from "../../src/settings/storage";
import {
  DEFAULT_FULL_TRANSLATION_READING_SETTINGS,
  DEFAULT_FLOATING_PANEL_LAYOUT,
  DEFAULT_LOCAL_UI_SETTINGS,
  normalizeLocalUiSettings,
  normalizeFloatingPanelLayout,
  loadLocalUiSettings,
  saveLocalUiSettings,
  usesNativeNoteWindow,
} from "../../src/settings/local-ui-settings";

function memPrefs(): PrefsStore {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key),
    set: (key, value) => map.set(key, value),
  };
}

describe("local UI settings storage", () => {
  it("defaults and persists the note window mode", () => {
    const prefs = memPrefs();
    expect(loadLocalUiSettings(prefs).noteWindowMode).toBe("inline");
    expect(normalizeLocalUiSettings({ noteWindowMode: "invalid" }).noteWindowMode).toBe("inline");

    saveLocalUiSettings(prefs, {
      ...DEFAULT_LOCAL_UI_SETTINGS,
      noteWindowMode: "window",
    });
    expect(loadLocalUiSettings(prefs).noteWindowMode).toBe("window");
  });

  it("uses a native note window for floating mode or the window target", () => {
    for (const sidebarDisplayMode of ["embedded", "docked", "floating"] as const) {
      for (const noteWindowMode of ["inline", "window"] as const) {
        expect(usesNativeNoteWindow({ sidebarDisplayMode, noteWindowMode })).toBe(
          sidebarDisplayMode === "floating" || noteWindowMode === "window",
        );
      }
    }
    expect(usesNativeNoteWindow(undefined)).toBe(false);
  });

  it("defaults and persists docked tight comparison setting", () => {
    const prefs = memPrefs();
    expect(loadLocalUiSettings(prefs).dockedTightLayout).toBe(false);
    expect(normalizeLocalUiSettings({ dockedTightLayout: "true" }).dockedTightLayout).toBe(false);
    saveLocalUiSettings(prefs, {
      ...DEFAULT_LOCAL_UI_SETTINGS,
      dockedTightLayout: true,
    });
    expect(loadLocalUiSettings(prefs).dockedTightLayout).toBe(true);
  });

  it("defaults to automatic paper material and persists the PDF override", () => {
    const prefs = memPrefs();
    expect(loadLocalUiSettings(prefs).alwaysSendPdf).toBe(false);
    expect(normalizeLocalUiSettings({}).alwaysSendPdf).toBe(false);
    expect(
      normalizeLocalUiSettings({ alwaysSendPdf: "true" }).alwaysSendPdf,
    ).toBe(false);
    for (const alwaysSendPdf of [true, false]) {
      saveLocalUiSettings(prefs, {
        ...DEFAULT_LOCAL_UI_SETTINGS,
        alwaysSendPdf,
      });
      expect(loadLocalUiSettings(prefs).alwaysSendPdf).toBe(alwaysSendPdf);
    }
  });

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
      normalizeLocalUiSettings({ webPromptProvider: "kimi" }).webPromptProvider,
    ).toBe("kimi");
  });

  it("returns defaults for missing or invalid settings", () => {
    expect(loadLocalUiSettings(memPrefs())).toEqual(DEFAULT_LOCAL_UI_SETTINGS);
    const prefs = memPrefs();
    prefs.set("extensions.zotero-ai-sidebar.localUiSettings", "{bad");
    expect(loadLocalUiSettings(prefs)).toEqual(DEFAULT_LOCAL_UI_SETTINGS);
  });

  it("defaults legacy window pin settings and persists each pin independently", () => {
    const prefs = memPrefs();
    prefs.set(
      "extensions.zotero-ai-sidebar.localUiSettings",
      JSON.stringify({ chatFontSizePx: 14 }),
    );
    expect(loadLocalUiSettings(prefs)).toMatchObject({
      chatWindowPinned: true,
      noteWindowPinned: false,
    });

    saveLocalUiSettings(prefs, {
      ...DEFAULT_LOCAL_UI_SETTINGS,
      chatWindowPinned: false,
      noteWindowPinned: true,
    });
    expect(loadLocalUiSettings(prefs)).toMatchObject({
      chatWindowPinned: false,
      noteWindowPinned: true,
    });
    expect(
      normalizeLocalUiSettings({
        chatWindowPinned: "false",
        noteWindowPinned: 1,
      }),
    ).toMatchObject({ chatWindowPinned: true, noteWindowPinned: false });
    expect(
      normalizeLocalUiSettings({
        chatWindowPinned: false,
        noteWindowPinned: true,
      }),
    ).toMatchObject({ chatWindowPinned: false, noteWindowPinned: true });
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
        sidebarDisplayMode: "unknown-mode",
      }),
    );
    expect(loadLocalUiSettings(prefs)).toMatchObject({
      chatLayout: "classic",
      sidebarDisplayMode: "embedded",
    });
  });

  it("persists floating sidebar mode and panel geometry", () => {
    const prefs = memPrefs();
    const floatingPanels = {
      composer: { x: 24, y: 48, width: 520, height: 400 },
      answer: { x: 80, y: 96, width: 700, height: 800 },
    };
    saveLocalUiSettings(prefs, {
      ...DEFAULT_LOCAL_UI_SETTINGS,
      sidebarDisplayMode: "floating",
      floatingPanels,
    });
    expect(loadLocalUiSettings(prefs)).toMatchObject({
      sidebarDisplayMode: "floating",
      floatingPanels,
    });
  });

  it("preserves desktop positions on a monitor left of the main display", () => {
    const prefs = memPrefs();
    const floatingPanels = { ...DEFAULT_FLOATING_PANEL_LAYOUT,
      answer: { x: -1400, y: -120, width: 600, height: 680 },
    };
    saveLocalUiSettings(prefs, { ...DEFAULT_LOCAL_UI_SETTINGS, sidebarDisplayMode: "floating", floatingPanels });
    expect(loadLocalUiSettings(prefs).floatingPanels.answer).toEqual(floatingPanels.answer);
  });

  it("defaults and normalizes floating panel geometry", () => {
    expect(normalizeLocalUiSettings({}).floatingPanels).toEqual(
      DEFAULT_FLOATING_PANEL_LAYOUT,
    );
    expect(
      normalizeFloatingPanelLayout({
        composer: { x: NaN, y: Infinity, width: 319, height: 180 },
        answer: { x: 0, y: 12.5, width: 1600, height: 1401 },
      }),
    ).toEqual({
      composer: { ...DEFAULT_FLOATING_PANEL_LAYOUT.composer, height: 180 },
      answer: {
        x: 0,
        y: 12.5,
        width: 1600,
        height: DEFAULT_FLOATING_PANEL_LAYOUT.answer.height,
      },
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
