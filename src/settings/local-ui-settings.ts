import type { PrefsStore } from "./storage";

export interface LocalUiSettings {
  chatFontSizePx: number;
  chatLayout: ChatLayout;
  chatSendMode: ChatSendMode;
  webPromptProvider: WebPromptProvider;
  hideWebBrowser: boolean;
  chatgptWeb: ChatGPTWebSettings;
  deepseekWeb: DeepSeekWebSettings;
  customWebProviders: CustomWebProvider[];
  sidebarDisplayMode: SidebarDisplayMode;
  fullTranslationReading: FullTranslationReadingSettings;
}

export type ChatLayout = "classic" | "compact";
export type ChatSendMode = "api" | "web";
export type WebPromptProvider =
  | "chatgpt"
  | "deepseek"
  | "chatglm"
  | "kimi"
  | `custom:${string}`;
export type CustomWebProviderTemplate = "chatgpt-like";
export interface CustomWebProviderSelectors {
  composer: string[];
  send: string[];
  stop: string[];
  answers: string[];
  reasoning?: string[];
  attachmentPreviews: string[];
  attachmentUploading: string[];
}
export interface CustomWebProvider {
  id: string;
  name: string;
  template: CustomWebProviderTemplate;
  homeUrl: string;
  newConversationUrl: string;
  selectors: CustomWebProviderSelectors;
}
export type ChatGPTWebReasoningEffort = "low" | "medium" | "high";
export interface ChatGPTWebSettings {
  reasoningEffort: ChatGPTWebReasoningEffort;
}
export type DeepSeekWebMode = "fast" | "expert" | "vision";
export interface DeepSeekWebSettings {
  mode: DeepSeekWebMode;
  deepThinking: boolean;
  webSearch: boolean;
}
export type SidebarDisplayMode = "embedded" | "docked";

export type FullTranslationLanguageMode =
  | "bilingual"
  | "translation"
  | "source";
export type FullTranslationReadingLayout = "parallel" | "interleaved";
export type FullTranslationMarkerStyle =
  | "slashes"
  | "circled"
  | "decimal"
  | "dot"
  | "custom"
  | "off";
export type FullTranslationMarkerColorMode = "palette" | "single";
export type FullTranslationLineBreakMode =
  | "continuous"
  | "sentence"
  | "sentence-semicolon";

export interface FullTranslationReadingSettings {
  languageMode: FullTranslationLanguageMode;
  layout: FullTranslationReadingLayout;
  markerStyle: FullTranslationMarkerStyle;
  customMarker: string;
  markerColorMode: FullTranslationMarkerColorMode;
  markerColor: string;
  lineBreakMode: FullTranslationLineBreakMode;
}

export const DEFAULT_FULL_TRANSLATION_READING_SETTINGS: FullTranslationReadingSettings =
  {
    languageMode: "bilingual",
    layout: "parallel",
    markerStyle: "slashes",
    customMarker: "//",
    markerColorMode: "palette",
    markerColor: "#a65a3a",
    lineBreakMode: "continuous",
  };

export const DEFAULT_LOCAL_UI_SETTINGS: LocalUiSettings = {
  chatFontSizePx: 13,
  chatLayout: "classic",
  chatSendMode: "api",
  webPromptProvider: "chatgpt",
  hideWebBrowser: true,
  chatgptWeb: {
    reasoningEffort: "medium",
  },
  deepseekWeb: {
    mode: "fast",
    deepThinking: true,
    webSearch: false,
  },
  customWebProviders: [],
  sidebarDisplayMode: "embedded",
  fullTranslationReading: DEFAULT_FULL_TRANSLATION_READING_SETTINGS,
};

const KEY = "extensions.zotero-ai-sidebar.localUiSettings";
const MIN_CHAT_FONT_SIZE = 11;
const MAX_CHAT_FONT_SIZE = 22;

export function loadLocalUiSettings(prefs: PrefsStore): LocalUiSettings {
  const raw = prefs.get(KEY);
  if (!raw) return DEFAULT_LOCAL_UI_SETTINGS;
  try {
    return normalizeLocalUiSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_LOCAL_UI_SETTINGS;
  }
}

export function saveLocalUiSettings(
  prefs: PrefsStore,
  settings: LocalUiSettings,
): void {
  prefs.set(KEY, JSON.stringify(normalizeLocalUiSettings(settings)));
}

