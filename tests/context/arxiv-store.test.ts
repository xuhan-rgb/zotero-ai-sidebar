import { describe, expect, it, beforeEach } from "vitest";
import {
  arxivFolderPath,
  writeArxivSource,
  hasArxivSource,
  readArxivMeta,
  readArxivTextFile,
  readArxivBibliographyFiles,
  matchFigureFile,
  matchSourceAssetFile,
  mediaTypeForSourceAsset,
  mediaTypeForFigure,
  type ArxivMeta,
} from "../../src/context/arxiv-store";
import { resolveArxivIdForLibraryItem } from "../../src/context/arxiv-id";

let fs: Map<string, string | Uint8Array>;

beforeEach(() => {
  fs = new Map();
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: { DataDirectory: { dir: "/data" }, Profile: { dir: "/prof" } },
  });
  Object.defineProperty(globalThis, "IOUtils", {
    configurable: true,
    value: {
      makeDirectory: async () => undefined,
      writeUTF8: async (p: string, d: string) => void fs.set(p, d),
      write: async (p: string, d: Uint8Array) => void fs.set(p, d),
      readUTF8: async (p: string) => {
        if (!fs.has(p)) throw new Error("no entry");
        const value = fs.get(p);
        return typeof value === "string"
          ? value
          : new TextDecoder().decode(value);
      },
      exists: async (p: string) => fs.has(p),
    },
  });
});

const meta: ArxivMeta = {
  arxivId: "2504.16054",
  fetchedAt: "2026-05-23T00:00:00.000Z",
  mainTexRelPath: "main.tex",
  status: "ok",
};

describe("arxiv-store", () => {
  it("builds a shared folder path from the arXiv id", () => {
    expect(arxivFolderPath("2504.16054")).toBe(
      "/data/zotero-ai-sidebar/arxiv/2504.16054",
    );
  });

  it("encodes legacy arXiv ids so their slash cannot create nested folders", () => {
    expect(arxivFolderPath("hep-th/9901001")).toBe(
      "/data/zotero-ai-sidebar/arxiv/hep-th%2F9901001",
    );
  });

  it("uses Windows separators for data-dir cache paths", async () => {
    Object.defineProperty(globalThis, "Zotero", {
      configurable: true,
      value: {
        DataDirectory: { dir: "C:\\Users\\admin\\Zotero" },
        Profile: { dir: "C:\\Users\\admin\\AppData\\Roaming\\Zotero" },
      },
    });

    await writeArxivSource(
      "2504.16054",
      [{ path: "figures/robot.png", bytes: new Uint8Array([1, 2, 3]) }],
      meta,
    );

    expect(arxivFolderPath("2504.16054")).toBe(
      "C:\\Users\\admin\\Zotero\\zotero-ai-sidebar\\arxiv\\2504.16054",
    );
    expect(
      fs.has(
        "C:\\Users\\admin\\Zotero\\zotero-ai-sidebar\\arxiv\\2504.16054\\source\\figures\\robot.png",
      ),
    ).toBe(true);
    expect(await readArxivTextFile("2504.16054", "figures/robot.png")).toBe(
      "\u0001\u0002\u0003",
    );
  });

  it("writes source files + meta and round-trips meta (with files list)", async () => {
    await writeArxivSource(
      "2504.16054",
      [
        {
          path: "main.tex",
          bytes: new TextEncoder().encode("\\documentclass{x}"),
        },
        { path: "figures/robot.png", bytes: new Uint8Array([1, 2, 3]) },
      ],
      meta,
    );
    expect(await readArxivMeta("2504.16054")).toEqual({
      ...meta,
      files: ["main.tex", "figures/robot.png"],
    });
  });

  it("hasArxivSource is true after a write, false otherwise", async () => {
    expect(await hasArxivSource("2504.99999")).toBe(false);
    await writeArxivSource("2504.16054", [], meta);
    expect(await hasArxivSource("2504.16054")).toBe(true);
  });

  it("reuses one source cache across Zotero items with the same arXiv id", async () => {
    const items = new Map([
      ["ITEM0001", zoteroItem("ITEM0001", "2504.16054")],
      ["ITEM0002", zoteroItem("ITEM0002", "2504.16054")],
    ]);
    Object.defineProperty(globalThis, "Zotero", {
      configurable: true,
      value: {
        DataDirectory: { dir: "/data" },
        Profile: { dir: "/prof" },
        Items: {
          getByLibraryAndKey: (_libraryID: number, key: string) =>
            items.get(key) ?? null,
          get: () => null,
        },
      },
    });
    const first = resolveArxivIdForLibraryItem(1, "ITEM0001");
    const second = resolveArxivIdForLibraryItem(1, "ITEM0002");

    await writeArxivSource(
      first!,
      [{ path: "main.tex", bytes: new TextEncoder().encode("shared latex") }],
      meta,
    );

    expect(await readArxivTextFile(second!, "main.tex")).toBe("shared latex");
    expect([...fs.keys()].filter((path) => path.endsWith("meta.json"))).toEqual(
      ["/data/zotero-ai-sidebar/arxiv/2504.16054/meta.json"],
    );
  });

  it("returns .bbl bibliography files before falling back to .bib", async () => {
    await writeArxivSource(
      "2504.16054",
      [
        { path: "main.bbl", bytes: new TextEncoder().encode("compiled refs") },
        { path: "refs.bib", bytes: new TextEncoder().encode("bib refs") },
      ],
      meta,
    );

    expect(await readArxivBibliographyFiles("2504.16054")).toEqual([
      { path: "main.bbl", text: "compiled refs" },
    ]);
  });

  it("falls back to .bib bibliography files when no .bbl exists", async () => {
    await writeArxivSource(
      "2504.16054",
      [{ path: "refs.bib", bytes: new TextEncoder().encode("bib refs") }],
      meta,
    );

    expect(await readArxivBibliographyFiles("2504.16054")).toEqual([
      { path: "refs.bib", text: "bib refs" },
    ]);
  });
});

