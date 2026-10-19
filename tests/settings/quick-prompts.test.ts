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
  Object.defineProperty(globalThis, 'Zotero', {
    configurable: true,
    value: { locale: 'zh-CN' },
  });
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

  it('migrates the historical summary loaded from disk without changing custom buttons', async () => {
    installFileBackend();
    const legacy = '请用中文总结这篇论文，包含：研究背景与问题、核心方法流程、关键公式或算法步骤、主要贡献和创新点、实验结果与主要结论、适用场景、局限性、可能反例与后续改进方向，最后给出一句话概括。';
    const customButtons = [{ id: 'custom', label: '自定义', prompt: '请用中文解释方法' }];
    files.set(quickPromptsPath(), JSON.stringify({
      builtIns: { summary: legacy, explainSelection: 'My edited selection prompt' },
      customButtons,
    }));
    const prefs = memPrefs();
    await hydrateQuickPromptSettings(prefs);
    const settings = loadQuickPromptSettings(prefs);
    expect(settings.builtIns.summary).toContain('Summarize this paper in English');
    expect(settings.builtIns.explainSelection).toBe('My edited selection prompt');
    expect(settings.customButtons).toEqual(customButtons);
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


describe('built-in prompt languages', () => {
  function setLanguage(language: string): void {
    Object.defineProperty(globalThis, 'Zotero', {
      configurable: true,
      value: { locale: language },
    });
  }

  it('uses English defaults for English and unsupported locales', () => {
    for (const locale of ['en-US', 'fr-FR']) {
      setLanguage(locale);
      const prompts = loadQuickPromptSettings(memPrefs()).builtIns;
      for (const prompt of Object.values(prompts)) {
        expect(prompt).not.toMatch(/[\u4e00-\u9fff]/);
        expect(prompt).toContain('English');
      }
      expect(prompts.readingRoute).toContain('zotero_get_current_item');
      expect(prompts.fullTextHighlight).toContain('zotero_annotate_passage');
    }
  });

  it('follows explicit interface language instead of the system locale', () => {
    Object.defineProperty(globalThis, 'Zotero', {
      configurable: true,
      value: { locale: 'en-US', Prefs: { get: () => 'zh-CN' } },
    });
    expect(loadQuickPromptSettings(memPrefs()).builtIns).toEqual(
      DEFAULT_QUICK_PROMPT_SETTINGS.builtIns,
    );
  });

  it('uses explicit English even on a Chinese system', () => {
    Object.defineProperty(globalThis, 'Zotero', {
      configurable: true,
      value: { locale: 'zh-CN', Prefs: { get: () => 'en-US' } },
    });
    expect(loadQuickPromptSettings(memPrefs()).builtIns.summary).toContain('English');
  });

  it('switches saved defaults both ways while preserving edited and custom prompts', () => {
    const prefs = memPrefs();
    saveQuickPromptSettings(prefs, {
      ...DEFAULT_QUICK_PROMPT_SETTINGS,
      builtIns: {
        ...DEFAULT_QUICK_PROMPT_SETTINGS.builtIns,
        explainSelection: 'My edited prompt',
      },
      customButtons: [{ id: 'custom', label: 'Custom', prompt: '自定义提示词' }],
    });
    resetQuickPromptSettingsCache();
    setLanguage('en-US');
    const english = loadQuickPromptSettings(prefs);
    expect(english.builtIns.summary).not.toMatch(/[\u4e00-\u9fff]/);
    expect(english.builtIns.explainSelection).toBe('My edited prompt');
    expect(english.customButtons[0].prompt).toBe('自定义提示词');
    saveQuickPromptSettings(prefs, english);
    setLanguage('zh-CN');
    expect(loadQuickPromptSettings(prefs).builtIns.summary).toBe(
      DEFAULT_QUICK_PROMPT_SETTINGS.builtIns.summary,
    );
    expect(loadQuickPromptSettings(prefs).builtIns.explainSelection).toBe('My edited prompt');
  });

  it('migrates the historical summary default but preserves edits to it', () => {
    const legacy = '请用中文总结这篇论文，包含：研究背景与问题、核心方法流程、关键公式或算法步骤、主要贡献和创新点、实验结果与主要结论、适用场景、局限性、可能反例与后续改进方向，最后给出一句话概括。';
    const prefs = memPrefs();
    prefs.set(PREF_KEY, JSON.stringify({ builtIns: { summary: legacy } }));
    setLanguage('en-US');
    const english = loadQuickPromptSettings(prefs).builtIns.summary;
    expect(english).toContain('Summarize this paper in English');
    expect(english).not.toContain('请用中文');
    setLanguage('zh-CN');
    expect(loadQuickPromptSettings(prefs).builtIns.summary).toBe(
      DEFAULT_QUICK_PROMPT_SETTINGS.builtIns.summary,
    );
    resetQuickPromptSettingsCache();
    prefs.set(PREF_KEY, JSON.stringify({ builtIns: { summary: legacy + ' 只关注方法。' } }));
    setLanguage('en-US');
    expect(loadQuickPromptSettings(prefs).builtIns.summary).toBe(legacy + ' 只关注方法。');
  });

  it('updates hydrated defaults after changing language', async () => {
    const prefs = memPrefs();
    await hydrateQuickPromptSettings(prefs);
    setLanguage('en-US');
    expect(loadQuickPromptSettings(prefs).builtIns.summary).not.toMatch(/[\u4e00-\u9fff]/);
  });
});
