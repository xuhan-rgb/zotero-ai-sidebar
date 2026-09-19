// MinerU prints a parsed table's grid into `content_list.json` as an HTML
// `<table>` (`table_body`). The composer should hand the model that grid as
// LaTeX — the numbers, not a page crop — so this turns the HTML into a
// `tabular` body, keeping the inline math MinerU leaves in `$...$`.

export function htmlTableToLatex(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const rows = Array.from(doc.querySelectorAll("table tr")) as Element[];

  if (
    rows.length === 0 ||
    !rows.some((row) => row.querySelectorAll("th, td").length > 0)
  ) {
    return null;
  }

  // Build the grid tracking rowspans
  const grid: string[][] = [];
  const held: number[] = []; // held[c] = rows still to skip in column c

  for (const row of rows) {
    const cells = Array.from(row.querySelectorAll("th, td")) as Element[];
    const out: string[] = [];
    let col = 0;

    for (const cell of cells) {
      // Columns a rowspan from an earlier row still owns.
      while ((held[col] ?? 0) > 0) {
        out.push("");
        held[col] -= 1;
        col += 1;
      }

      const colspan = Math.max(
        1,
        parseInt(cell.getAttribute("colspan") ?? "1", 10) || 1,
      );
      const rowspan = Math.max(
        1,
        parseInt(cell.getAttribute("rowspan") ?? "1", 10) || 1,
      );

      let content = escapeLatexText(cell.textContent ?? "");
      if (colspan > 1) content = `\\multicolumn{${colspan}}{l}{${content}}`;
      if (rowspan > 1) {
        content = `\\multirow{${rowspan}}{*}{${content}}`;
        for (let i = 0; i < colspan; i += 1) held[col + i] = rowspan - 1;
      }

      out.push(content);
      col += colspan;
    }

    while ((held[col] ?? 0) > 0) {
      out.push("");
      held[col] -= 1;
      col += 1;
    }

    grid.push(out);
  }

  // Determine column count (max row width)
  const colCount = Math.max(...grid.map((r) => r.length), 0);
  const colSpec = "l".repeat(colCount);

  // Build LaTeX rows
  const latexRows = grid.map((row) => {
    // Pad row to colCount
    while (row.length < colCount) {
      row.push("");
    }
    return row.join(" & ");
  });

  const lines = [
    `\\begin{tabular}{${colSpec}}`,
    "\\hline",
    latexRows[0] + " \\\\",
    "\\hline",
    ...latexRows.slice(1).map((r) => r + " \\\\"),
    "\\hline",
    "\\end{tabular}",
  ];

  return lines.join("\n");
}

function escapeLatexText(text: string): string {
  text = text.replace(/\s+/g, " ").trim();

  const LATEX_ESCAPES: Record<string, string> = {
    "\\": "\\textbackslash{}",
    "&": "\\&",
    "%": "\\%",
    "#": "\\#",
    _: "\\_",
    "{": "\\{",
    "}": "\\}",
    "~": "\\textasciitilde{}",
    "^": "\\textasciicircum{}",
  };

  // Split on $ to separate math from text
  const parts = text.split("$");
  return parts
    .map((part, idx) => {
      if (idx % 2 === 1) {
        // Odd indices are inside $...$ math mode, keep verbatim
        return "$" + part + "$";
      } else {
        // Even indices are plain text, escape LaTeX specials
        return part.replace(/[\\&%#_{}~^]/g, (char) => LATEX_ESCAPES[char]!);
      }
    })
    .join("");
}