function zoteroItem(key: string, arxivId: string) {
  return {
    key,
    libraryID: 1,
    getField: (field: string) =>
      field === "archiveID" ? `arXiv:${arxivId}` : "",
    getAttachments: () => [] as number[],
  };
}

describe("mediaTypeForFigure", () => {
  it("maps raster extensions to image/* types", () => {
    expect(mediaTypeForFigure("a/b/x.png")).toBe("image/png");
    expect(mediaTypeForFigure("X.JPG")).toBe("image/jpeg");
    expect(mediaTypeForFigure("y.jpeg")).toBe("image/jpeg");
    expect(mediaTypeForFigure("y.gif")).toBe("image/gif");
    expect(mediaTypeForFigure("y.WebP")).toBe("image/webp");
  });
  it("returns null for vector / unknown formats", () => {
    expect(mediaTypeForFigure("fig.pdf")).toBeNull();
    expect(mediaTypeForFigure("fig.eps")).toBeNull();
    expect(mediaTypeForFigure("no-extension")).toBeNull();
  });
});

describe("matchFigureFile", () => {
  const files = [
    "main.tex",
    "figures/robot_system_overview.png",
    "figures/attention_mask.png",
    "figures/Figure_3.pdf",
    "figures/visualize_eval_envs.pdf",
    "figures/rare_objects.jpg",
  ];

  it("matches by exact relative path", () => {
    expect(matchFigureFile(files, "figures/robot_system_overview.png")).toBe(
      "figures/robot_system_overview.png",
    );
  });
  it("matches by basename alone", () => {
    expect(matchFigureFile(files, "attention_mask.png")).toBe(
      "figures/attention_mask.png",
    );
  });
  it("matches by stem (no extension)", () => {
    expect(matchFigureFile(files, "rare_objects")).toBe(
      "figures/rare_objects.jpg",
    );
  });
  it("matches by case-insensitive substring", () => {
    expect(matchFigureFile(files, "ROBOT")).toBe(
      "figures/robot_system_overview.png",
    );
  });
  it("skips vector formats — Figure_3.pdf is unreachable", () => {
    expect(matchFigureFile(files, "Figure_3")).toBeNull();
    expect(matchFigureFile(files, "visualize_eval_envs.pdf")).toBeNull();
  });
  it("returns null when there are no supported raster files", () => {
    expect(matchFigureFile(["only.pdf", "more.eps"], "anything")).toBeNull();
  });
});

describe("full-translation source assets", () => {
  const files = [
    "figures/system.png",
    "figures/diagram.pdf",
    "figures/vector.svg",
  ];

  it("resolves extensionless LaTeX paths including vector figures", () => {
    expect(matchSourceAssetFile(files, "figures/diagram")).toBe(
      "figures/diagram.pdf",
    );
    expect(matchSourceAssetFile(files, "vector")).toBe("figures/vector.svg");
  });

  it("reports display and conversion media types", () => {
    expect(mediaTypeForSourceAsset("system.png")).toBe("image/png");
    expect(mediaTypeForSourceAsset("diagram.pdf")).toBe("application/pdf");
    expect(mediaTypeForSourceAsset("vector.svg")).toBe("image/svg+xml");
    expect(mediaTypeForSourceAsset("legacy.eps")).toBe(
      "application/postscript",
    );
  });
});
