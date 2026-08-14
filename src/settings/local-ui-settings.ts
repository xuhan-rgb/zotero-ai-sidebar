import type { PrefsStore } from './storage';

export interface LocalUiSettings {
  chatFontSizePx: number;
  chatLayout: ChatLayout;
  sidebarDisplayMode: SidebarDisplayMode;
  fullTranslationReading: FullTranslationReadingSettings;
}

export type ChatLayout = 'classic' | 'compact';
export type SidebarDisplayMode = 'embedded' | 'docked';

export type FullTranslationLanguageMode =
  | 'bilingual'
  | 'translation'
  | 'source';
export type FullTranslationReadingLayout = 'parallel' | 'interleaved';
export type FullTranslationMarkerStyle =
  | 'slashes'
  | 'circled'
  | 'decimal'
  | 'dot'
  | 'custom'
  | 'off';
export type FullTranslationMarkerColorMode = 'palette' | 'single';
export type FullTranslationLineBreakMode =
  | 'continuous'
  | 'sentence'
  | 'sentence-semicolon';

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
    languageMode: 'bilingual',
    layout: 'parallel',
    markerStyle: 'slashes',
    customMarker: '//',
    markerColorMode: 'palette',
    markerColor: '#a65a3a',
    lineBreakMode: 'continuous',
  };

export const DEFAULT_LOCAL_UI_SETTINGS: LocalUiSettings = {
  chatFontSizePx: 13,
  chatLayout: 'classic',
  sidebarDisplayMode: 'embedded',
  fullTranslationReading: DEFAULT_FULL_TRANSLATION_READING_SETTINGS,
};

const KEY = 'extensions.zotero-ai-sidebar.localUiSettings';
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
    value && typeof value === 'object'
      ? (value as Partial<LocalUiSettings>)
      : {};
  return {
    chatFontSizePx: normalizeChatFontSize(input.chatFontSizePx),
    chatLayout: oneOf(
      input.chatLayout,
      ['classic', 'compact'] as const,
      DEFAULT_LOCAL_UI_SETTINGS.chatLayout,
    ),
    sidebarDisplayMode: normalizeSidebarDisplayMode(input.sidebarDisplayMode),
    fullTranslationReading: normalizeFullTranslationReadingSettings(
      input.fullTranslationReading,
    ),
  };
}

function normalizeSidebarDisplayMode(value: unknown): SidebarDisplayMode {
  if (value === 'docked' || value === 'companion') return 'docked';
  return DEFAULT_LOCAL_UI_SETTINGS.sidebarDisplayMode;
}

export function normalizeFullTranslationReadingSettings(
  value: unknown,
): FullTranslationReadingSettings {
  const input =
    value && typeof value === 'object'
      ? (value as Partial<FullTranslationReadingSettings>)
      : {};
  return {
    languageMode: oneOf(
      input.languageMode,
      ['bilingual', 'translation', 'source'] as const,
      DEFAULT_FULL_TRANSLATION_READING_SETTINGS.languageMode,
    ),
    layout: oneOf(
      input.layout,
      ['parallel', 'interleaved'] as const,
      DEFAULT_FULL_TRANSLATION_READING_SETTINGS.layout,
    ),
    markerStyle: oneOf(
      input.markerStyle,
      ['slashes', 'circled', 'decimal', 'dot', 'custom', 'off'] as const,
      DEFAULT_FULL_TRANSLATION_READING_SETTINGS.markerStyle,
    ),
    customMarker: normalizeMarker(input.customMarker),
    markerColorMode: oneOf(
      input.markerColorMode,
      ['palette', 'single'] as const,
      DEFAULT_FULL_TRANSLATION_READING_SETTINGS.markerColorMode,
    ),
    markerColor:
      typeof input.markerColor === 'string' &&
      /^#[0-9a-f]{6}$/i.test(input.markerColor)
        ? input.markerColor.toLowerCase()
        : DEFAULT_FULL_TRANSLATION_READING_SETTINGS.markerColor,
    lineBreakMode: oneOf(
      input.lineBreakMode,
      ['continuous', 'sentence', 'sentence-semicolon'] as const,
      DEFAULT_FULL_TRANSLATION_READING_SETTINGS.lineBreakMode,
    ),
  };
}

function normalizeChatFontSize(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric))
    return DEFAULT_LOCAL_UI_SETTINGS.chatFontSizePx;
  return Math.max(
    MIN_CHAT_FONT_SIZE,
    Math.min(MAX_CHAT_FONT_SIZE, Math.round(numeric)),
  );
}

function normalizeMarker(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_FULL_TRANSLATION_READING_SETTINGS.customMarker;
  }
  const cleaned = value
    .replace(/\p{Cc}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, 8).join('');
}

function oneOf<const T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && options.includes(value as T)
    ? (value as T)
    : fallback;
}
