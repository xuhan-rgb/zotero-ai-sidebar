import { describe, expect, it } from "vitest";
import { assistantContentToNoteHTML } from "../../src/modules/note-pdf-render";

describe("assistant result tables in notes", () => {
  it("does not rewrite quoted LaTeX result rows as HTML tables", async () => {
    const html = await assistantContentToNoteHTML(
      document,
      null,
      "> “Copy\\&Paste & 3D-Occ & None & 66.38 & \\cellcolor{gray!30}20.52”",
    );

    expect(html).not.toContain("<table");
    expect(html).toContain("Copy\\&amp;Paste");
    expect(html).toContain("\\cellcolor");
  });

  it("writes a rendered DOT diagram as one Zotero embedded image", async () => {
    const html = await assistantContentToNoteHTML(
      document,
      null,
      "```dot\ndigraph LAW { A -> B; }\n```",
      null,
      {
        parentNoteID: 42,
        embedDiagram: async (_svg, parentNoteID) => {
          expect(parentNoteID).toBe(42);
          return "DIAGRAM1";
        },
      },
    );

    expect(html).toContain('data-attachment-key="DIAGRAM1"');
    expect(html).not.toContain("mindmap-block");
    expect(html).not.toContain("复制图片");
    expect(html).not.toContain("digraph LAW");
  });

  it("falls back to source only when no note is available for image embedding", async () => {
    const html = await assistantContentToNoteHTML(
      document,
      null,
      "```dot\ndigraph LAW { A -> B; }\n```",
    );

    expect(html).toContain("digraph LAW");
    expect(html).not.toContain("mindmap-block");
    expect(html).not.toContain("复制图片");
  });
});
