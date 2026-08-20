import {
  findNextMathRegion,
  hasUnclosedDisplayMath,
  renderMathInto,
  type MathRenderMode,
  type MathRegion,
} from "../ui/math";
import {
  findNextCitationCommand,
  findNextLatexTextCommand,
  normalizeCitations,
  normalizeLatexListEnvironments,
  normalizeLatexSourceCommands,
  normalizeLatexTextCommands,
  type LatexTextCommandKind,
} from "../context/tex-clean";
import { parseMermaidMindmap, renderMindmapBlock } from "./mindmap-render";
import { parseMermaidFlowchart } from "./mermaid-flowchart";
import { parseGraphvizDot } from "./graphviz-dot";

interface ListState {
  tag: "ol" | "ul";
  element: HTMLElement;
  lastItem: HTMLLIElement | null;
}

interface MarkdownListItem {
  text: string;
  ordered: boolean;
  level: number;
}

// Hand-rolled Markdown block parser.
// =====================================================================
// WHY hand-rolled (not a library):
//   1. SECURITY — model output runs in the privileged Zotero XUL context.
//      Every text node is created via `createTextNode` / `textContent` so
//      a prompt-injected `<script>` or `<iframe>` cannot execute. A
//      general-purpose Markdown lib would need a sanitizer pass and we'd
//      still be one library upgrade away from a regression.
//   2. STREAMING — open delimiters (e.g. unclosed `**`) fall back to
//      literal text rather than corrupting subsequent chunks. The
//      renderer is called repeatedly during streaming with growing
//      content; partial syntax must never produce broken DOM.
//   3. BUNDLE SIZE — Zotero plugin loads in a XUL window; we want zero
//      external runtime cost for chat rendering.
//
// Supported subset (block):
//   #/##/###/#### headings, ordered+unordered lists (one nested level),
//   ```fence``` code blocks, > blockquote, GFM pipe tables, paragraphs.
// NOT supported: HR, image syntax, deep nested lists, setext headings.
// REF: Claudian's MessageRenderer (similar minimal subset for the same
//      streaming reasons); CommonMark spec we deliberately don't follow.
export function renderMarkdownInto(
  target: HTMLElement,
  markdown: string,
  mathMode: MathRenderMode = "html",
) {
  const doc = target.ownerDocument!;
  target.replaceChildren();
  const normalized = repairDetachedGraphvizFenceLanguage(
    markdown.replaceAll("\r\n", "\n").replaceAll("\r", "\n"),
  );
  const lines = normalized.split("\n");
  let paragraph: string[] = [];
  let listStack: ListState[] = [];
  let blockquoteLines: string[] = [];
  let codeLines: string[] | null = null;
  let codeLanguage = "";

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const blockMath = extractStandaloneDisplayMathParagraph(paragraph);
    if (blockMath) {
      renderMathInto(target, blockMath, mathMode);
      paragraph = [];
      return;
    }
    const orphanEnvMath = extractOrphanedEnvMathParagraph(paragraph);
    if (orphanEnvMath) {
      renderMathInto(target, orphanEnvMath, mathMode);
      paragraph = [];
      return;
    }
    const inlineMathParagraph = extractWholeParagraphInlineMath(paragraph);
    if (inlineMathParagraph) {
      const p = doc.createElement("p");
      renderMathInto(p, inlineMathParagraph.region, mathMode);
      if (inlineMathParagraph.trailingText) {
        p.append(doc.createTextNode(inlineMathParagraph.trailingText));
      }
      target.append(p);
      paragraph = [];
      return;
    }
    const p = doc.createElement("p");
    // Normalize loose single-$ math lines (`$ … $,` padded with spaces just
    // inside the dollars, which the strict inline-$ guard rejects) the same way
    // the blockquote path does, so such a line opening or sitting inside a
    // multi-line paragraph still typesets instead of leaking as raw LaTeX.
    const paragraphText = paragraph
      .map((line) => normalizeLooseSingleDollarMathLine(line))
      .join(" ");
    appendInlineMarkdown(p, paragraphText, mathMode);
    // Display math in source mode emits a block element. Nesting that inside
    // <p> is invalid HTML and note parsers may drop or duplicate it. Hoist
    // block children up to `target` and emit surrounding inline text as <p>'s.
    if (p.querySelector(":scope > pre, :scope > div.math-display")) {
      flushParagraphWithBlockHoist(target, p);
    } else {
      target.append(p);
    }
    paragraph = [];
  };

  const flushList = () => {
    listStack = [];
  };

  const flushBlockquote = () => {
    if (!blockquoteLines.length) return;
    const quote = doc.createElement("blockquote");
    appendInlineMarkdownWithLineBreaks(
      quote,
      blockquoteLines.join("\n"),
      mathMode,
    );
    target.append(quote);
    blockquoteLines = [];
  };

  const appendListItem = (item: MarkdownListItem) => {
    flushParagraph();
    flushBlockquote();
    const tag = item.ordered ? "ol" : "ul";
    let level = Math.min(item.level, 1);
    if (level > 0 && !listStack[level - 1]?.lastItem) level = 0;

    if (level === 0) {
      if (!listStack[0] || listStack[0].tag !== tag) {
        const element = doc.createElement(tag);
        target.append(element);
        listStack = [{ tag, element, lastItem: null }];
      } else {
        listStack = [listStack[0]];
      }
    } else {
      const parent = listStack[level - 1].lastItem!;
      if (!listStack[level] || listStack[level].tag !== tag) {
        const element = doc.createElement(tag);
        parent.append(element);
        listStack[level] = { tag, element, lastItem: null };
      }
      listStack = listStack.slice(0, level + 1);
    }

    const list = listStack[level].element;
    const li = doc.createElement("li");
    appendInlineMarkdown(li, item.text, mathMode);
    list.append(li);
    listStack[level].lastItem = li;
  };

  const appendBlockquoteLine = (text: string) => {
    flushParagraph();
    flushList();
    blockquoteLines.push(text);
  };

  // INVARIANT: code body uses `textContent`, NOT innerHTML — prompt
  // injection inside fenced code stays as displayed text. Class name uses
  // `language-${lang}` for any future syntax-highlighting CSS hook.
  // Special case: `mermaid` blocks with a `mindmap` diagram are rendered as
  // inline SVG using our dagre+SVG renderer (Mermaid library is CSP-blocked).
  const flushCode = () => {
    if (codeLines == null) return;
    const raw = codeLines.join("\n");
    if (codeLanguage === "mermaid") {
      const parsed = parseMermaidMindmap(raw);
      if (parsed) {
        parsed.source = raw;
        target.append(renderMindmapBlock(doc, parsed));
        codeLines = null;
        codeLanguage = "";
        return;
      }
      const flow = parseMermaidFlowchart(raw);
      if (flow) {
        flow.source = raw;
        target.append(renderMindmapBlock(doc, flow));
        codeLines = null;
        codeLanguage = "";
        return;
      }
    }
    const graphvizCandidate =
      codeLanguage === "dot" ||
      codeLanguage === "graphviz" ||
      (!codeLanguage && /^(?:strict\s+)?(?:di)?graph\b/i.test(raw.trim()));
    if (graphvizCandidate) {
      const graph = parseGraphvizDot(raw);
      if (graph) {
        target.append(renderMindmapBlock(doc, graph, { sourceName: "DOT" }));
        codeLines = null;
        codeLanguage = "";
        return;
      }
    }
    const mathLatex = graphvizCandidate
      ? null
      : mathFenceToDisplayLatex(raw, codeLanguage);
    if (mathLatex) {
      renderMathInto(target, mathRegion(mathLatex), mathMode);
      codeLines = null;
      codeLanguage = "";
      return;
    }
    const pre = doc.createElement("pre");
    const code = doc.createElement("code");
    if (codeLanguage) code.className = `language-${codeLanguage}`;
    code.textContent = raw;
    pre.append(code);
    target.append(pre);
    codeLines = null;
    codeLanguage = "";
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      if (codeLines == null) {
        flushParagraph();
        flushList();
        flushBlockquote();
        codeLines = [];
        codeLanguage = line.slice(3).trim();
      } else {
        flushCode();
      }
      continue;
    }

    if (codeLines != null) {
      codeLines.push(line);
      continue;
    }

    // Inside an open multi-line display-math block ($$ … , \[ … , \begin{env} …,
    // or a standalone single-$ block), every line is math body — including
    // blank lines and lines starting with > / # / - / | that the block scanner
    // would otherwise misread as a blockquote / heading / list / table and tear
    // the formula apart. Mirrors how an open ``` fence swallows lines until it
    // closes; flushParagraph then typesets the whole region.
    if (paragraph.length && hasUnclosedDisplayMath(paragraph.join("\n"))) {
      paragraph.push(line.trim());
      continue;
    }

    if (!line.trim()) {
      let nextNonBlank = i + 1;
      while (nextNonBlank < lines.length && !lines[nextNonBlank]!.trim()) {
        nextNonBlank++;
      }
      const nextDelimiter = standaloneDisplayEnvDelimiter(
        lines[nextNonBlank] ?? "",
      );
      if (paragraph.length && nextDelimiter?.kind === "end") {
        paragraph.push("");
        continue;
      }
      flushParagraph();
      flushList();
      flushBlockquote();
      continue;
    }

    const headingLevel = markdownHeadingLevel(line);
    if (headingLevel > 0) {
      flushParagraph();
      flushList();
      flushBlockquote();
      const heading = doc.createElement(`h${headingLevel}`);
      appendInlineMarkdown(
        heading,
        line.slice(headingLevel + 1).trim(),
        mathMode,
      );
      target.append(heading);
      continue;
    }

    const quote = blockquoteText(line);
    if (quote != null) {
      appendBlockquoteLine(quote);
      continue;
    }

    if (isPipeTableStart(lines, i)) {
      flushParagraph();
      flushList();
      flushBlockquote();
      const delimiterLine = lines[i + 1]!;
      const tableLines = [line];
      i += 2;
      while (i < lines.length && isPipeTableRow(lines[i]!)) {
        tableLines.push(lines[i]!);
        i++;
      }
      i--;
      appendPipeTable(target, tableLines, delimiterLine, mathMode);
      continue;
    }

    const listItem = markdownListItem(line);
    if (listItem) {
      appendListItem(listItem);
      continue;
    }

    flushBlockquote();
    paragraph.push(line.trim());
  }

  flushCode();
  flushParagraph();
  flushBlockquote();
}

