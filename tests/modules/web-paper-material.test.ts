import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveWebPaperMaterial } from "../../src/modules/web-paper-material";

describe("WEB paper material", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prefers cached arXiv LaTeX and emits the canonical arXiv URL", async () => {
    const parent = item(1, {
      title: "Paper",
      url: "https://arxiv.org/abs/2501.12345",
      attachments: [2],
    });
    const pdf = item(2, {
      contentType: "application/pdf",
      path: "/papers/paper.pdf",
    });
    stubRuntime([parent, pdf], {
      meta: {
        arxivId: "2501.12345",
        fetchedAt: "2026-08-17T00:00:00.000Z",
        mainTexRelPath: "main.tex",
        status: "ok",
      },
    });

    await expect(resolveWebPaperMaterial(1)).resolves.toEqual({
      paperUrl: "https://arxiv.org/abs/2501.12345",
      attachment: {
        kind: "latex",
        path: "/zotero/zotero-ai-sidebar/arxiv/2501.12345/source/main.tex",
        name: "main.tex",
        mimeType: "text/plain",
      },
    });
  });

  it("falls back to the first local PDF and a DOI URL", async () => {
    const parent = item(1, {
      title: "Paper",
      doi: "10.1000/example",
      attachments: [2],
    });
    const pdf = item(2, {
      contentType: "application/pdf",
      path: "/papers/paper.pdf",
    });
    stubRuntime([parent, pdf]);

    await expect(resolveWebPaperMaterial(1)).resolves.toEqual({
      paperUrl: "https://doi.org/10.1000/example",
      attachment: {
        kind: "pdf",
        path: "/papers/paper.pdf",
        name: "paper.pdf",
        mimeType: "application/pdf",
      },
    });
  });
});

function item(
  id: number,
  options: {
    title?: string;
    url?: string;
    doi?: string;
    attachments?: number[];
    contentType?: string;
    path?: string;
  },
) {
  return {
    id,
    libraryID: 1,
    key: `KEY${id}`,
    attachmentContentType: options.contentType,
    getField(field: string) {
      if (field === "title") return options.title ?? "";
      if (field === "url") return options.url ?? "";
      if (field === "DOI") return options.doi ?? "";
      return "";
    },
    getAttachments: () => options.attachments ?? [],
    isAttachment: () => !!options.contentType,
    isPDFAttachment: () => options.contentType === "application/pdf",
    getFilePathAsync: async () => options.path ?? false,
  };
}

function stubRuntime(
  items: ReturnType<typeof item>[],
  options: { meta?: Record<string, unknown> } = {},
) {
  const byID = new Map(items.map((entry) => [entry.id, entry]));
  vi.stubGlobal("Zotero", {
    DataDirectory: { dir: "/zotero" },
    Profile: { dir: "/profile" },
    Items: {
      get: (id: number) => byID.get(id),
      getAsync: async (id: number) => byID.get(id),
      getByLibraryAndKey: (_libraryID: number, key: string) =>
        items.find((entry) => entry.key === key),
    },
  });
  vi.stubGlobal("IOUtils", {
    exists: vi.fn(async (path: string) =>
      path.endsWith("main.tex") ? !!options.meta : true,
    ),
    readUTF8: vi.fn(async () => JSON.stringify(options.meta ?? {})),
  });
}
