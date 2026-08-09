import { describe, expect, it } from 'vitest';
import type { PrefsStore } from '../../src/settings/storage';
import {
  DEFAULT_FULL_TRANSLATION_READING_SETTINGS,
  DEFAULT_LOCAL_UI_SETTINGS,
  loadLocalUiSettings,
  saveLocalUiSettings,
} from '../../src/settings/local-ui-settings';

function memPrefs(): PrefsStore {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key),
    set: (key, value) => map.set(key, value),
  };
}

describe('local UI settings storage', () => {
  it('returns defaults for missing or invalid settings', () => {
    expect(loadLocalUiSettings(memPrefs())).toEqual(DEFAULT_LOCAL_UI_SETTINGS);
    const prefs = memPrefs();
    prefs.set('extensions.zotero-ai-sidebar.localUiSettings', '{bad');
    expect(loadLocalUiSettings(prefs)).toEqual(DEFAULT_LOCAL_UI_SETTINGS);
  });

  it('round trips and clamps chat font size', () => {
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

  it('persists full-translation reading preferences', () => {
    const prefs = memPrefs();
    const reading = {
      ...DEFAULT_FULL_TRANSLATION_READING_SETTINGS,
      languageMode: 'translation' as const,
      layout: 'interleaved' as const,
      markerStyle: 'circled' as const,
      markerColorMode: 'single' as const,
      markerColor: '#336699',
      lineBreakMode: 'sentence-semicolon' as const,
    };

    saveLocalUiSettings(prefs, {
      ...DEFAULT_LOCAL_UI_SETTINGS,
      fullTranslationReading: reading,
    });

    expect(loadLocalUiSettings(prefs).fullTranslationReading).toEqual(reading);
  });

  it('normalizes invalid reading preferences without losing an empty custom marker', () => {
    const prefs = memPrefs();
    prefs.set(
      'extensions.zotero-ai-sidebar.localUiSettings',
      JSON.stringify({
        chatFontSizePx: 13,
        fullTranslationReading: {
          languageMode: 'invalid',
          layout: 'invalid',
          markerStyle: 'custom',
          customMarker: '',
          markerColorMode: 'invalid',
          markerColor: 'red',
          lineBreakMode: 'invalid',
        },
      }),
    );

    expect(loadLocalUiSettings(prefs).fullTranslationReading).toEqual({
      ...DEFAULT_FULL_TRANSLATION_READING_SETTINGS,
      markerStyle: 'custom',
      customMarker: '',
    });
  });
});
