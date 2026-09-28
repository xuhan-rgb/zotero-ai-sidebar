import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPaperFigureCache,
  loadPaperFigures,
} from "../../src/modules/paper-figures";

const writes: Array<{ path: string; data: string }> = [];
const saved = new Map<string, string>();
let sourceReady = true;
const PDF_PATH = "/data/storage/arxiv.pdf";
const CACHE_FIGURES = "/data/zotero-ai-sidebar-figures/ARXKEY/figures.json";

vi.mock("../../src/context/arxiv-id", () => ({
  resolveArxivIdForItemID: () => "1234.5678",
}));

vi.mock("../../src/context/arxiv-store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/context/arxiv-store")>();
  return {
    ...actual,
    readArxivMeta: async () =>
      sourceReady
        ? {
            status: "ok",
            fetchedAt: "2026-09-28T07:24:15Z",
            files: ["main.tex"],
          }
        : null,
    readArxivMainText: async () =>
      sourceReady
        ? [
            "\\begin{table}[t]",
            "\\caption{Latency of the view transformation on nuScenes.}",
            "\\label{tab:latency}",
            "\\begin{tabular}{lc}",
            "Method & Latency \\\\",
            "\\end{tabular}",
            "\\end{table}",
          ].join("\n")
        : null,
    readArxivTextFile: async () => null,
  };
});

beforeEach(() => {
  writes.length = 0;
  saved.clear();
  sourceReady = true;
  clearPaperFigureCache();
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: {
      DataDirectory: { dir: "/data" },
      Profile: { dir: "/data/profile" },
      Items: {
        get: (id: number) =>
          id === 20
            ? { key: "ARXKEY", getAttachments: () => [21] }
            : id === 21
              ? {
                  key: "PDFKEY",
                  isPDFAttachment: () => true,
                  getFilePathAsync: async () => PDF_PATH,
                }
              : null,
      },
    },
  });
  Object.defineProperty(globalThis, "IOUtils", {
    configurable: true,
    value: {
      exists: async () => false,
      stat: async () => ({ size: 100, lastModified: 200 }),
      readUTF8: async (path: string) => {
        const data = saved.get(path);
        if (data != null) return data;
        throw new Error("no parse cache for this paper");
      },
      read: async () => new Uint8Array(),
      write: async () => undefined,
      makeDirectory: async () => undefined,
      writeUTF8: async (path: string, data: string) => {
        writes.push({ path, data });
        saved.set(path, data);
      },
    },
  });
});

const printed = ["Tab. I: Latency of the view transformation on nuScenes."];

describe("LaTeX material without reader text", () => {
  it("rebuilds an empty cache when LaTeX source arrives later", async () => {
    sourceReady = false;
    expect(
      await loadPaperFigures(20, { pageTexts: async () => printed }),
    ).toEqual([]);
    expect(saved.has(CACHE_FIGURES)).toBe(true);

    sourceReady = true;
    const figures = await loadPaperFigures(20, {
      pageTexts: async () => printed,
    });
    expect(figures).toHaveLength(1);
    expect(figures[0]!.label).toBe("表 1");
  });
  // A text-less result would keep every float page-less for good — 本页 would
  // answer 0 on every page of the paper.
  it("neither writes the cache nor keeps the page-less list for the session", async () => {
    const blind = await loadPaperFigures(20, {
      pageTexts: async () => undefined,
    });
    expect(blind).toHaveLength(1);
    expect(blind[0]!.label).toBe("表 1");
    expect(blind[0]!.page).toBeUndefined();
    expect(writes).toEqual([]);

    const sighted = await loadPaperFigures(20, {
      pageTexts: async () => printed,
    });
    expect(sighted[0]!.page).toBe(0);
    expect(writes.map((write) => write.path)).toEqual([CACHE_FIGURES]);
  });

  it("replaces existing version-3 empty caches without manual deletion", async () => {
    saved.set(
      CACHE_FIGURES,
      JSON.stringify({
        version: 3,
        pdfSize: 100,
        pdfMtime: 200,
        figures: [],
      }),
    );

    const figures = await loadPaperFigures(20, {
      pageTexts: async () => printed,
    });
    expect(figures).toHaveLength(1);
    expect(writes.map((write) => write.path)).toEqual([CACHE_FIGURES]);
  });

  // The version discards older page-less and empty entries, while the source
  // stamp invalidates a current entry when the arXiv source changes.
  it("stamps a resolved entry so the page-less one is replaced", async () => {
    await loadPaperFigures(20, { pageTexts: async () => printed });
    const meta = JSON.parse(writes[0]!.data) as {
      version: number;
      figures: Array<{ page?: number }>;
    };

    expect(meta.version).toBe(4);
    expect(meta.figures[0]!.page).toBe(0);
  });
});
