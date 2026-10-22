import { afterEach, describe, expect, it, vi } from 'vitest';
import { promptText } from '../../src/utils/prompt-locale';
import { UI_LANGUAGE_PREF } from '../../src/utils/ui-locale';
import { getZoteroToolManual } from '../../src/modules/sidebar-state';
import { createZoteroAgentTools } from '../../src/context/agent-tools';
import { createPaperTools } from '../../src/context/paper-tools';
import { DEFAULT_CONTEXT_POLICY } from '../../src/context/policy';

function locale(language: string, override?: string): void {
  vi.stubGlobal('Zotero', {
    locale: language,
    Prefs: { get: (key: string) => key === UI_LANGUAGE_PREF ? override : undefined },
  });
}

afterEach(() => vi.unstubAllGlobals());

function withoutDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutDescriptions);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== 'description')
      .map(([key, child]) => [key, withoutDescriptions(child)]));
  }
  return value;
}

function tools() {
  return createZoteroAgentTools({
    source: { getItem: async () => null, getFullText: async () => '' },
    itemID: null,
  });
}

describe('built-in model instruction locale', () => {
  it('resolves the current preference on each call and falls back to English', () => {
    locale('zh-CN');
    expect(promptText('中文', 'English')).toBe('中文');
    locale('zh-CN', 'en-US');
    expect(promptText('中文', 'English')).toBe('English');
    locale('fr-FR');
    expect(promptText('中文', 'English')).toBe('English');
  });

  it('switches the complete tool manual without changing tool names', () => {
    locale('zh-CN');
    const chinese = getZoteroToolManual();
    expect(chinese).toContain('由模型决定');
    locale('en-US');
    const english = getZoteroToolManual();
    expect(english).toContain('The model, not the local UI');
    for (const tool of tools()) {
      if (!english.includes(tool.name)) continue;
      expect(chinese).toContain(tool.name);
    }
    expect(english).toContain('requires approval or YOLO mode');
    expect(chinese).toContain('需要审批或 YOLO 模式');
  });

  it('localizes tool and field guidance while preserving schemas and permissions', () => {
    locale('zh-CN');
    const chinese = tools();
    locale('en-US');
    const english = tools();
    expect(english.map(t => t.name)).toEqual(chinese.map(t => t.name));
    expect(english.map(t => withoutDescriptions(t.parameters))).toEqual(
      chinese.map(t => withoutDescriptions(t.parameters)),
    );
    expect(english.map(t => t.requiresApproval)).toEqual(chinese.map(t => t.requiresApproval));
    expect(chinese.find(t => t.name === 'zotero_get_current_item')!.description).toContain('题录');
    expect(english.find(t => t.name === 'zotero_get_current_item')!.description).toContain('metadata');
    const overview = english.find(t => t.name === 'render_paper_overview')!;
    expect(overview.description).toContain('English synthesis');
    expect(overview.description).not.toContain('Chinese gist');
    expect(chinese.find(t => t.name === 'render_paper_overview')!.description).toContain('中文核心讲述');
    expect(english.find(t => t.name === 'zotero_annotate_passage')!.description).toContain('approval or YOLO');
  });

  it('localizes external paper search instructions with unchanged protocol fields', () => {
    locale('zh-CN');
    const chinese = createPaperTools(DEFAULT_CONTEXT_POLICY);
    locale('en-US');
    const english = createPaperTools(DEFAULT_CONTEXT_POLICY);
    expect(chinese[0].description).toContain('搜索 arXiv');
    expect(english[0].description).toContain('Search arXiv');
    expect(chinese.map(t => withoutDescriptions(t.parameters))).toEqual(
      english.map(t => withoutDescriptions(t.parameters)),
    );
  });
});