function isPipeTableStart(lines: string[], index: number): boolean {
  const header = lines[index];
  const delimiter = lines[index + 1];
  if (header == null || delimiter == null) return false;
  const headerCells = pipeTableCells(header);
  const delimiterCells = pipeTableCells(delimiter);
  return (
    !!headerCells &&
    !!delimiterCells &&
    headerCells.length >= 2 &&
    delimiterCells.length === headerCells.length &&
    delimiterCells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
  );
}

function isPipeTableRow(line: string): boolean {
  return !!pipeTableCells(line);
}

function appendPipeTable(
  target: HTMLElement,
  tableLines: string[],
  delimiterLine: string,
  mathMode: MathRenderMode,
): void {
  const doc = target.ownerDocument!;
  const header = pipeTableCells(tableLines[0]!) ?? [];
  if (header.length < 2) return;
  const rows = tableLines.slice(1).map((line) => pipeTableCells(line) ?? []);
  const alignments = pipeTableAlignments(delimiterLine);

  const wrap = doc.createElement("div");
  wrap.className = "markdown-table-wrap";
  const table = doc.createElement("table");
  table.className = "markdown-table";

  const thead = doc.createElement("thead");
  const headRow = doc.createElement("tr");
  header.forEach((cell, index) => {
    const th = doc.createElement("th");
    applyTableCellAlignment(th, alignments[index]);
    appendInlineMarkdown(th, cell.trim(), mathMode);
    headRow.append(th);
  });
  thead.append(headRow);
  table.append(thead);

  const tbody = doc.createElement("tbody");
  for (const row of rows) {
    const tr = doc.createElement("tr");
    for (let index = 0; index < header.length; index++) {
      const td = doc.createElement("td");
      applyTableCellAlignment(td, alignments[index]);
      appendInlineMarkdown(td, (row[index] ?? "").trim(), mathMode);
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
  target.append(wrap);
}

function pipeTableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  const source = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const withoutEdge = source.endsWith("|") ? source.slice(0, -1) : source;
  const cells: string[] = [];
  let current = "";
  let inCode = false;
  let inMath = false;
  for (let i = 0; i < withoutEdge.length; i++) {
    const ch = withoutEdge[i]!;
    if (ch === "`") inCode = !inCode;
    // A `$` toggles an inline-math span; a `|` inside `$…$` (e.g. set-builder
    // notation `$\{x | x>0\}$`) is math content, not a column separator — same
    // protection already given to `|` inside backtick code spans.
    else if (ch === "$" && !inCode) inMath = !inMath;
    if (ch === "|" && !inCode && !inMath && withoutEdge[i - 1] !== "\\") {
      cells.push(current.replace(/\\\|/g, "|"));
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.replace(/\\\|/g, "|"));
  return cells.length >= 2 ? cells : null;
}

type PipeTableAlignment = "left" | "center" | "right" | undefined;

function pipeTableAlignments(delimiterLine: string): PipeTableAlignment[] {
  return (pipeTableCells(delimiterLine) ?? []).map((cell) => {
    const trimmed = cell.trim();
    const left = trimmed.startsWith(":");
    const right = trimmed.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return undefined;
  });
}

function applyTableCellAlignment(
  cell: HTMLTableCellElement,
  alignment: PipeTableAlignment,
): void {
  if (alignment) cell.style.textAlign = alignment;
}

function mathRegion(latex: string): MathRegion {
  return { start: 0, end: latex.length, latex, display: true };
}

function extractStandaloneDisplayMathParagraph(
  paragraph: string[],
): MathRegion | null {
  const raw = paragraph.join("\n").trim();
  if (!raw) return null;
  const region = findNextMathRegion(raw, 0);
  return region && region.start === 0 && region.end === raw.length && region.display
    ? region
    : null;
}

// Outer display-math environments a model writes bare (not the inner
// aligned/gathered, which live inside `$$`). Used to detect an environment a
// model split across a blockquote boundary.
const DISPLAY_MATH_ENVIRONMENTS = new Set([
  "equation",
  "align",
  "gather",
  "multline",
  "displaymath",
]);

// A line that is exactly a display-math environment delimiter
// (`\begin{equation}` / `\end{align*}`), nothing else.
function standaloneDisplayEnvDelimiter(
  line: string,
): { kind: "begin" | "end"; env: string } | null {
  const match = line.trim().match(/^\\(begin|end)\{([a-zA-Z]+\*?)\}$/);
  if (!match) return null;
  const env = match[2]!;
  return DISPLAY_MATH_ENVIRONMENTS.has(env.replace(/\*$/, ""))
    ? { kind: match[1] as "begin" | "end", env }
    : null;
}

// A model split `\begin{equation} … \end{equation}` across a blockquote
// boundary, leaving an ORPHAN delimiter (begin without end, or vice versa) plus
// a bare LaTeX body in this paragraph. Reconstruct the full environment so the
// body typesets as display math. Returns null when delimiters are paired
// (extractStandaloneDisplayMathParagraph handles those) or absent.
function extractOrphanedEnvMathParagraph(
  paragraph: string[],
): MathRegion | null {
  const delimiters: Array<{ kind: "begin" | "end"; env: string }> = [];
  const bodyLines: string[] = [];
  for (const line of paragraph) {
    const delimiter = standaloneDisplayEnvDelimiter(line);
    if (delimiter) delimiters.push(delimiter);
    else bodyLines.push(line);
  }
  if (!delimiters.length) return null;
  const hasBegin = delimiters.some((d) => d.kind === "begin");
  const hasEnd = delimiters.some((d) => d.kind === "end");
  if (hasBegin && hasEnd) return null;
  const body = bodyLines.map((line) => line.trim()).filter(Boolean).join("\n");
  if (!body) return null;
  const env = delimiters[0]!.env;
  const region = findNextMathRegion(`\\begin{${env}}\n${body}\n\\end{${env}}`, 0);
  return region && region.display ? region : null;
}

// Strip orphan display-env delimiter lines (a `\begin{equation}` whose
// `\end{equation}` landed on the other side of a blockquote boundary, or vice
// versa). A complete, paired environment is left intact for findNextMathRegion.
function stripOrphanDisplayEnvDelimiters(text: string): string {
  const lines = text.split("\n");
  const delimiters = lines
    .map(standaloneDisplayEnvDelimiter)
    .filter((d): d is { kind: "begin" | "end"; env: string } => d != null);
  if (!delimiters.length) return text;
  if (delimiters.some((d) => d.kind === "begin") &&
      delimiters.some((d) => d.kind === "end")) {
    return text;
  }
  return lines.filter((line) => !standaloneDisplayEnvDelimiter(line)).join("\n");
}

function extractWholeParagraphInlineMath(
  paragraph: string[],
): { region: MathRegion; trailingText: string } | null {
  if (paragraph.length !== 1) return null;
  const raw = paragraph[0]!.trim();
  if (!raw.startsWith("$")) return null;

  const match = raw.match(/^\$\s*(.*?)\s*\$(?<tail>[,.;:]*)$/);
  if (!match) return null;
  const body = match[1]?.trim();
  if (!body) return null;
  if (body.includes("\n")) return null;
  if (/(?<!\\)\$/.test(body)) return null;

  return {
    region: {
      start: 0,
      end: raw.length,
      latex: body,
      display: false,
    },
    trailingText: match.groups?.tail ?? "",
  };
}

function repairDetachedGraphvizFenceLanguage(markdown: string): string {
  return markdown.replace(
    /(^|\n)[ \t]*(?:dot|graphviz)[ \t]*\n(?:[ \t]*\n)+[ \t]*```[ \t]*\n(?=[ \t]*(?:strict\s+)?(?:di)?graph\b)/gi,
    "$1```dot\n",
  );
}

function mathFenceToDisplayLatex(raw: string, language: string): string | null {
  if (!isMathLikeFenceLanguage(language)) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2000) return null;
  if (looksLikeLatexDocument(trimmed)) return null;

  const wrapped = findNextMathRegion(trimmed, 0);
  if (wrapped && wrapped.start === 0 && wrapped.end === trimmed.length) {
    return normalizeLatexLikeText(wrapped.latex);
  }

  if (!looksLikeFormulaBlock(trimmed)) return null;
  return alignMultilineFormula(
    trimmed
      .split("\n")
      .map((line) => normalizeLatexLikeText(line.trim()))
      .filter(Boolean),
  );
}

function isMathLikeFenceLanguage(language: string): boolean {
  const normalized = language.trim().toLowerCase();
  return ["", "text", "plain", "plaintext", "math", "latex", "tex"].includes(
    normalized,
  );
}

function looksLikeLatexDocument(text: string): boolean {
  return /\\(?:documentclass|usepackage|begin\{document\}|section\{)/.test(
    text,
  );
}

function looksLikeFormulaBlock(text: string): boolean {
  const hasLatexCommand =
    /\\(?:hat|frac|sum|prod|int|mathbb|theta|alpha|beta|gamma|delta|lambda|mu|pi|tau|omega|begin|end|left|right|cdot|times|sim|approx|leq?|geq?)\b/.test(
      text,
    );
  const hasGreek = /[α-ωΑ-Ω]/.test(text);
  const hasSubscriptOrSuperscript = /[_^](?:\{[^}]+\}|[A-Za-z0-9])/.test(text);
  const hasRelation =
    /(^|\s)(?:=|≤|≥|≈|∼|~|\\leq?|\\geq?|\\approx|\\sim)(\s|$)/m.test(text);
  const hasProbabilityShape = /\b(?:E|P|Pr)\s*(?:_|\[|\()/i.test(text);
  const score = [
    hasLatexCommand,
    hasGreek,
    hasSubscriptOrSuperscript,
    hasRelation,
    hasProbabilityShape,
  ].filter(Boolean).length;
  return (
    score >= 2 && (hasLatexCommand || hasGreek || hasSubscriptOrSuperscript)
  );
}

function normalizeLatexLikeText(text: string): string {
  return text
    .replace(/πθ/g, "\\pi_\\theta ")
    .replace(/([A-Za-z])\u0302/g, "\\hat{$1}")
    .replace(/[αβγδθλμστωπ]/g, (ch) => greekToken(ch))
    .replace(/[ΑΒΓΔΘΛΜΣΤΩΠ]/g, (ch) => greekToken(ch));
}

// A Greek glyph maps to a LaTeX token via `greekLatex`. A multi-letter
// command (`\theta`) gets a trailing space so a following ASCII letter
// cannot extend the command name into an undefined control sequence:
// `fθl` becomes `f\theta l`, never `f\thetal`. The space is invisible in
// KaTeX math-mode layout. Plain-letter mappings (Α→A) need no terminator.
function greekToken(ch: string): string {
  const token = greekLatex(ch);
  return token.startsWith("\\") ? `${token} ` : token;
}

function greekLatex(ch: string): string {
  const map: Record<string, string> = {
    α: "\\alpha",
    β: "\\beta",
    γ: "\\gamma",
    δ: "\\delta",
    θ: "\\theta",
    λ: "\\lambda",
    μ: "\\mu",
    σ: "\\sigma",
    τ: "\\tau",
    ω: "\\omega",
    π: "\\pi",
    Α: "A",
    Β: "B",
    Γ: "\\Gamma",
    Δ: "\\Delta",
    Θ: "\\Theta",
    Λ: "\\Lambda",
    Μ: "M",
    Σ: "\\Sigma",
    Τ: "T",
    Ω: "\\Omega",
    Π: "\\Pi",
  };
  return map[ch] ?? ch;
}

// A model frequently writes ONE formula across several source lines for
// readability. Those `\n` breaks are NOT display-row breaks: `groupAlignedRows`
// merges them back into delimiter-balanced rows first. Only when >= 2 genuine
// rows survive do we wrap them in an `aligned` environment; a single row is
// returned bare so `\left..\right` pairs are never split across `\\`.
function alignMultilineFormula(lines: string[]): string | null {
  if (!lines.length) return null;
  const rows = groupAlignedRows(lines);
  if (rows.length === 1) return rows[0];
  return [
    "\\begin{aligned}",
    rows.map((row) => alignFormulaLine(row)).join(" \\\\\n"),
    "\\end{aligned}",
  ].join("\n");
}

// Walk the source lines, merging each into the current row until
// `lineStartsNewAlignedRow` reports a genuine new equation. A `\\` row break
// is only ever emitted between the rows returned here, so a delimiter group
// (`\left..\right`, `\begin..\end`, `{..}`) can never straddle a row break.
function groupAlignedRows(lines: string[]): string[] {
  const rows: string[] = [];
  let current = "";
  let depth = 0;
  for (const line of lines) {
    if (current && lineStartsNewAlignedRow(line, depth)) {
      rows.push(current);
      current = line;
      depth = latexGroupDepthDelta(line);
    } else {
      current = current ? `${current} ${line}` : line;
      depth += latexGroupDepthDelta(line);
    }
  }
  if (current) rows.push(current);
  return rows;
}

// Decide whether `line` begins a new aligned display row or continues the
// current formula. Two source layouts are visually identical but mean
// opposite things: one formula wrapped across lines for readability (must
// merge) versus a multi-step derivation aligned at relations (each `= ...`
// is its own row).
//
// `pendingDepth` > 0 means an earlier line left a `\left` / `\begin` / `{`
// group open. Starting a row there would split the group across a `\\`
// break — `\left` with no matching `\right` in the row — which is invalid
// LaTeX KaTeX rejects. So depth safety overrides the relation signal.
function lineStartsNewAlignedRow(line: string, pendingDepth: number): boolean {
  if (pendingDepth > 0) return false;
  return startsWithRelation(line);
}

// Net change in open-delimiter depth contributed by one line. `\left` /
// `\begin{..}` / `{` open a group (+1); `\right` / `\end{..}` / `}` close
// one (-1). Escaped braces `\{` `\}` are literal glyphs and do not count.
function latexGroupDepthDelta(line: string): number {
  let depth = 0;
  for (const token of line.matchAll(/\\(?:left|right|begin|end)\b/g)) {
    depth += token[0] === "\\left" || token[0] === "\\begin" ? 1 : -1;
  }
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") {
      i++; // skip the escaped char: \{ \} \\ are not grouping braces
      continue;
    }
    if (line[i] === "{") depth++;
    else if (line[i] === "}") depth--;
  }
  return depth;
}

const RELATION_PREFIX = /^(?:=|≤|≥|≈|∼|~|\\leq?|\\geq?|\\approx|\\sim)(?:\s|$)/;

// True when `line` opens with a relation operator — the alignment point of
// a multi-step derivation step (`= ...`, `\leq ...`).
function startsWithRelation(line: string): boolean {
  return RELATION_PREFIX.test(line);
}

function alignFormulaLine(line: string): string {
  if (startsWithRelation(line)) {
    return `&${line}`;
  }
  const relation = line.match(
    /\s(?:=|≤|≥|≈|∼|~|\\leq?|\\geq?|\\approx|\\sim)\s/,
  );
  if (relation?.index != null) {
    const index = relation.index + 1;
    return `${line.slice(0, index)}&${line.slice(index)}`;
  }
  return `&${line}`;
}

function blockquoteText(line: string): string | null {
  const trimmed = trimListIndent(line);
  if (!trimmed.startsWith(">")) return null;
  const body = trimmed.slice(1);
  return body.startsWith(" ") || body.startsWith("\t")
    ? body.trimStart()
    : body;
}

// Walks `<p>`'s children, splitting at direct child blocks so display
// math (or any other block emitted by inline rendering) sits at block
// level instead of nested inside <p>. We preserve a fresh <p> only for
// runs of inline content; empty runs are dropped.
function flushParagraphWithBlockHoist(
  target: HTMLElement,
  p: HTMLElement,
): void {
  const doc = target.ownerDocument!;
  let buffer: HTMLElement = doc.createElement("p");
  const flushBuffer = () => {
    if (buffer.childNodes.length > 0) target.append(buffer);
    buffer = doc.createElement("p");
  };
  let preceedingPreFlushed = false;
  for (const child of Array.from(p.childNodes) as Node[]) {
    if (isHoistableInlineRenderBlock(child)) {
      flushBuffer();
      target.append(child);
      preceedingPreFlushed = true;
    } else {
      // After hoisting a <pre>, the joined-paragraph mechanic leaves a
      // single leading space on the next text node (paragraph.join(" ")
      // glue). Trim it so the resulting <p> doesn't start with " ".
      if (
        preceedingPreFlushed &&
        buffer.childNodes.length === 0 &&
        child.nodeType === 3
      ) {
        const stripped = (child.textContent ?? "").replace(/^\s+/, "");
        if (stripped) buffer.append(doc.createTextNode(stripped));
        preceedingPreFlushed = false;
      } else {
        buffer.append(child);
        preceedingPreFlushed = false;
      }
    }
  }
  flushBuffer();
}

function isHoistableInlineRenderBlock(node: Node): boolean {
  if (node.nodeType !== 1) return false;
  const el = node as HTMLElement;
  return (
    el.tagName === "PRE" ||
    (el.tagName === "DIV" && el.classList.contains("math-display"))
  );
}

// Inline markdown: `code`, **bold**, [label](url).
// Streaming-safe pattern: at each step we look for the EARLIEST opening
// delimiter; if its closing partner is not yet in the buffer, we emit the
// rest as literal text and return. WHY: during streaming, the next chunk
// may bring the closing delimiter — but until then, NEVER half-render a
// `<strong>` or `<a>` (those would have to be unwound on the next call).
// INVARIANT: every emitted node is either createTextNode or createElement
// with textContent; no innerHTML on any path.
function appendInlineMarkdown(
  parent: HTMLElement,
  text: string,
  mathMode: MathRenderMode = "html",
) {
  const doc = parent.ownerDocument!;
  let cursor = 0;

  while (cursor < text.length) {
    // Math is checked first because its delimiters can legitimately contain
    // characters that would otherwise be parsed as bold/link/code (e.g.
    // `\[ a [b] \]`). Streaming-safe: findNextMathRegion returns null when
    // the closing delimiter has not arrived yet, so unclosed math falls
    // through to plain-text emission and is retried on the next chunk.
    //
    // All three modes (html / mathml / source) need detection so the
    // delimiters get consumed and the inner LaTeX is normalized. The
    // mode only affects the OUTPUT in renderMathInto: KaTeX HTML for
    // chat, KaTeX MathML for older note paths, or a plain
    // <span class="math">$..$</span> wrapper that Better Notes recognizes.
    const math = findNextMathRegion(text, cursor);
    const codeStart = text.indexOf("`", cursor);
    const boldStart = text.indexOf("**", cursor);
    const italicStart = findSingleStarEmphasisStart(text, cursor);
    const linkStart = text.indexOf("[", cursor);
    const bareUrl =
      parent.tagName.toLowerCase() === "a"
        ? null
        : findNextBareUrl(text, cursor);
    const cite = findNextCitationCommand(text, cursor);
    const latexText = findNextLatexTextCommand(text, cursor);
    const starts = [
      math ? math.start : -1,
      cite ? cite.start : -1,
      latexText ? latexText.start : -1,
      codeStart,
      boldStart,
      italicStart,
      linkStart,
      bareUrl ? bareUrl.start : -1,
    ].filter((index) => index >= 0);
    const next = starts.length ? Math.min(...starts) : -1;

    if (next < 0) {
      parent.append(
        doc.createTextNode(normalizePlainLatex(text.slice(cursor))),
      );
      return;
    }
    if (next > cursor) {
      // `next` is a non-space inline-special char (math / code / `*` / `[` /
      // `\cite` / `\textbf`), so a `~` ending this slice is a LaTeX tie before
      // it (e.g. "work~\cite{…}"). normalizePlainLatex only sees ties internal
      // to the slice; convert this boundary tie here.
      const cleaned = normalizePlainLatex(text.slice(cursor, next)).replace(
        /(?<=\S)~$/,
        " ",
      );
      parent.append(doc.createTextNode(cleaned));
    }

    if (math && next === math.start) {
      renderMathInto(parent, math, mathMode);
      cursor = math.end;
      continue;
    }

    if (cite && next === cite.start) {
      parent.append(doc.createTextNode(cite.replacement));
      cursor = cite.end;
      continue;
    }

    if (latexText && next === latexText.start) {
      const wrapper = latexTextWrapperElement(parent, latexText.kind);
      appendInlineMarkdown(wrapper, latexText.content, mathMode);
      parent.append(wrapper);
      cursor = latexText.end;
      continue;
    }

    if (next === codeStart) {
      const end = text.indexOf("`", next + 1);
      if (end < 0) {
        parent.append(
          doc.createTextNode(normalizePlainLatex(text.slice(next))),
        );
        return;
      }
      const codeContent = text.slice(next + 1, end);
      // ESCAPE HATCH: models sometimes wrap a math formula in backticks
      // (`$$ x $$` or `$x$`), which would normally render as inline code
      // and leave the dollar delimiters visible. If the entire backticked
      // body — after trimming — is a single closed math region, treat
      // the author's intent as math and render accordingly. Genuine
      // "show LaTeX source" cases should use a fenced code block, which
      // is handled at the block level and never reaches here.
      const trimmed = codeContent.trim();
      const inner = findNextMathRegion(trimmed, 0);
      if (inner && inner.start === 0 && inner.end === trimmed.length) {
        renderMathInto(parent, inner, mathMode);
        cursor = end + 1;
        continue;
      }
      const code = doc.createElement("code");
      code.textContent = codeContent;
      parent.append(code);
      cursor = end + 1;
      continue;
    }

    if (next === boldStart) {
      const end = text.indexOf("**", next + 2);
      if (end < 0) {
        parent.append(
          doc.createTextNode(normalizePlainLatex(text.slice(next))),
        );
        return;
      }
      const strong = doc.createElement("strong");
      appendInlineMarkdown(strong, text.slice(next + 2, end), mathMode);
      parent.append(strong);
      cursor = end + 2;
      continue;
    }

    if (next === italicStart) {
      const end = findSingleStarEmphasisEnd(text, next + 1);
      if (end < 0) {
        parent.append(
          doc.createTextNode(normalizePlainLatex(text.slice(next))),
        );
        return;
      }
      const em = doc.createElement("em");
      appendInlineMarkdown(em, text.slice(next + 1, end), mathMode);
      parent.append(em);
      cursor = end + 1;
      continue;
    }

    if (bareUrl && next === bareUrl.start) {
      const anchor = doc.createElement("a");
      anchor.href = bareUrl.href;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      anchor.textContent = bareUrl.href;
      parent.append(anchor);
      cursor = bareUrl.end;
      continue;
    }

    const link = parseMarkdownLink(text, next);
    if (!link) {
      parent.append(doc.createTextNode(normalizePlainLatex(text[next])));
      cursor = next + 1;
      continue;
    }
    // GOTCHA: `target=_blank` + `rel=noreferrer` is required for any link
    // rendered from model output. Without rel=noreferrer, Firefox would
    // pass the Zotero XUL window's referrer to the opened page.
    const anchor = doc.createElement("a");
    anchor.href = link.href;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    appendInlineMarkdown(anchor, link.label, mathMode);
    parent.append(anchor);
    cursor = link.end;
  }
}

function normalizePlainLatex(text: string): string {
  return normalizeLatexTies(
    normalizeLatexSourceCommands(
      normalizeCitations(normalizeLatexListEnvironments(text)),
    ),
  );
}

// `~` is a LaTeX non-breaking space (tie). Quoted LaTeX source leaks it as a
// literal tilde (e.g. "Figure~1", "work~\cite{…}"). A tie is glued between two
// non-space chars; convert only those to a space, leaving a spaced `~` (an
// "approximately" tilde, "approx ~5") untouched. Render-only — context sent to
// the model keeps the original `~`.
function normalizeLatexTies(text: string): string {
  return text.replace(/(?<=\S)~(?=\S)/g, " ");
}

function latexTextWrapperElement(
  parent: HTMLElement,
  kind: LatexTextCommandKind,
): HTMLElement {
  const doc = parent.ownerDocument!;
  if (kind === "emphasis") return doc.createElement("em");
  if (kind === "strong") return doc.createElement("strong");
  if (kind === "code") return doc.createElement("code");
  if (kind === "underline") return doc.createElement("u");
  return doc.createElement("span");
}

function findSingleStarEmphasisStart(text: string, cursor: number): number {
  for (let i = cursor; i < text.length; i++) {
    if (text[i] !== "*") continue;
    if (text[i - 1] === "*" || text[i + 1] === "*") continue;
    if (!text[i + 1] || /\s/.test(text[i + 1])) continue;
    const prev = text[i - 1];
    if (prev && /[A-Za-z0-9_]/.test(prev)) continue;
    if (findSingleStarEmphasisEnd(text, i + 1) >= 0) return i;
  }
  return -1;
}

function findSingleStarEmphasisEnd(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === "\n") return -1;
    if (text[i] !== "*") continue;
    if (text[i - 1] === "*" || text[i + 1] === "*") continue;
    if (i === from || /\s/.test(text[i - 1])) continue;
    const next = text[i + 1];
    if (next && /[A-Za-z0-9_]/.test(next)) continue;
    return i;
  }
  return -1;
}

