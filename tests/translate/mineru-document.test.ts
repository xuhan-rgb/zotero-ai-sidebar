import { describe, expect, it } from "vitest";
import {
  buildMineruTranslationDocument,
  pdfTranslationDocumentId,
} from "../../src/translate/mineru-document";

describe("MinerU translation document", () => {
  it("retains valid PDF coordinates on text, figures, formulas and tables", () => {
    const document = buildMineruTranslationDocument("pdf:TEST", "", [
      { type: "title", text: "Title", page_idx: 0, bbox: [10, 20, 900, 80] },
      { type: "text", text: "Text", page_idx: 2, bbox: [503, 232, 923, 369] },
      { type: "equation", text: "E=mc^2", page_idx: 2, bbox: [10, 400, 900, 450] },
      { type: "image", img_path: "images/one.png", page_idx: 3, bbox: [10, 20, 900, 800] },
      { type: "table", table_caption: ["Results"], page_idx: 4, bbox: [10, 20, 900, 800] },
      { type: "text", text: "Invalid region", page_idx: -1, bbox: [10, 20, 900, 800] },
      { type: "text", text: "No coordinates" },
      { type: "text", text: "Inverted region", page_idx: 2, bbox: [900, 20, 10, 800] },
    ]);
    expect(document.blocks.slice(0, 5).map((block) => block.pdfLocation?.pageIndex)).toEqual([0, 2, 2, 3, 4]);
    expect(document.blocks[1]?.pdfLocation?.bbox).toEqual([503, 232, 923, 369]);
    expect(document.blocks.slice(5).every((block) => !block.pdfLocation)).toBe(true);
  });

  it.each(["References", "VII. REFERENCES", "Bibliography", "参考文献"])(
    "preserves entries under %s while translating prose and appendices",
    (heading) => {
      const texts = ["Paper", "We use the method in [1].", heading, "[1] Author. A paper title.", "Appendix", "Additional results."];
      const contentList = texts.map((text, index) => ({
        type: "text", text, ...([0, 2, 4].includes(index) ? { text_level: 1 } : {}),
      }));
      const markdown = texts.map((text, index) => [0, 2, 4].includes(index) ? `# ${text}` : text).join("\n\n");
      for (const list of [contentList, null]) {
        const document = buildMineruTranslationDocument("pdf:TEST", markdown, list);
        expect(document.blocks.map((block) => block.translatable)).toEqual([true, true, true, false, true, true]);
        expect(document.blocks[3]?.source).toBe(texts[3]);
      }
    },
  );

  it("groups the positioned author area before the abstract without translating it", () => {
    const document = buildMineruTranslationDocument("pdf:TEST", "", [
      { type: "text", text: "Paper title", text_level: 1, page_idx: 0, bbox: [80, 60, 920, 95] },
      { type: "text", text: "First Author", page_idx: 0, bbox: [190, 116, 310, 132] },
      { type: "text", text: "University", page_idx: 0, bbox: [175, 133, 330, 148] },
      { type: "text", text: "first@example.org", page_idx: 0, bbox: [190, 148, 310, 164] },
      { type: "text", text: "Second Author University second@example.org", page_idx: 0, bbox: [420, 116, 575, 164] },
      { type: "text", text: "Abstract—Our findings.", page_idx: 0, bbox: [73, 214, 493, 568] },
      { type: "text", text: "Introduction", text_level: 2 },
      { type: "text", text: "Body text." },
    ]);
    expect(document.blocks.map((block) => block.kind)).toEqual([
      "title", "metadata", "abstract", "heading", "paragraph",
    ]);
    expect(document.blocks[1]).toMatchObject({
      source: "First Author · University · first@example.org  \nSecond Author University second@example.org",
      translatable: false,
    });
  });

  it("does not classify unpositioned prose before an abstract as author metadata", () => {
    const document = buildMineruTranslationDocument("pdf:TEST", "", [
      { type: "title", text: "Title" },
      { type: "text", text: "A preliminary discussion." },
      { type: "text", text: "Abstract. Results." },
    ]);
    expect(document.blocks[1]?.kind).toBe("paragraph");
  });

  it("preserves image and chart paths, captions and captionless images", () => {
    const document = buildMineruTranslationDocument("pdf:TEST", "", [
      { type: "image", img_path: "images/one.jpg", image_caption: ["Fig. 1. Device"] },
      { type: "chart", img_path: "images/two.jpg", chart_caption: ["Fig. 2. Results"] },
      { type: "image", img_path: "images/three.png" },
    ]);
    expect(document.blocks.map((block) => block.assets)).toEqual([
      ["images/one.jpg"], ["images/two.jpg"], ["images/three.png"],
    ]);
    expect(document.blocks[1]?.source).toBe("Fig. 2. Results");
    expect(document.blocks[2]?.translatable).toBe(false);
  });
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

  it("preserves a standalone Markdown image when content_list is missing", () => {
    const document = buildMineruTranslationDocument("pdf:TEST", "# Title\n\n![Device](images/device.jpg)", null);
    expect(document.blocks[1]).toMatchObject({ kind: "figure-caption", source: "Device", assets: ["images/device.jpg"] });
  });
});
