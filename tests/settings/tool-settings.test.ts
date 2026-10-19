import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrefsStore } from '../../src/settings/storage';
import {
  DEFAULT_TOOL_SETTINGS,
  DEFAULT_ANNOTATION_COLOR_GUIDE,
  DEFAULT_ANNOTATION_COLOR_GUIDE_EN,
  getDefaultToolSettings,
  loadToolSettings,
  saveToolSettings,
} from '../../src/settings/tool-settings';
import { UI_LANGUAGE_PREF } from '../../src/utils/ui-locale';

function useLocale(locale: 'zh-CN' | 'en-US') {
  vi.stubGlobal('Zotero', {
    Prefs: { get: (key: string) => key === UI_LANGUAGE_PREF ? locale : undefined },
  });
}

beforeEach(() => useLocale('zh-CN'));
afterEach(() => vi.unstubAllGlobals());

function memPrefs(): PrefsStore {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key),
    set: (key, value) => map.set(key, value),
  };
}

describe('tool settings storage', () => {
  it('returns defaults for missing or invalid values', () => {
    expect(loadToolSettings(memPrefs())).toEqual(DEFAULT_TOOL_SETTINGS);
    const prefs = memPrefs();
    prefs.set('extensions.zotero-ai-sidebar.toolSettings', '{broken');
    expect(loadToolSettings(prefs)).toEqual(DEFAULT_TOOL_SETTINGS);
  });

  it('round trips configured web and arxiv MCP settings', () => {
    const prefs = memPrefs();
    saveToolSettings(prefs, {
      webSearchMode: 'live',
      mcpServers: [],
      annotationColorGuide: 'custom guide',
      arxivMcp: {
        enabled: true,
        serverLabel: 'arxiv-search',
        serverUrl: 'https://example.test/mcp',
        allowedTools: ['search', 'fetch_pdf'],
        requireApproval: 'always',
      },
    });
    expect(loadToolSettings(prefs)).toEqual({
      webSearchMode: 'live',
      mcpServers: [],
      annotationColorGuide: 'custom guide',
      textAnnotationFontSize: DEFAULT_TOOL_SETTINGS.textAnnotationFontSize,
      arxivMcp: {
        enabled: true,
        serverLabel: 'arxiv-search',
        serverUrl: 'https://example.test/mcp',
        allowedTools: ['search', 'fetch_pdf'],
        requireApproval: 'always',
      },
    });
  });

  it('normalizes malformed arxiv MCP values', () => {
    const prefs = memPrefs();
    prefs.set(
      'extensions.zotero-ai-sidebar.toolSettings',
      JSON.stringify({
        webSearchMode: 'bad',
        arxivMcp: {
          enabled: true,
          serverLabel: ' arxiv search!* ',
          serverUrl: 12,
          allowedTools: ['search', 'search', '', 'read'],
          requireApproval: 'bad',
        },
      }),
    );
    expect(loadToolSettings(prefs)).toEqual({
      webSearchMode: 'disabled',
      mcpServers: [],
      annotationColorGuide: DEFAULT_TOOL_SETTINGS.annotationColorGuide,
      textAnnotationFontSize: DEFAULT_TOOL_SETTINGS.textAnnotationFontSize,
      arxivMcp: {
        enabled: true,
        serverLabel: 'arxiv-search',
        serverUrl: '',
        allowedTools: ['search', 'read'],
        requireApproval: 'never',
      },
    });
  });

  it('clamps textAnnotationFontSize to the 8–48 range and rounds non-integers', () => {
    const prefs = memPrefs();
    prefs.set(
      'extensions.zotero-ai-sidebar.toolSettings',
      JSON.stringify({ textAnnotationFontSize: 99 }),
    );
    expect(loadToolSettings(prefs).textAnnotationFontSize).toBe(48);
    prefs.set(
      'extensions.zotero-ai-sidebar.toolSettings',
      JSON.stringify({ textAnnotationFontSize: 4 }),
    );
    expect(loadToolSettings(prefs).textAnnotationFontSize).toBe(8);
    prefs.set(
      'extensions.zotero-ai-sidebar.toolSettings',
      JSON.stringify({ textAnnotationFontSize: 16.7 }),
    );
    expect(loadToolSettings(prefs).textAnnotationFontSize).toBe(17);
    prefs.set(
      'extensions.zotero-ai-sidebar.toolSettings',
      JSON.stringify({ textAnnotationFontSize: 'oops' }),
    );
    expect(loadToolSettings(prefs).textAnnotationFontSize).toBe(
      DEFAULT_TOOL_SETTINGS.textAnnotationFontSize,
    );
  });

  it('round trips generic MCP server settings', () => {
    const prefs = memPrefs();
    saveToolSettings(prefs, {
      webSearchMode: 'disabled',
      annotationColorGuide: DEFAULT_TOOL_SETTINGS.annotationColorGuide,
      mcpServers: [
        {
          id: 'papers',
          enabled: true,
          serverLabel: 'paper-tools',
          serverUrl: 'https://example.test/mcp',
          allowedTools: ['search', 'read_pdf'],
          requireApproval: 'never',
        },
      ],
      arxivMcp: DEFAULT_TOOL_SETTINGS.arxivMcp,
    });

    expect(loadToolSettings(prefs).mcpServers).toEqual([
      {
        id: 'papers',
        enabled: true,
        serverLabel: 'paper-tools',
        serverUrl: 'https://example.test/mcp',
        allowedTools: ['search', 'read_pdf'],
        requireApproval: 'never',
      },
    ]);
  });

  it('normalizes configurable PDF annotation color guide', () => {
    const prefs = memPrefs();
    saveToolSettings(prefs, {
      ...DEFAULT_TOOL_SETTINGS,
      annotationColorGuide: 'Use #ffd400 for motivation.',
    });

    expect(loadToolSettings(prefs).annotationColorGuide).toBe(
      'Use #ffd400 for motivation.',
    );

    prefs.set(
      'extensions.zotero-ai-sidebar.toolSettings',
      JSON.stringify({ annotationColorGuide: '' }),
    );
    expect(loadToolSettings(prefs).annotationColorGuide).toBe(
      DEFAULT_TOOL_SETTINGS.annotationColorGuide,
    );
  });

  it('selects localized default guides dynamically, including saved default copies', () => {
    const prefs = memPrefs();
    expect(getDefaultToolSettings().annotationColorGuide).toBe(
      DEFAULT_ANNOTATION_COLOR_GUIDE,
    );
    prefs.set(
      'extensions.zotero-ai-sidebar.toolSettings',
      JSON.stringify({ annotationColorGuide: DEFAULT_ANNOTATION_COLOR_GUIDE }),
    );
    useLocale('en-US');
    expect(getDefaultToolSettings().annotationColorGuide).toBe(
      DEFAULT_ANNOTATION_COLOR_GUIDE_EN,
    );
    expect(loadToolSettings(prefs).annotationColorGuide).toBe(
      DEFAULT_ANNOTATION_COLOR_GUIDE_EN,
    );
    const englishDefaults = memPrefs();
    saveToolSettings(englishDefaults, getDefaultToolSettings());
    useLocale('zh-CN');
    expect(loadToolSettings(englishDefaults).annotationColorGuide).toBe(
      DEFAULT_ANNOTATION_COLOR_GUIDE,
    );
    useLocale('en-US');
    expect(loadToolSettings(memPrefs()).annotationColorGuide).toBe(
      DEFAULT_ANNOTATION_COLOR_GUIDE_EN,
    );
  });

  it('preserves edited guides when the UI locale changes', () => {
    const prefs = memPrefs();
    saveToolSettings(prefs, {
      ...getDefaultToolSettings(),
      annotationColorGuide: 'Custom guide written by the user.',
    });
    useLocale('en-US');
    expect(loadToolSettings(prefs).annotationColorGuide).toBe(
      'Custom guide written by the user.',
    );
    useLocale('zh-CN');
    expect(loadToolSettings(prefs).annotationColorGuide).toBe(
      'Custom guide written by the user.',
    );
  });
});
