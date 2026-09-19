// Readable previews for the LaTeX material the `@` picker offers: KaTeX paints
// formulas, and tables get a small grid built from their `tabular` body, so the
// list shows what an item *is* instead of a truncated line of source.

import { readBalanced, skipSpaces } from "../context/tex-parse-utils";
import { findNextMathRegion, renderMathInto } from "../ui/math";
import type { PaperFigureKind } from "./paper-figures";

/**
 * The rendered node a picked 公式/表格 prints as — the same painting the `@`
 * list uses, so the composer chip preview matches what the picker showed.
 * Returns null when the source cannot be typeset (arXiv formulas whose
 * fragments KaTeX rejects, tables without a `tabular` body).
 */
export function latexMaterialPreview(
  doc: Document,
  kind: PaperFigureKind,
  latex: string,
): HTMLElement | null {
  if (!latex) return null;
  if (kind === "table") {
    const preview = latexTablePreview(latex);
    return preview ? latexTablePreviewNode(doc, preview.rows) : null;
  }
  // `$$…$$` and `\begin{equation}…\end{equation}` arrive as written; the math
  // reader hands back just the body KaTeX can typeset.
  const region = findNextMathRegion(latex, 0);
  const source = (region?.latex ?? latex).trim();
  if (!source) return null;
  const node = doc.createElement("span");
  node.className = "figure-item-math";
  renderMathInto(
    node,
    { start: 0, end: source.length, latex: source, display: true },
    "html",
  );
  return node.textContent?.trim() ? node : null;
}

/** The small `<table>` a parsed `tabular` body prints as. */
export function latexTablePreviewNode(
  doc: Document,
  rows: string[][],
): HTMLElement {
  const box = doc.createElement("span");
  box.className = "figure-item-table";
  const table = doc.createElement("table");
  const columns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  for (const row of rows) {
    const tr = doc.createElement("tr");
    for (let index = 0; index < columns; index += 1) {
      const cell = doc.createElement(index === 0 ? "th" : "td");
      cell.textContent = row[index] ?? "";
      tr.append(cell);
    }
    table.append(tr);
  }
  box.append(table);
  return box;
}

export interface LatexTablePreview {
  /** Plain-text cells, already trimmed to the requested size. */
  rows: string[][];
  /** True when the table has more rows or columns than the preview shows. */
  truncated: boolean;
}

const TABULAR_ENV_RE = /\\begin\{(tabular\*?|tabularx|longtable)\}/g;

/** Commands whose last braced argument is the text to keep. */
const TEXT_COMMANDS: Record<string, number> = {
  textbf: 1,
  textit: 1,
  texttt: 1,
  textrm: 1,
  textsf: 1,
  emph: 1,
  text: 1,
  textsuperscript: 1,
  textsubscript: 1,
  mathrm: 1,
  mathbf: 1,
  mathit: 1,
  mathsf: 1,
  mathbb: 1,
  mathcal: 1,
  makecell: 1,
  shortstack: 1,
  multicolumn: 3,
  multirow: 3,
};

const SYMBOLS: Record<string, string> = {
  pm: "±",
  mp: "∓",
  times: "×",
  cdot: "·",
  leq: "≤",
  le: "≤",
  geq: "≥",
  ge: "≥",
  neq: "≠",
  ne: "≠",
  approx: "≈",
  sim: "~",
  propto: "∝",
  infty: "∞",
  pmb: "",
  degree: "°",
  circ: "°",
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  Delta: "Δ",
  epsilon: "ε",
  theta: "θ",
  lambda: "λ",
  mu: "μ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  phi: "φ",
  psi: "ψ",
  omega: "ω",
  rightarrow: "→",
  to: "→",
  leftarrow: "←",
  quad: " ",
  qquad: " ",
};

/**
 * The grid a table prints as, or null when the source has no `tabular` body we
 * can read (a table written as pure `\includegraphics`, for instance).
 */
