import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  expandSlashCommandMessage,
  matchingSlashCommands,
  matchingSlashCommandsForSendMode,
} from '../../src/ui/slash-commands';

describe('slash commands', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('matches commands from the typed slash token', () => {
    expect(matchingSlashCommands('/ar').map((command) => command.name)).toEqual(
      ['/arxiv-search'],
    );
  });

  it('offers slash commands in API mode but not WEB mode', () => {
    expect(
      matchingSlashCommandsForSendMode('/', 'api').map(
        (command) => command.name,
      ),
    ).toEqual(['/arxiv-search', '/web-search']);
    expect(matchingSlashCommandsForSendMode('/', 'web')).toEqual([]);
  });

  it('expands arxiv search into an explicit model instruction', () => {
    expect(expandSlashCommandMessage('/arxiv-search 1706.03762')).toContain(
      'User explicitly selected /arxiv-search.',
    );
    expect(expandSlashCommandMessage('/arxiv-search 1706.03762')).toContain(
      'Search/analyze request: 1706.03762',
    );
  });

  it.each([
    ['zh-CN', '用户明确选择了 /arxiv-search。', '搜索/分析请求: 1706.03762', '用户明确选择了 /web-search。', '搜索请求: cats'],
    ['en-US', 'User explicitly selected /arxiv-search.', 'Search/analyze request: 1706.03762', 'User explicitly selected /web-search.', 'Search request: cats'],
  ])('localizes slash-command instructions for %s and preserves user text', (locale, arxivStart, arxivQuery, webStart, webQuery) => {
    vi.stubGlobal('Zotero', { locale: 'en-US', Prefs: { get: () => locale } });
    const arxiv = expandSlashCommandMessage('/arxiv-search 1706.03762');
    expect(arxiv).toContain(arxivStart);
    expect(arxiv).toContain(arxivQuery);
    expect(arxiv).toContain('1706.03762');
    const web = expandSlashCommandMessage('/web-search cats');
    expect(web).toContain(webStart);
    expect(web).toContain(webQuery);
    expect(web).toContain('cats');
  });

  it.each([
    ['zh-CN', '内置网页搜索工具', '用户没有提供查询内容；请询问查询内容。'],
    ['en-US', 'Use the configured built-in web search tool', 'No query was provided; ask for a query.'],
  ])('localizes no-query fallback for %s', (locale, instruction, fallback) => {
    vi.stubGlobal('Zotero', { locale: 'en-US', Prefs: { get: () => locale } });
    const expanded = expandSlashCommandMessage('/web-search');
    expect(expanded).toContain(instruction);
    expect(expanded).toContain(fallback);
  });

  it('leaves normal messages unchanged', () => {
    expect(expandSlashCommandMessage('总结当前论文')).toBe('总结当前论文');
  });
});
