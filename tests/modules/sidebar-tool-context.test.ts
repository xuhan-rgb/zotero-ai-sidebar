import { describe, expect, it } from "vitest";
import { mergeToolContext } from "../../src/modules/sidebar";

describe("sidebar tool context", () => {
  it("keeps the attached arXiv directory metadata after reading a section", () => {
    const merged = mergeToolContext(
      {
        fullTextSource: "arxiv_toc",
        fullTextChars: 1719,
      },
      {
        fullTextSource: "arxiv",
        fullTextChars: 3436,
        planMode: "full_pdf",
      },
    );

    expect(merged).toMatchObject({
      fullTextSource: "arxiv_toc",
      fullTextChars: 1719,
      planMode: "full_pdf",
    });
  });
});
