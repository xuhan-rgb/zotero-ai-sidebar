import { describe, expect, it } from "vitest";
import {
  buildMineruTranslationDocument,
  pdfTranslationDocumentId,
} from "../../src/translate/mineru-document";

describe("MinerU translation document", () => {
  it("turns content_list titles, formulas and paragraphs into blocks", () => {
    const document = buildMineruTranslationDocument("pdf:ABCD1234", "", [
      { type: "title", text: "A Latent World Model", text_level: 1 },
      { type: "text", text: "Abstract. We propose a model." },
      { type: "heading", text: "Method", text_level: 2 },
      { type: "text", text: "The encoder is a transformer." },
      { type: "equation", text: "f^l_\\theta(o_t)", text_format: "latex" },
      { type: "table", table_caption: ["Table 1. Results"], table_body: "<table><tr><td>mAP</td><td>40.1</td></tr></table>" },
      { type: "header", text: "arXiv preprint" },
    ]);

    expect(document.arxivId).toBe("pdf:ABCD1234");
    expect(document.blocks[0]).toMatchObject({
      id: "title",
      kind: "title",
      source: "A Latent World Model",
    });
    expect(document.blocks.map((block) => block.kind)).toContain("formula");
    expect(
      document.blocks.find((block) => block.kind === "formula")?.translatable,
    ).toBe(false);
    expect(
      document.blocks.find((block) => block.kind === "table-caption"),
    ).toMatchObject({
      source: "Table 1. Results",
      table: { rows: [["mAP", "40.1"]] },
    });
    expect(document.blocks.some((block) => block.source.includes("arXiv preprint"))).toBe(
      false,
    );
  });

  it("falls back to markdown when content_list is missing", () => {
    const document = buildMineruTranslationDocument(
      pdfTranslationDocumentId("ITEMKEY1"),
      ["# Paper title", "The first paragraph.", "$$E=mc^2$$", "## Method", "Details."].join(
        "\n\n",
      ),
      null,
    );
    expect(document.arxivId).toBe("pdf:ITEMKEY1");
    expect(document.blocks[0]?.kind).toBe("title");
    expect(document.blocks.some((block) => block.kind === "formula")).toBe(true);
    expect(document.blocks.some((block) => block.kind === "heading")).toBe(true);
  });
});
