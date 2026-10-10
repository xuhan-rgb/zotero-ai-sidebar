export type UiLocale = "zh-CN" | "en-US";
export type UiLanguage = "auto" | UiLocale;
export const UI_LANGUAGE_PREF =
  "extensions.zotero-ai-sidebar.interfaceLanguage";

export function normalizeUiLanguage(value: unknown): UiLanguage {
  return value === "zh-CN" || value === "en-US" ? value : "auto";
}

/** Unsupported system languages use English, including mixed preference lists. */
export function resolveUiLocale(locale: string | undefined): UiLocale {
  return /^zh(?:[-_]|$)/i.test(locale?.trim() ?? "") ? "zh-CN" : "en-US";
}

export function getUiLocale(): UiLocale {
  const language = normalizeUiLanguage(
    typeof Zotero === "undefined"
      ? undefined
      : Zotero.Prefs?.get(UI_LANGUAGE_PREF, true),
  );
  if (language !== "auto") return language;
  // mozILocaleService reports the application's language; mozIOSPreferences
  // reports the operating system's language even if Zotero was set differently.
  const classes =
    typeof Cc !== "undefined"
      ? Cc
      : typeof Components !== "undefined"
        ? (Components.classes as typeof Cc)
        : undefined;
  const interfaces =
    typeof Ci !== "undefined"
      ? Ci
      : typeof Components !== "undefined"
        ? Components.interfaces
        : undefined;
  if (classes && interfaces) {
    try {
      const preferences = classes[
        "@mozilla.org/intl/ospreferences;1"
      ].getService(interfaces.mozIOSPreferences);
      const systemLocale = preferences.systemLocales[0];
      if (systemLocale) return resolveUiLocale(systemLocale);
    } catch {
      // Older hosts may not expose OS preferences to the plugin sandbox.
    }
  }
  return resolveUiLocale(
    typeof Zotero === "undefined" ? undefined : Zotero.locale,
  );
}

/** Call only for plugin UI copy, never for prompts, paper text, or chat content. */
export function uiText(chinese: string, english: string): string {
  return getUiLocale() === "zh-CN" ? chinese : english;
}

const originalCopy = new WeakMap<Element, Map<string, string>>();

/** Translate explicitly annotated static markup without touching editable data. */
export function localizeStaticUi(root: ParentNode): void {
  const english = getUiLocale() === "en-US";
  for (const attribute of [
    "textContent",
    "title",
    "placeholder",
    "aria-label",
  ]) {
    const key =
      attribute === "textContent"
        ? "data-zai-l10n"
        : `data-zai-l10n-${attribute}`;
    for (const node of root.querySelectorAll(`[${key}]`)) {
      let originals = originalCopy.get(node);
      if (!originals) {
        originals = new Map();
        originalCopy.set(node, originals);
      }
      if (!originals.has(attribute)) {
        originals.set(
          attribute,
          attribute === "textContent"
            ? (node.textContent ?? "")
            : (node.getAttribute(attribute) ?? ""),
        );
      }
      const copy = english
        ? node.getAttribute(key)!
        : originals.get(attribute)!;
      if (attribute === "textContent") node.textContent = copy;
      else node.setAttribute(attribute, copy);
    }
  }
}
