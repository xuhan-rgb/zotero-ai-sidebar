import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadFullTranslationAssetPreviews,
  PDFJS_MODULE_URL,
  PDFJS_WORKER_URL,
} from "../../src/translate/full-document-assets";
import type { FullTranslationDocument } from "../../src/translate/full-document";

const document: FullTranslationDocument = {
  schemaVersion: 1,
  arxivId: "2504.16054",
  sourceHash: "hash",
  blocks: [
    {
      id: "figure-1-caption",
      kind: "figure-caption",
      source: "Figure.",
      translatable: true,
      assets: ["figures/robot"],
    },
  ],
};

beforeEach(() => {
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: { DataDirectory: { dir: "/data" }, Profile: { dir: "/profile" } },
  });
  Object.defineProperty(globalThis, "IOUtils", {
    configurable: true,
    value: {
      readUTF8: async () =>
        JSON.stringify({ status: "ok", files: ["figures/robot.png"] }),
      read: async () => new Uint8Array([1, 2, 3]),
    },
  });
});

describe("loadFullTranslationAssetPreviews", () => {
  it("uses Zotero's registered reader resource namespace for PDF figures", () => {
    expect(PDFJS_MODULE_URL).toBe("resource://zotero/reader/pdf/build/pdf.mjs");
    expect(PDFJS_WORKER_URL).toBe(
      "resource://zotero/reader/pdf/build/pdf.worker.mjs",
    );
  });

  it("loads cached raster figures and reports progressive updates", async () => {
    const onAsset = vi.fn();

    const assets = await loadFullTranslationAssetPreviews(
      document,
      globalThis.document,
      onAsset,
    );

    expect(assets["figures/robot"]).toEqual({
      sourcePath: "figures/robot",
      resolvedPath: "figures/robot.png",
      previewUrl: "data:image/png;base64,AQID",
    });
    expect(onAsset).toHaveBeenCalledWith(
      "figures/robot",
      assets["figures/robot"],
    );
  });

  it("converts a PDF figure from the LaTeX source package on Linux", async () => {
    const exec = vi.fn(async () => true);
    const removeIfExists = vi.fn(async () => undefined);
    Object.defineProperty(globalThis, "Zotero", {
      configurable: true,
      value: {
        DataDirectory: { dir: "/data" },
        Profile: { dir: "/profile" },
        isLinux: true,
        getTempDirectory: () => ({ path: "/tmp" }),
        Utilities: { Internal: { exec } },
        File: { removeIfExists },
      },
    });
    Object.defineProperty(globalThis, "IOUtils", {
      configurable: true,
      value: {
        readUTF8: async () =>
          JSON.stringify({ status: "ok", files: ["figures/vector.pdf"] }),
        read: async (path: string) =>
          path.endsWith(".png")
            ? new Uint8Array([137, 80, 78, 71])
            : new Uint8Array([37, 80, 68, 70]),
      },
    });
    const pdfDocument: FullTranslationDocument = {
      ...document,
      arxivId: "2504.16055",
      blocks: [
        {
          ...document.blocks[0],
          assets: ["figures/vector.pdf"],
        },
      ],
    };

    const assets = await loadFullTranslationAssetPreviews(
      pdfDocument,
      globalThis.document,
    );

    expect(exec).toHaveBeenCalledWith("/usr/bin/pdftoppm", [
      "-f",
      "1",
      "-singlefile",
      "-scale-to-x",
      "1400",
      "-scale-to-y",
      "-1",
      "-png",
      "/data/zotero-ai-sidebar/arxiv/2504.16055/source/figures/vector.pdf",
      expect.stringMatching(/^\/tmp\/zai-latex-figure-/),
    ]);
    expect(assets["figures/vector.pdf"]?.previewUrl).toBe(
      "data:image/png;base64,iVBORw==",
    );
    expect(removeIfExists).toHaveBeenCalledWith(
      expect.stringMatching(/^\/tmp\/zai-latex-figure-.*\.png$/),
    );
  });
});
