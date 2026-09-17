import { beforeEach, describe, expect, it } from 'vitest';
import type { PrefsStore } from '../../src/settings/storage';
import {
  DEFAULT_QUICK_PROMPT_SETTINGS,
  flushQuickPromptSettings,
  hydrateQuickPromptSettings,
  loadQuickPromptSettings,
  quickPromptsPath,
  resetQuickPromptSettingsCache,
  saveQuickPromptSettings,
} from '../../src/settings/quick-prompts';

const PREF_KEY = 'extensions.zotero-ai-sidebar.quickPrompts';

function memPrefs(): PrefsStore {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key),
    set: (key, value) => map.set(key, value),
    clear: (key) => {
      map.delete(key);
    },
  };
}

beforeEach(() => {
  resetQuickPromptSettingsCache();
  Reflect.deleteProperty(globalThis, 'Zotero');
});

describe('quick prompt settings storage', () => {
  it('returns defaults for missing or invalid settings', () => {
    expect(loadQuickPromptSettings(memPrefs())).toEqual(
      DEFAULT_QUICK_PROMPT_SETTINGS,
    );
    const prefs = memPrefs();
    prefs.set(PREF_KEY, '{bad');
    expect(loadQuickPromptSettings(prefs)).toEqual(
      DEFAULT_QUICK_PROMPT_SETTINGS,
    );
  });

  it('round trips edited built-ins and custom buttons', () => {
    const prefs = memPrefs();
    saveQuickPromptSettings(prefs, {
      builtIns: {
        summary: 'summary prompt',
        readingRoute: 'route prompt',
        fullTextHighlight: 'highlight prompt',
        explainSelection: 'explain prompt',
      },
      selectionQuestionAnnotationEnabled: true,
      customButtons: [
        { id: 'method', label: '方法', prompt: '总结方法', shortcut: 't' },
      ],
    });

    expect(loadQuickPromptSettings(prefs)).toEqual({
      builtIns: {
        summary: 'summary prompt',
        readingRoute: 'route prompt',
        fullTextHighlight: 'highlight prompt',
        explainSelection: 'explain prompt',
      },
      selectionQuestionAnnotationEnabled: true,
      customButtons: [
        { id: 'method', label: '方法', prompt: '总结方法', shortcut: 't' },
      ],
    });
  });

  it('drops custom buttons without prompt and falls back for empty built-ins', () => {
    const prefs = memPrefs();
    prefs.set(
      PREF_KEY,
      JSON.stringify({
        builtIns: {
          summary: '',
          readingRoute: 'route',
          fullTextHighlight: 'x',
          explainSelection: 'y',
        },
        // Non-boolean garbage: with the new "default on unless explicit
        // false" rule, anything that isn't === false is treated as on.
        selectionQuestionAnnotationEnabled: 'yes',
        customButtons: [
          { id: 'bad', label: '空提示词', prompt: '' },
          { id: 'nameless-bad', label: '', prompt: 'No trigger' },
          { id: 'ok', label: 'OK', prompt: 'Do it', shortcut: 'Enter' },
        ],
      }),
    );

    const settings = loadQuickPromptSettings(prefs);
    expect(settings.builtIns.summary).toBe(
      DEFAULT_QUICK_PROMPT_SETTINGS.builtIns.summary,
    );
    expect(settings.builtIns.readingRoute).toBe('route');
    expect(settings.selectionQuestionAnnotationEnabled).toBe(true);
    expect(settings.customButtons).toEqual([
      { id: 'ok', label: 'OK', prompt: 'Do it' },
    ]);
  });

  it('backfills the reading route prompt for legacy built-ins', () => {
    const prefs = memPrefs();
    prefs.set(
      PREF_KEY,
      JSON.stringify({
        builtIns: {
          summary: 'summary',
          fullTextHighlight: 'highlight',
          explainSelection: 'explain',
        },
      }),
    );

    expect(loadQuickPromptSettings(prefs).builtIns.readingRoute).toBe(
      DEFAULT_QUICK_PROMPT_SETTINGS.builtIns.readingRoute,
    );
  });

  it('keeps an explicit `false` for selectionQuestionAnnotationEnabled', () => {
    const prefs = memPrefs();
    prefs.set(
      PREF_KEY,
      JSON.stringify({ selectionQuestionAnnotationEnabled: false }),
    );
    expect(loadQuickPromptSettings(prefs).selectionQuestionAnnotationEnabled).toBe(
      false,
    );
  });

  it('defaults selectionQuestionAnnotationEnabled to true on a fresh profile', () => {
    expect(
      loadQuickPromptSettings(memPrefs()).selectionQuestionAnnotationEnabled,
    ).toBe(true);
  });

  it('keeps only unique single-key custom shortcuts', () => {
    const prefs = memPrefs();
    saveQuickPromptSettings(prefs, {
      ...DEFAULT_QUICK_PROMPT_SETTINGS,
      customButtons: [
        { id: 'translate', label: '翻译', prompt: '翻译选区', shortcut: 'T' },
        { id: 'dup', label: '重复', prompt: '重复', shortcut: 't' },
        { id: 'num', label: '数字', prompt: '数字', shortcut: '1' },
      ],
    });

    expect(loadQuickPromptSettings(prefs).customButtons).toEqual([
      { id: 'translate', label: '翻译', prompt: '翻译选区', shortcut: 't' },
      { id: 'dup', label: '重复', prompt: '重复' },
      { id: 'num', label: '数字', prompt: '数字', shortcut: '1' },
    ]);
  });

  it('allows shortcut-only prompts without rendering a button label', () => {
    const prefs = memPrefs();
    saveQuickPromptSettings(prefs, {
      ...DEFAULT_QUICK_PROMPT_SETTINGS,
      customButtons: [
        { id: 'translate-key', label: '', prompt: '翻译选区', shortcut: 't' },
      ],
    });

    expect(loadQuickPromptSettings(prefs).customButtons).toEqual([
      { id: 'translate-key', label: '', prompt: '翻译选区', shortcut: 't' },
    ]);
  });

  it('migrates the old annotation suggestion switch name', () => {
    const prefs = memPrefs();
    prefs.set(
      PREF_KEY,
      JSON.stringify({ annotationSuggestionColorEnabled: true }),
    );

    expect(loadQuickPromptSettings(prefs).selectionQuestionAnnotationEnabled).toBe(
      true,
    );
  });
});