function appendInlineMarkdownWithLineBreaks(
  parent: HTMLElement,
  text: string,
  mathMode: MathRenderMode,
): void {
  // Unwrap text-wrapper commands (\edit, \textbf, …) BEFORE math extraction.
  // The loop below pulls math regions out at the top level, which would split a
  // math-wrapping `\edit{$…$}` and leak the bare `\edit{`. Normalizing first
  // (math-mode-aware, so `\text{…}` inside `$…$` is untouched) keeps wrappers
  // intact. \cite / \ref / \footnote stay for the per-run normalizePlainLatex.
  text = stripOrphanDisplayEnvDelimiters(
    normalizeLatexTextCommands(normalizeLatexListEnvironments(text)),
  )
    .split("\n")
    .map((line) => normalizeLatexTabularRowLine(line))
    .join("\n");
  let cursor = 0;
  while (cursor < text.length) {
    const math = findNextMathRegion(text, cursor);
    if (!math) {
      appendInlineMarkdownTextRun(parent, text.slice(cursor), mathMode);
      return;
    }
    appendInlineMarkdownTextRun(
      parent,
      text.slice(cursor, math.start),
      mathMode,
    );
    renderMathInto(parent, math, mathMode);
    cursor = math.end;
  }
}

function appendInlineMarkdownTextRun(
  parent: HTMLElement,
  text: string,
  mathMode: MathRenderMode,
): void {
  if (!text) return;
  const doc = parent.ownerDocument!;
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (index > 0) parent.append(doc.createElement("br"));
    const normalized = normalizeLooseSingleDollarMathLine(
      normalizeLatexTabularRowLine(line),
    );
    if (normalized) appendInlineMarkdown(parent, normalized, mathMode);
  });
}

