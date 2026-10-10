import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getUiLocale,
  normalizeUiLanguage,
  UI_LANGUAGE_PREF,
  localizeStaticUi,
  resolveUiLocale,
  uiText,
} from "../../src/utils/ui-locale";

afterEach(() => vi.unstubAllGlobals());

describe("interface language selection", () => {
  it.each(["zh", "zh-CN", "zh-TW", "zh-Hant-HK", "ZH_cn"])(
    "uses Chinese for %s",
    (locale) => expect(resolveUiLocale(locale)).toBe("zh-CN"),
  );

  it.each(["en-US", "en-GB", "de-DE", "ru-RU", "fr", "ja-JP", "", undefined])(
    "uses the English fallback for %s",
    (locale) => expect(resolveUiLocale(locale)).toBe("en-US"),
  );

  it.each(["zh-CN", "en-US"])(
    "respects explicit %s over the host",
    (language) => {
      const get = vi.fn(() => language);
      vi.stubGlobal("Zotero", {
        locale: language === "zh-CN" ? "en-US" : "zh-CN",
        Prefs: { get },
      });
      expect(getUiLocale()).toBe(language);
      expect(get).toHaveBeenCalledWith(UI_LANGUAGE_PREF, true);
    },
  );

  it.each([undefined, "auto", "de-DE", null])(
    "normalizes %s to automatic",
    (value) => {
      expect(normalizeUiLanguage(value)).toBe("auto");
    },
  );

  it("uses the primary OS language instead of Zotero's UI language", () => {
    vi.stubGlobal("Zotero", { locale: "zh-CN" });
    vi.stubGlobal("Ci", { mozIOSPreferences: {} });
    const getService = vi.fn(() => ({ systemLocales: ["de-DE", "zh-CN"] }));
    vi.stubGlobal("Cc", {
      "@mozilla.org/intl/ospreferences;1": { getService },
    });
    expect(getUiLocale()).toBe("en-US");
    expect(uiText("发送", "Send")).toBe("Send");
    expect(getService).toHaveBeenCalledWith(Ci.mozIOSPreferences);
  });

  it("uses Zotero's language when the OS service is unavailable", () => {
    vi.stubGlobal("Zotero", { locale: "zh-TW" });
    vi.stubGlobal("Ci", {});
    vi.stubGlobal("Cc", {});
    expect(uiText("发送", "Send")).toBe("发送");
  });

  it("reads OS preferences from the Components object passed by bootstrap", () => {
    vi.stubGlobal("Cc", undefined);
    vi.stubGlobal("Ci", undefined);
    vi.stubGlobal("Zotero", { locale: "zh-CN" });
    vi.stubGlobal("Components", {
      classes: {
        "@mozilla.org/intl/ospreferences;1": {
          getService: () => ({ systemLocales: ["fr-FR"] }),
        },
      },
      interfaces: { mozIOSPreferences: {} },
    });
    expect(getUiLocale()).toBe("en-US");
  });

  it("defaults to English without host language information", () => {
    expect(getUiLocale()).toBe("en-US");
  });
});

describe("static interface localization", () => {
  function markup() {
    const root = document.createElement("section");
    root.innerHTML = `<label data-zai-l10n="Settings">设置</label>
      <button title="关闭" aria-label="关闭" data-zai-l10n-title="Close"
        data-zai-l10n-aria-label="Close">×</button>
      <input placeholder="输入" data-zai-l10n-placeholder="Type here" value="用户输入">
      <textarea>请用中文回答</textarea>
      <p class="reply">这是 WEB 模型的回复</p>`;
    return root;
  }

  it("translates annotated chrome while preserving input, prompts and replies", () => {
    const root = markup();
    localizeStaticUi(root);
    expect(root.querySelector("label")?.textContent).toBe("Settings");
    expect(root.querySelector("button")?.title).toBe("Close");
    expect(root.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Close",
    );
    expect(root.querySelector("input")?.placeholder).toBe("Type here");
    expect(root.querySelector("input")?.value).toBe("用户输入");
    expect(root.querySelector("textarea")?.value).toBe("请用中文回答");
    expect(root.querySelector(".reply")?.textContent).toBe(
      "这是 WEB 模型的回复",
    );
  });

  it("switches English markup back to Chinese without changing user input", () => {
    let language = "en-US";
    vi.stubGlobal("Zotero", { Prefs: { get: () => language } });
    const root = markup();
    localizeStaticUi(root);
    language = "zh-CN";
    localizeStaticUi(root);
    expect(root.querySelector("label")?.textContent).toBe("设置");
    expect(root.querySelector("button")?.title).toBe("关闭");
    expect(root.querySelector("input")?.placeholder).toBe("输入");
    expect(root.querySelector("input")?.value).toBe("用户输入");
    language = "en-US";
    localizeStaticUi(root);
    expect(root.querySelector("label")?.textContent).toBe("Settings");
  });

  it("keeps Chinese copy unchanged on a Chinese host", () => {
    vi.stubGlobal("Zotero", { locale: "zh-CN" });
    const root = markup();
    localizeStaticUi(root);
    expect(root.querySelector("label")?.textContent).toBe("设置");
    expect(root.querySelector("button")?.title).toBe("关闭");
    expect(root.querySelector("input")?.placeholder).toBe("输入");
  });
});
