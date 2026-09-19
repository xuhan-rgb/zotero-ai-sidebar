import { describe, it, expect } from "vitest";
import { htmlTableToLatex } from "../../src/modules/html-table-latex";

describe("htmlTableToLatex", () => {
  it("converts a simple table to LaTeX tabular", () => {
    const html = `
      <table>
        <tr><td>Type of action</td><td>Scenarios</td></tr>
        <tr><td>Upper body movement</td><td>Directions</td></tr>
        <tr><td>Discussion</td><td>144</td></tr>
      </table>
    `;
    const result = htmlTableToLatex(html);
    expect(result).toContain("\\begin{tabular}{ll}");
    expect(result).toContain("Type of action & Scenarios \\\\");
    expect(result).toContain("Upper body movement & Directions \\\\");
    expect(result).toContain("Discussion & 144 \\\\");
    expect(result).toContain("\\hline");
  });

  it("handles colspan with \\multicolumn", () => {
    const html = `
      <table>
        <tr><td colspan="2">Header spanning two columns</td></tr>
        <tr><td>A</td><td>B</td></tr>
      </table>
    `;
    const result = htmlTableToLatex(html);
    expect(result).toContain(
      "\\multicolumn{2}{l}{Header spanning two columns}",
    );
    expect(result).toContain("A & B \\\\");
  });

  it("handles rowspan with \\multirow and empty placeholders", () => {
    const html = `
      <table>
        <tr><td rowspan="2">Spanning</td><td>Row 1</td></tr>
        <tr><td>Row 2</td></tr>
      </table>
    `;
    const result = htmlTableToLatex(html);
    expect(result).toContain("\\multirow{2}{*}{Spanning}");
    expect(result).toContain("\\multirow{2}{*}{Spanning} & Row 1 \\\\");
    // The second row should have an empty cell in the first column (occupied by rowspan)
    // followed by "Row 2" in the second column
    expect(result).toContain(" & Row 2 \\\\");
  });

  it("preserves inline math $...$ and escapes LaTeX specials in text", () => {
    const html = `
      <table>
        <tr><td>Cost & Price</td><td>$x^2 + y_0$</td></tr>
        <tr><td>100%</td><td>$\\alpha$</td></tr>
        <tr><td>a\\b ~ c ^ d</td><td>ok</td></tr>
      </table>
    `;
    const result = htmlTableToLatex(html);
    expect(result).toContain("Cost \\& Price");
    expect(result).toContain("$x^2 + y_0$");
    expect(result).toContain("100\\%");
    expect(result).toContain("$\\alpha$");
    expect(result).toContain(
      "a\\textbackslash{}b \\textasciitilde{} c \\textasciicircum{} d",
    );
  });

  it("returns null for empty HTML", () => {
    expect(htmlTableToLatex("")).toBeNull();
  });

  it("returns null for HTML with no table", () => {
    expect(htmlTableToLatex("<div>Not a table</div>")).toBeNull();
  });

  it("returns null for table with no rows", () => {
    expect(htmlTableToLatex("<table></table>")).toBeNull();
  });

  it("returns null for table with empty rows", () => {
    expect(htmlTableToLatex("<table><tr></tr></table>")).toBeNull();
  });
});