// Models sometimes emit a formula-only source line as `$ ... $,` with stray
// padding just inside the dollar delimiters. The strict single-$ parser
// rejects that form on purpose to avoid prose/currency collisions, so narrow
// whole-line cases are normalized into `\(...\)` here before inline parsing.
function normalizeLooseSingleDollarMathLine(line: string): string {
  const match = line.trim().match(/^\$\s*(.*?)\s*\$(?<tail>[,.;:]*)$/);
  if (!match) return line;

  const body = match[1]?.trim();
  if (!body || body.includes("\n") || /(?<!\\)\$/.test(body)) return line;

  return `\\(${body}\\)${match.groups?.tail ?? ""}`;
}

// Source snippets often quote raw LaTeX table rows (`label & \(math\) \\`)
// without the surrounding `tabular` environment. Render them as readable text
// instead of leaking alignment markers. Keep this narrow so math alignment
// rows (`x &= y \\`) still flow through the real math parser unchanged.
function normalizeLatexTabularRowLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return line;
  if (/^\\(?:hline|cline\{[^}]+\})\s*$/.test(trimmed)) return "";
  if (!/\\\\\s*$/.test(trimmed)) return line;
  if (!trimmed.includes("&")) return line;
  if (/&\s*(?:=|\\leq|\\geq|\\approx|\\sim|≤|≥|≈|∼|~)/.test(trimmed)) {
    return line;
  }

  const withoutRowBreak = trimmed.replace(/\\\\\s*$/, "").trim();
  const cells = splitLatexTabularRow(withoutRowBreak)
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
  if (cells.length < 2) return line;
  return cells.length === 2
    ? `${cells[0]}: ${cells[1]}`
    : cells.join(" | ");
}

function splitLatexTabularRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let braceDepth = 0;
  let parenMathDepth = 0;
  let bracketMathDepth = 0;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    const next = line[i + 1];

    if (ch === "\\") {
      if (next === "(") {
        parenMathDepth += 1;
        current += ch + next;
        i += 1;
        continue;
      }
      if (next === ")" && parenMathDepth > 0) {
        parenMathDepth -= 1;
        current += ch + next;
        i += 1;
        continue;
      }
      if (next === "[") {
        bracketMathDepth += 1;
        current += ch + next;
        i += 1;
        continue;
      }
      if (next === "]" && bracketMathDepth > 0) {
        bracketMathDepth -= 1;
        current += ch + next;
        i += 1;
        continue;
      }
      current += ch;
      if (next != null) {
        current += next;
        i += 1;
      }
      continue;
    }

    if (ch === "{") braceDepth += 1;
    else if (ch === "}" && braceDepth > 0) braceDepth -= 1;

    if (
      ch === "&" &&
      braceDepth === 0 &&
      parenMathDepth === 0 &&
      bracketMathDepth === 0
    ) {
      cells.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  cells.push(current);
  return cells;
}

function markdownHeadingLevel(line: string): number {
  let level = 0;
  while (level < line.length && line[level] === "#") level++;
  return level > 0 && level <= 4 && line[level] === " " ? level : 0;
}

