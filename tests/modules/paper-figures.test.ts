import { beforeEach, describe, expect, it } from "vitest";
import { loadPaperFigures } from "../../src/modules/paper-figures";

const CACHE = "/data/zotero-ai-sidebar-mineru/ROOTKEY";
const PDF_PATH = "/data/storage/paper.pdf";

const contentList = [
  { type: "text", text: "1 Introduction" },
  {
    type: "image",
    img_path: "images/fig1.jpg",
    image_caption: ["Figure 1: System overview of the model."],
    page_idx: "2",
  },
  {
    type: "chart",
    img_path: "images/chart1.png",
    chart_caption: "Figure 2: Latency.",
    page_idx: "4",
  },
  {
    type: "equation",
    text: "$$\nE = m c ^ {2}\\tag{7}\n$$",
    page_idx: "4",
  },
  {
    type: "table",
    img_path: "images/table1.jpg",
    table_caption: ["Table 1: Planning metrics."],
  },
  { type: "image", img_path: "../escape.png", image_caption: "bad path" },
  { type: "image", img_path: "images/missing.jpg", image_caption: "Figure 4" },
];

const existing = new Set([
  `${CACHE}/meta.json`,
  `${CACHE}/full.md`,
  `${CACHE}/content_list.json`,
  `${CACHE}/assets/images/fig1.jpg`,
  `${CACHE}/assets/images/chart1.png`,
  `${CACHE}/assets/images/table1.jpg`,
  PDF_PATH,
]);

beforeEach(() => {
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: {
      DataDirectory: { dir: "/data" },
      Profile: { dir: "/data/profile" },
      Items: {
        get: (id: number) =>
          id === 10
            ? {
                key: "ROOTKEY",
                getAttachments: () => [11],
              }
            : id === 11
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
      exists: async (path: string) => existing.has(path),
      stat: async () => ({ size: 100, lastModified: 200 }),
      readUTF8: async (path: string) => {
        if (path === `${CACHE}/meta.json`) {
          return JSON.stringify({
            itemKey: "ROOTKEY",
            pdfSize: 100,
            pdfMtime: 200,
            sourceHash: "hash",
            parsedAt: "2026-01-01",
          });
        }
        if (path === `${CACHE}/full.md`) return "# Paper";
        if (path === `${CACHE}/content_list.json`) return JSON.stringify(contentList);
        throw new Error(`unexpected read: ${path}`);
      },
      read: async () => new Uint8Array(),
      write: async () => undefined,
      makeDirectory: async () => undefined,
      writeUTF8: async () => undefined,
    },
  });
});

describe("paper figures from the MinerU cache", () => {
  it("labels figures and tables and skips missing or unsafe images", async () => {
    const figures = await loadPaperFigures(10);

    expect(figures.map((figure) => figure.label)).toEqual([
      "图 1",
      "图 2",
      "公式 7",
      "表 1",
    ]);
    expect(figures.map((figure) => figure.kind)).toEqual([
      "figure",
      "figure",
      "equation",
      "table",
    ]);
    expect(figures[0].caption).toBe("Figure 1: System overview of the model.");
    expect(figures[0].path).toBe(`${CACHE}/assets/images/fig1.jpg`);
    expect(figures[0].mediaType).toBe("image/jpeg");
    expect(figures[0].page).toBe(2);
    expect(figures[2].latex).toContain("E = m c ^ {2}");
    expect(figures[3].mediaType).toBe("image/jpeg");
  });
});
