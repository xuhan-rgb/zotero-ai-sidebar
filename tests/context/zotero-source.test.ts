import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { zoteroContextSource } from '../../src/context/zotero-source';
import { readArxivMainText } from '../../src/context/arxiv-store';

vi.mock('../../src/context/arxiv-store', () => ({ readArxivMainText: vi.fn() }));

let files: Map<string, string>;
const parsed = '# Paper\n\nParsed evidence [1].\n\n# References\n\n[1] Anguloc, 2020.';
beforeEach(() => {
  vi.mocked(readArxivMainText).mockResolvedValue(null);
  files = new Map([
    ['/data/zotero-ai-sidebar-mineru/PARENT/meta.json', JSON.stringify({ pdfSize: 100, pdfMtime: 10 })],
    ['/data/zotero-ai-sidebar-mineru/PARENT/full.md', parsed],
  ]);
  const parent = { id: 1, key: 'PARENT', getField: (field: string) => field === 'extra' ? 'arXiv: 2504.16054' : '', getAttachments: () => [2] };
  const pdf = { id: 2, key: 'PDF', parentID: 1, isAttachment: () => true,
    attachmentContentType: 'application/pdf', getField: () => '', getFilePathAsync: async () => '/paper.pdf' };
  const items = new Map([[1, parent], [2, pdf]]);
  vi.stubGlobal('Zotero', {
    DataDirectory: { dir: '/data' },
    Items: { get: (id: number) => items.get(id), getAsync: async (id: number) => items.get(id) },
    Fulltext: { getItemCacheFile: () => ({ path: '/index' }) },
    File: { getContentsAsync: async () => 'OLD INDEX TEXT' },
  });
  vi.stubGlobal('IOUtils', {
    stat: async () => ({ size: 100, lastModified: 10 }),
    readUTF8: async (path: string) => {
      if (!files.has(path)) throw new Error('missing');
      return files.get(path)!;
    },
  });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('unexpected network'); }));
});
afterEach(() => vi.unstubAllGlobals());

it.each([1, 2])('preserves LaTeX priority over a completed PDF parse for item %s', async (id) => {
  vi.mocked(readArxivMainText).mockResolvedValue('LATEX SOURCE');
  expect(await zoteroContextSource.getFullText(id)).toBe('LATEX SOURCE');
  expect(await zoteroContextSource.getParsedPdfText!(id)).toBeNull();
});

it.each([1, 2])('uses parsed text including references for item %s without a token or network', async (id) => {
  expect(await zoteroContextSource.getFullText(id)).toBe(parsed);
  expect(fetch).not.toHaveBeenCalled();
});

it('falls back when the PDF no longer matches the parsed cache', async () => {
  files.set('/data/zotero-ai-sidebar-mineru/PARENT/meta.json', JSON.stringify({ pdfSize: 99, pdfMtime: 10 }));
  expect(await zoteroContextSource.getFullText(1)).toBe('OLD INDEX TEXT');
});

it('uses a parse completed after an earlier read', async () => {
  files.delete('/data/zotero-ai-sidebar-mineru/PARENT/full.md');
  expect(await zoteroContextSource.getFullText(1)).toBe('OLD INDEX TEXT');
  files.set('/data/zotero-ai-sidebar-mineru/PARENT/full.md', parsed);
  expect(await zoteroContextSource.getFullText(1)).toBe(parsed);
});