function markdownListItem(line: string): MarkdownListItem | null {
  const indent = listIndentLevel(line);
  const trimmed = line.slice(countListIndentChars(line));
  if (trimmed.startsWith("- ") || trimmed.startsWith("* "))
    return { text: trimmed.slice(2).trim(), ordered: false, level: indent };
  let index = 0;
  while (index < trimmed.length && isDigit(trimmed[index])) index++;
  if (index === 0 || trimmed[index] !== "." || trimmed[index + 1] !== " ")
    return null;
  return {
    text: trimmed.slice(index + 2).trim(),
    ordered: true,
    level: indent,
  };
}

function trimListIndent(line: string): string {
  return line.slice(countListIndentChars(line));
}

function countListIndentChars(line: string): number {
  let index = 0;
  while (line[index] === " " || line[index] === "\t") index++;
  return index;
}

function listIndentLevel(line: string): number {
  let width = 0;
  for (let index = 0; index < line.length; index++) {
    if (line[index] === " ") width += 1;
    else if (line[index] === "\t") width += 2;
    else break;
  }
  return width >= 2 ? 1 : 0;
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function parseMarkdownLink(
  text: string,
  start: number,
): { label: string; href: string; end: number } | null {
  const closeLabel = text.indexOf("]", start + 1);
  if (closeLabel < 0 || text[closeLabel + 1] !== "(") return null;
  // File names and valid URLs may contain balanced parentheses, e.g.
  // `flowchart_cn(5).pdf`. Stop at the matching Markdown delimiter instead
  // of the first closing parenthesis inside the URL.
  let depth = 0;
  let closeHref = -1;
  for (let index = closeLabel + 2; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    else if (text[index] === ")") {
      if (depth === 0) {
        closeHref = index;
        break;
      }
      depth -= 1;
    }
  }
  if (closeHref < 0) return null;
  const href = text.slice(closeLabel + 2, closeHref).trim();
  if (!href) return null;
  return {
    label: text.slice(start + 1, closeLabel),
    href,
    end: closeHref + 1,
  };
}

function findNextBareUrl(
  text: string,
  start: number,
): { start: number; end: number; href: string } | null {
  const match = /https?:\/\/[^\s<>"'`]+/i.exec(text.slice(start));
  if (!match || match.index == null) return null;
  let href = match[0];
  while (/[.,!?;:，。！？；：]$/.test(href)) href = href.slice(0, -1);
  while (
    href.endsWith(")") &&
    (href.match(/\)/g)?.length || 0) > (href.match(/\(/g)?.length || 0)
  ) {
    href = href.slice(0, -1);
  }
  if (!href) return null;
  const urlStart = start + match.index;
  return { start: urlStart, end: urlStart + href.length, href };
}