export function normalizeLocalUiSettings(value: unknown): LocalUiSettings {
  const input =
    value && typeof value === "object"
      ? (value as Partial<LocalUiSettings>)
      : {};
  const legacyTarget = (input as Partial<LocalUiSettings> & {
    chatSendTarget?: unknown;
  }).chatSendTarget;
  const normalizedCustomWebProviders = normalizeCustomWebProviders(
    input.customWebProviders,
  );
  const migrateLegacyKimi = normalizedCustomWebProviders.some(
    isLegacyKimiCustomProvider,
  );
  const customWebProviders = normalizedCustomWebProviders.filter(
    (provider) => !isLegacyKimiCustomProvider(provider),
  );
  return {
    chatFontSizePx: normalizeChatFontSize(input.chatFontSizePx),
    chatLayout: oneOf(
      input.chatLayout,
      ["classic", "compact"] as const,
      DEFAULT_LOCAL_UI_SETTINGS.chatLayout,
    ),
    chatSendMode: oneOf(
      input.chatSendMode,
      ["api", "web"] as const,
      legacyTarget === "chatgpt" || legacyTarget === "deepseek"
        ? "web"
        : DEFAULT_LOCAL_UI_SETTINGS.chatSendMode,
    ),
    webPromptProvider: normalizeWebPromptProvider(
      input.webPromptProvider,
      customWebProviders,
      legacyTarget,
      migrateLegacyKimi,
    ),
    hideWebBrowser:
      typeof input.hideWebBrowser === "boolean"
        ? input.hideWebBrowser
        : DEFAULT_LOCAL_UI_SETTINGS.hideWebBrowser,
    chatgptWeb: normalizeChatGPTWebSettings(input.chatgptWeb),
    deepseekWeb: normalizeDeepSeekWebSettings(input.deepseekWeb),
    customWebProviders,
    sidebarDisplayMode: normalizeSidebarDisplayMode(input.sidebarDisplayMode),
    fullTranslationReading: normalizeFullTranslationReadingSettings(
      input.fullTranslationReading,
    ),
  };
}

function normalizeWebPromptProvider(
  value: unknown,
  customProviders: CustomWebProvider[],
  legacyTarget: unknown,
  migrateLegacyKimi = false,
): WebPromptProvider {
  if (
    value === "chatgpt" ||
    value === "deepseek" ||
    value === "chatglm" ||
    value === "kimi"
  ) {
    return value;
  }
  if (migrateLegacyKimi && value === "custom:kimi-com") return "kimi";
  if (typeof value === "string" && value.startsWith("custom:")) {
    const id = value.slice("custom:".length);
    if (customProviders.some((provider) => provider.id === id)) {
      return `custom:${id}`;
    }
  }
  return legacyTarget === "deepseek"
    ? "deepseek"
    : DEFAULT_LOCAL_UI_SETTINGS.webPromptProvider;
}

function normalizeCustomWebProviders(value: unknown): CustomWebProvider[] {
  if (!Array.isArray(value)) return [];
  const result: CustomWebProvider[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const input = candidate as Partial<CustomWebProvider>;
    const rawId = typeof input.id === "string" ? input.id : "";
    const id = rawId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
    if (
      !id ||
      seen.has(id) ||
      id === "chatgpt" ||
      id === "deepseek" ||
      id === "chatglm" ||
      id === "kimi"
    ) continue;
    const name = cleanProviderText(input.name, 80);
    const homeUrl = normalizeProviderUrl(input.homeUrl);
    const newConversationUrl = normalizeProviderUrl(
      input.newConversationUrl || input.homeUrl,
    );
    if (!name || !homeUrl || !newConversationUrl) continue;
    const rawSelectors =
      input.selectors && typeof input.selectors === "object"
        ? (input.selectors as Partial<CustomWebProviderSelectors>)
        : {};
    const selectors = {
      composer: normalizeSelectorList(rawSelectors.composer),
      send: normalizeSelectorList(rawSelectors.send),
      stop: normalizeSelectorList(rawSelectors.stop),
      answers: normalizeSelectorList(rawSelectors.answers),
      reasoning: normalizeSelectorList(rawSelectors.reasoning),
      attachmentPreviews: normalizeSelectorList(rawSelectors.attachmentPreviews),
      attachmentUploading: normalizeSelectorList(rawSelectors.attachmentUploading),
    };
    if (!selectors.composer.length || !selectors.send.length || !selectors.answers.length) {
      continue;
    }
    seen.add(id);
    result.push({
      id,
      name,
      template: "chatgpt-like",
      homeUrl,
      newConversationUrl,
      selectors,
    });
  }
  return result;
}

function isLegacyKimiCustomProvider(provider: CustomWebProvider): boolean {
  if (provider.id !== "kimi-com") return false;
  try {
    const host = new URL(provider.homeUrl).hostname.toLowerCase();
    return host === "kimi.com" || host === "www.kimi.com";
  } catch {
    return false;
  }
}

function cleanProviderText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\p{Cc}/gu, "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeProviderUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeSelectorList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const selector of value) {
    if (typeof selector !== "string") continue;
    for (const part of legacyJoinedSelectorParts(selector)) {
      const cleaned = part.replace(/\p{Cc}/gu, "").trim();
    if (
      !cleaned ||
      cleaned.length > 240 ||
      /(?:javascript:|<script|=>|\b(eval| Function|setTimeout|setInterval)\s*\()/i.test(cleaned)
    ) {
      continue;
    }
    if (!result.includes(cleaned)) result.push(cleaned);
    if (result.length >= 24) break;
    }
    if (result.length >= 24) break;
  }
  return result;
}