export function latexTablePreview(
  latex: string,
  maxRows = 3,
  maxColumns = 4,
): LatexTablePreview | null {
  const body = tabularBody(latex);
  if (!body) return null;
  const rows: string[][] = [];
  let truncated = false;
  for (const row of splitTableRows(body)) {
    if (!row.trim() || isRuleRow(row)) continue;
    const cells = splitTableCells(row).map(latexPreviewText);
    if (!cells.some(Boolean)) continue;
    if (rows.length >= maxRows) {
      truncated = true;
      continue;
    }
    if (cells.length > maxColumns) truncated = true;
    rows.push(cells.slice(0, maxColumns));
  }
  return rows.length ? { rows, truncated } : null;
}

/** Strips a table cell (or any short snippet) down to what it prints as. */
export function latexPreviewText(latex: string): string {
  return unwrapCommands(stripSymbols(latex), 0)
    .replace(/\^\s*\{([^{}]*)\}/g, "$1")
    .replace(/\^([^\w\s])/g, "$1")
    .replace(/\\[A-Za-z]+\*?/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tabularBody(latex: string): string | null {
  TABULAR_ENV_RE.lastIndex = 0;
  const match = TABULAR_ENV_RE.exec(latex);
  if (!match) return null;
  let cursor = skipSpaces(latex, match.index + match[0].length);
  // `tabular`/`longtable` carry a column spec, `tabularx` a width first.
  for (let index = 0; index < (match[1] === "tabularx" ? 2 : 1); index += 1) {
    const arg = readBalanced(latex, cursor, "{", "}");
    if (!arg) return null;
    cursor = skipSpaces(latex, arg.end);
  }
  const end = latex.indexOf("\\end{", cursor);
  return end < 0 ? null : latex.slice(cursor, end);
}

function splitTableRows(body: string): string[] {
  const rows: string[] = [];
  let current = "";
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]!;
    if (char === "\\") {
      const next = body[index + 1];
      if (next === "\\") {
        rows.push(current);
        current = "";
        index += 1;
        continue;
      }
      current += char + (next ?? "");
      index += 1;
      continue;
    }
    current += char;
  }
  if (current.trim()) rows.push(current);
  return rows;
}

/** Splits on `&`, ignoring separators inside braces or math. */
function splitTableCells(row: string): string[] {
  const cells: string[] = [];
  let current = "";
  let depth = 0;
  for (let index = 0; index < row.length; index += 1) {
    const char = row[index]!;
    if (char === "\\") {
      current += char + (row[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") depth = Math.max(0, depth - 1);
    if (char === "&" && depth === 0) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function isRuleRow(row: string): boolean {
  return /^\s*\\(?:hline|toprule|midrule|bottomrule|cmidrule|cline)\b/.test(row)
    ? latexPreviewText(row.replace(/\\cline\{[^}]*\}/g, " ")).length === 0
    : false;
}

function stripSymbols(text: string): string {
  return text
    .replace(/\\cline\{[^}]*\}/g, " ")
    .replace(/\\\\(?:hline|toprule|midrule|bottomrule)\b/g, " ")
    .replace(/\\([A-Za-z]+)\b/g, (match, name: string) => {
      const symbol = SYMBOLS[name];
      return symbol == null ? match : symbol;
    })
    .replace(/\\([&%$#_{}])/g, "$1")
    .replace(/\\[,;:!]/g, " ")
    .replace(/\$/g, "");
}

/** Keeps the printed argument of `\textbf{...}`-style commands. */
function unwrapCommands(text: string, depth: number): string {
  if (depth > 2) return text;
  let out = "";
  let cursor = 0;
  while (cursor < text.length) {
    const at = text.indexOf("\\", cursor);
    if (at < 0) break;
    const name = /^\\([A-Za-z]+)/.exec(text.slice(at))?.[1];
    const args = name ? TEXT_COMMANDS[name] : undefined;
    if (args == null) {
      out += text.slice(cursor, at + 1);
      cursor = at + 1;
      continue;
    }
    let end = at + name!.length + 1;
    const kept: string[] = [];
    for (let index = 0; index < args; index += 1) {
      end = skipSpaces(text, end);
      const arg = readBalanced(text, end, "{", "}");
      if (!arg) break;
      kept.push(arg.content);
      end = arg.end;
    }
    if (!kept.length) {
      out += text.slice(cursor, at + 1);
      cursor = at + 1;
      continue;
    }
    out += text.slice(cursor, at) + unwrapCommands(kept[kept.length - 1]!, depth + 1);
    cursor = end;
  }
  return out + text.slice(cursor);
}