describe('quick prompt file storage', () => {
  let files: Map<string, string>;

  function installFileBackend(options?: {
    writeError?: Error;
  }): void {
    files = new Map();
    Object.defineProperty(globalThis, 'Zotero', {
      configurable: true,
      value: {
        DataDirectory: { dir: '/tmp/zotero-data' },
        Profile: { dir: '/tmp/zotero-profile' },
        File: {
          getContentsAsync: async (path: string) => {
            const value = files.get(path);
            if (value == null) throw new Error(`missing file: ${path}`);
            return value;
          },
          putContentsAsync: async (path: string, contents: string) => {
            if (options?.writeError) throw options.writeError;
            files.set(path, contents);
          },
        },
      },
    });
  }

  it('writes settings to the data directory and does not keep the prefs blob', async () => {
    installFileBackend();
    const prefs = memPrefs();
    saveQuickPromptSettings(prefs, {
      ...DEFAULT_QUICK_PROMPT_SETTINGS,
      builtIns: {
        ...DEFAULT_QUICK_PROMPT_SETTINGS.builtIns,
        summary: 'file summary',
      },
    });
    await flushQuickPromptSettings();

    expect(prefs.get(PREF_KEY)).toBeUndefined();
    expect(files.get(quickPromptsPath())).toContain('file summary');
    expect(loadQuickPromptSettings(prefs).builtIns.summary).toBe('file summary');
  });

  it('migrates a legacy prefs blob onto disk then clears the preference', async () => {
    installFileBackend();
    const prefs = memPrefs();
    prefs.set(
      PREF_KEY,
      JSON.stringify({
        builtIns: {
          summary: 'legacy summary',
          readingRoute: 'legacy route',
          fullTextHighlight: 'legacy highlight',
          explainSelection: 'legacy explain',
        },
        selectionQuestionAnnotationEnabled: false,
        customButtons: [{ id: 'a', label: 'A', prompt: 'do A' }],
      }),
    );

    await hydrateQuickPromptSettings(prefs);

    expect(prefs.get(PREF_KEY)).toBeUndefined();
    const stored = JSON.parse(files.get(quickPromptsPath()) ?? '{}');
    expect(stored.builtIns.summary).toBe('legacy summary');
    expect(stored.selectionQuestionAnnotationEnabled).toBe(false);
    expect(loadQuickPromptSettings(memPrefs()).customButtons).toEqual([
      { id: 'a', label: 'A', prompt: 'do A' },
    ]);
  });

  it('keeps the legacy prefs blob when the file write fails', async () => {
    installFileBackend({ writeError: new Error('disk full') });
    const prefs = memPrefs();
    const legacy = JSON.stringify({
      builtIns: {
        summary: 'keep me',
        readingRoute: 'route',
        fullTextHighlight: 'highlight',
        explainSelection: 'explain',
      },
      selectionQuestionAnnotationEnabled: true,
      customButtons: [],
    });
    prefs.set(PREF_KEY, legacy);

    await hydrateQuickPromptSettings(prefs);

    expect(prefs.get(PREF_KEY)).toBe(legacy);
    expect(files.size).toBe(0);
    expect(loadQuickPromptSettings(prefs).builtIns.summary).toBe('keep me');
  });

  it('prefers the file over a leftover prefs blob', async () => {
    installFileBackend();
    files.set(
      quickPromptsPath(),
      JSON.stringify({
        builtIns: {
          summary: 'from file',
          readingRoute: 'route',
          fullTextHighlight: 'highlight',
          explainSelection: 'explain',
        },
        selectionQuestionAnnotationEnabled: true,
        customButtons: [],
      }),
    );
    const prefs = memPrefs();
    prefs.set(
      PREF_KEY,
      JSON.stringify({
        builtIns: {
          summary: 'from prefs',
          readingRoute: 'route',
          fullTextHighlight: 'highlight',
          explainSelection: 'explain',
        },
      }),
    );

    await hydrateQuickPromptSettings(prefs);

    expect(loadQuickPromptSettings(prefs).builtIns.summary).toBe('from file');
    expect(prefs.get(PREF_KEY)).toBeUndefined();
  });
});
