import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWebTocAttachment,
  resolveWebPaperMaterial,
  webArxivTocDirectory,
} from "../../src/modules/web-paper-material";

describe("WEB paper material", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends WEB only the arXiv section directory without API tool instructions", () => {
    const apiToc = [
      "[arXiv paper — section index]",
      "The cleaned LaTeX source is cached locally; bodies are NOT inlined.",
      "Use these tools to read source parts on demand:",
      "  • arxiv_get_section(section) — fetch ONE section",
      "  • zotero_get_full_pdf() — upgrade to the full LaTeX source if needed",
      "Sections (number · title · body chars):",
      "  1  Introduction {sec:intro}  (1200 chars)",
      "    1.1  Motivation  (480 chars)",
      "  2  Method  (3200 chars)",
    ].join("\n");

    const directory = webArxivTocDirectory(apiToc);

    expect(directory).toBe(
      ["  1  Introduction", "    1.1  Motivation", "  2  Method"].join("\n"),
    );
    expect(directory).not.toContain("arxiv_get_section");
    expect(directory).not.toContain("zotero_get_full_pdf");
    expect(directory).not.toContain("cached locally");
    expect(directory).not.toContain("chars");
    expect(directory).not.toContain("sec:intro");
  });

  it("writes the directory-only text into the WEB attachment", async () => {
    const writeUTF8 = vi.fn(async () => undefined);
    vi.stubGlobal("Zotero", {
      DataDirectory: { dir: "/zotero" },
      Utilities: { randomString: () => "TOKEN" },
    });
    vi.stubGlobal("IOUtils", {
      makeDirectory: vi.fn(async () => undefined),
      writeUTF8,
    });

    const attachment = await createWebTocAttachment(
      [
        "[arXiv paper — section index]",
        "Use these tools to read source parts on demand:",
        "  • arxiv_get_section(section) — fetch ONE section",
        "Sections (number · title · body chars):",
        "  1  Introduction  (1200 chars)",
      ].join("\n"),
    );

    expect(attachment?.kind).toBe("text");
    expect(writeUTF8).toHaveBeenCalledOnce();
    const written = String(writeUTF8.mock.calls[0]?.[1]);
    expect(written).toBe("## arXiv 论文目录\n  1  Introduction");
    expect(written).not.toContain("arxiv_get_section");
  });

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
