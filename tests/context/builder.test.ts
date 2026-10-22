import { afterEach, describe, it, expect, vi } from 'vitest';
import { buildContext, type ContextSource } from '../../src/context/builder';
import { UI_LANGUAGE_PREF } from '../../src/utils/ui-locale';

const fakeSource: ContextSource = {
  async getItem(id) {
    if (id !== 1) return null;
    return {
      title: 'Attention Is All You Need',
      authors: ['Vaswani', 'Shazeer'],
      year: 2017,
      tags: ['transformer'],
      abstract: 'We propose a new architecture.',
    };
  },
  async getFullText(_id) {
    return 'A'.repeat(10_000);
  },
};

function useLocale(locale: 'zh-CN' | 'en-US') {
  vi.stubGlobal('Zotero', {
    Prefs: { get: (key: string) => key === UI_LANGUAGE_PREF ? locale : undefined },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('buildContext', () => {
  it('returns base prompt only when no item id', async () => {
    const ctx = await buildContext(fakeSource, null, 100);
    expect(ctx.systemPrompt).toMatch(/research assistant/);
    expect(ctx.pdfText).toBeNull();
  });

  it('returns base prompt only when item not found', async () => {
    const ctx = await buildContext(fakeSource, 999, 100);
    expect(ctx.systemPrompt).toMatch(/research assistant/);
    expect(ctx.pdfText).toBeNull();
  });

  it('includes metadata block in system prompt when item present', async () => {
    const ctx = await buildContext(fakeSource, 1, 1000);
    expect(ctx.systemPrompt).toContain('Title: Attention Is All You Need');
    expect(ctx.systemPrompt).toContain('Authors: Vaswani, Shazeer');
    expect(ctx.systemPrompt).toContain('Year: 2017');
    expect(ctx.systemPrompt).toContain('Tags: transformer');
    expect(ctx.systemPrompt).toContain('Abstract: We propose a new architecture.');
  });

  it('truncates pdf text to ~4 chars per token budget', async () => {
    const ctx = await buildContext(fakeSource, 1, 100);
    expect(ctx.pdfText?.length).toBe(400);
  });

  it('instructs the model to quote evidence verbatim in blockquotes', async () => {
    useLocale('en-US');
    const ctx = await buildContext(fakeSource, 1, 0);
    // Evidence must be verbatim PDF quotes (not paraphrase) so the chat's
    // "jump to source" feature always has locatable text to work with.
    expect(ctx.systemPrompt).toMatch(/verbatim/i);
    expect(ctx.systemPrompt).toMatch(/blockquote/i);
  });

  it('builds Chinese prompts when the UI preference is Chinese', async () => {
    useLocale('zh-CN');
    const ctx = await buildContext(fakeSource, 1, 0);
    expect(ctx.systemPrompt).toContain('研究助手');
    expect(ctx.systemPrompt).toContain('逐字引用 PDF 原文');
    expect(ctx.systemPrompt).toContain('用户当前正在查看这篇论文');
  });

  it('builds English prompts when the UI preference is English', async () => {
    useLocale('en-US');
    const ctx = await buildContext(fakeSource, 1, 0);
    expect(ctx.systemPrompt).toContain('research assistant');
    expect(ctx.systemPrompt).toContain('quote the actual PDF passage verbatim');
    expect(ctx.systemPrompt).toContain('The user is currently viewing this paper');
  });
});
