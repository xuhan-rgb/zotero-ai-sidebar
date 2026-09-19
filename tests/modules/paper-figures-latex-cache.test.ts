import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPaperFigureCache,
  loadPaperFigures,
} from "../../src/modules/paper-figures";

const writes: Array<{ path: string; data: string }> = [];
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
    readArxivMeta: async () => ({ status: "ok", files: ["main.tex"] }),
    readArxivMainText: async () =>
      [
        "\\begin{table}[t]",
        "\\caption{Latency of the view transformation on nuScenes.}",
        "\\label{tab:latency}",
        "\\begin{tabular}{lc}",
        "Method & Latency \\\\",
        "\\end{tabular}",
        "\\end{table}",
      ].join("\n"),
    readArxivTextFile: async () => null,
  };
});

beforeEach(() => {
  writes.length = 0;
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
      readUTF8: async () => {
        throw new Error("no parse cache for this paper");
      },
      read: async () => new Uint8Array(),
      write: async () => undefined,
      makeDirectory: async () => undefined,
      writeUTF8: async (path: string, data: string) => {
        writes.push({ path, data });
      },
    },
  });
});

const printed = ["Tab. I: Latency of the view transformation on nuScenes."];

describe("LaTeX material without reader text", () => {
  // The cache is keyed by the PDF alone, so a text-less result would keep every
  // float page-less for good — 本页 would answer 0 on every page of the paper.
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

  // The version is what discards the page-less entries the old logic wrote: a
  // cache entry is keyed by the PDF, so it would otherwise never be revisited.
  it("stamps a resolved entry so the page-less one is replaced", async () => {
    await loadPaperFigures(20, { pageTexts: async () => printed });
    const meta = JSON.parse(writes[0]!.data) as {
      version: number;
      figures: Array<{ page?: number }>;
    };

    expect(meta.version).toBe(3);
    expect(meta.figures[0]!.page).toBe(0);
  });
});