function legacyJoinedSelectorParts(selector: string): string[] {
  const joinedDefaults: Record<string, string[]> = {
    "textarea[contenteditable='true']": ["textarea", "[contenteditable='true']"],
    "button[type='submit']button[aria-label*='Send']button[aria-label*='发送']": [
      "button[type='submit']",
      "button[aria-label*='Send']",
      "button[aria-label*='发送']",
    ],
    "button[aria-label*='Stop']button[aria-label*='停止']": [
      "button[aria-label*='Stop']",
      "button[aria-label*='停止']",
    ],
    "[data-message-author-role='assistant']article": [
      "[data-message-author-role='assistant']",
      "article",
    ],
    "[class*='attachment'][class*='file']": [
      "[class*='attachment']",
      "[class*='file']",
    ],
    "[role='progressbar'][aria-busy='true']": [
      "[role='progressbar']",
      "[aria-busy='true']",
    ],
  };
  return joinedDefaults[selector.trim()] || [selector];
}

function normalizeChatGPTWebSettings(value: unknown): ChatGPTWebSettings {
  const input =
    value && typeof value === "object"
      ? (value as Partial<ChatGPTWebSettings>)
      : {};
  return {
    reasoningEffort: oneOf(
      input.reasoningEffort,
      ["low", "medium", "high"] as const,
      DEFAULT_LOCAL_UI_SETTINGS.chatgptWeb.reasoningEffort,
    ),
  };
}

function normalizeDeepSeekWebSettings(value: unknown): DeepSeekWebSettings {
  const input =
    value && typeof value === "object"
      ? (value as Partial<DeepSeekWebSettings>)
      : {};
  return {
    // DeepSeek Expert mode currently rejects paper attachments. Keep the
    // persisted type for compatibility, but migrate it to Fast until file
    // upload is supported by the Web product.
    mode:
      input.mode === "expert"
        ? "fast"
        : oneOf(
            input.mode,
            ["fast", "vision"] as const,
            DEFAULT_LOCAL_UI_SETTINGS.deepseekWeb.mode,
          ),
    deepThinking:
      typeof input.deepThinking === "boolean"
        ? input.deepThinking
        : DEFAULT_LOCAL_UI_SETTINGS.deepseekWeb.deepThinking,
    webSearch:
      typeof input.webSearch === "boolean"
        ? input.webSearch
        : DEFAULT_LOCAL_UI_SETTINGS.deepseekWeb.webSearch,
  };
}

function normalizeSidebarDisplayMode(value: unknown): SidebarDisplayMode {
  if (value === "docked" || value === "companion") return "docked";
  return DEFAULT_LOCAL_UI_SETTINGS.sidebarDisplayMode;
}

export function normalizeFullTranslationReadingSettings(
  value: unknown,
): FullTranslationReadingSettings {
  const input =
    value && typeof value === "object"
      ? (value as Partial<FullTranslationReadingSettings>)
      : {};
  return {
    languageMode: oneOf(
      input.languageMode,
      ["bilingual", "translation", "source"] as const,
      DEFAULT_FULL_TRANSLATION_READING_SETTINGS.languageMode,
    ),
    layout: oneOf(
      input.layout,
      ["parallel", "interleaved"] as const,
      DEFAULT_FULL_TRANSLATION_READING_SETTINGS.layout,
    ),
    markerStyle: oneOf(
      input.markerStyle,
      ["slashes", "circled", "decimal", "dot", "custom", "off"] as const,
      DEFAULT_FULL_TRANSLATION_READING_SETTINGS.markerStyle,
    ),
    customMarker: normalizeMarker(input.customMarker),
    markerColorMode: oneOf(
      input.markerColorMode,
      ["palette", "single"] as const,
      DEFAULT_FULL_TRANSLATION_READING_SETTINGS.markerColorMode,
    ),
    markerColor:
      typeof input.markerColor === "string" &&
      /^#[0-9a-f]{6}$/i.test(input.markerColor)
        ? input.markerColor.toLowerCase()
        : DEFAULT_FULL_TRANSLATION_READING_SETTINGS.markerColor,
    lineBreakMode: oneOf(
      input.lineBreakMode,
      ["continuous", "sentence", "sentence-semicolon"] as const,
      DEFAULT_FULL_TRANSLATION_READING_SETTINGS.lineBreakMode,
    ),
  };
}

function normalizeChatFontSize(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric))
    return DEFAULT_LOCAL_UI_SETTINGS.chatFontSizePx;
  return Math.max(
    MIN_CHAT_FONT_SIZE,
    Math.min(MAX_CHAT_FONT_SIZE, Math.round(numeric)),
  );
}

function normalizeMarker(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_FULL_TRANSLATION_READING_SETTINGS.customMarker;
  }
  const cleaned = value
    .replace(/\p{Cc}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(cleaned).slice(0, 8).join("");
}

function oneOf<const T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && options.includes(value as T)
    ? (value as T)
    : fallback;
}
