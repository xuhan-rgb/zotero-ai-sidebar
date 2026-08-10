import {
  equationDisplayMath,
  parseEquations,
  type TexEquation,
} from "../context/tex-equations";
import {
  parseFigures,
  plainFigureCaption,
  type TexFigure,
} from "../context/tex-figures";
import { parseSections, type TexSection } from "../context/tex-sections";
import {
  normalizeLatexCommonCommands,
  normalizeLatexTextCommands,
} from "../context/tex-clean";
import {
  parseTables,
  plainTableCaption,
  type TexTable,
} from "../context/tex-tables";

export type FullTranslationBlockKind =
  | "title"
  | "abstract"
  | "heading"
  | "paragraph"
  | "list"
  | "formula"
  | "figure-caption"
  | "table-caption";

export interface FullTranslationBlock {
  id: string;
  kind: FullTranslationBlockKind;
  source: string;
  translatable: boolean;
  level?: number;
  number?: number | string;
  assets?: string[];
  table?: FullTranslationTable;
}

export interface FullTranslationTable {
  rows: FullTranslationTableCell[][];
}

export type FullTranslationTableCell =
  | string
  | { text: string; colSpan?: number; rowSpan?: number };

export interface FullTranslationDocument {
  schemaVersion: 1;
  arxivId: string;
  sourceHash: string;
  blocks: FullTranslationBlock[];
}

export interface LatexPlaceholder {
  token: string;
  latex: string;
}

export interface ProtectedLatexText {
  text: string;
  placeholders: LatexPlaceholder[];
}

type StructuralEvent =
  | { start: number; end: number; kind: "abstract"; source: string }
  | { start: number; end: number; kind: "heading"; section: TexSection }
  | { start: number; end: number; kind: "formula"; equation: TexEquation }
  | { start: number; end: number; kind: "display-formula"; source: string }
  | { start: number; end: number; kind: "figure"; figure: TexFigure }
  | { start: number; end: number; kind: "table"; table: TexTable }
  | { start: number; end: number; kind: "skip" };

const HEADER_RE =
  /\\(section|subsection|subsubsection|paragraph)\*?(?:\[[^\]]*\])?\{((?:[^{}]|\{[^{}]*\})*)\}/g;
const ABSTRACT_RE = /\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/g;
const BIBLIOGRAPHY_RE =
  /\\begin\{thebibliography\}(?:\{[^}]*\})?[\s\S]*?\\end\{thebibliography\}/g;
const STARRED_EQUATION_RE =
  /\\begin\{equation\*\}([\s\S]*?)\\end\{equation\*\}/g;
const MULTIROW_EQUATION_RE =
  /\\begin\{(align|gather|multline)(\*)?\}([\s\S]*?)\\end\{\1\2\}/g;

export const FULL_TRANSLATION_PARSER_VERSION = 6;

export function buildFullTranslationDocument(
  arxivId: string,
  source: string,
): FullTranslationDocument {
  const blocks: FullTranslationBlock[] = [];
  const title = readCommandArgument(source, "title");
  if (title) {
    blocks.push({
      id: "title",
      kind: "title",
      source: normalizeVisibleText(title),
      translatable: true,
      level: 1,
    });
  }

  const documentStart = commandEnd(source, "\\begin{document}") ?? 0;
  const maketitle = source.indexOf("\\maketitle", documentStart);
  const contentStart =
    maketitle >= 0 ? maketitle + "\\maketitle".length : documentStart;
  const documentEnd = source.indexOf("\\end{document}", contentStart);
  const contentEnd = documentEnd >= 0 ? documentEnd : source.length;
  const events = structuralEvents(source, contentStart, contentEnd);
  let cursor = contentStart;
  let sectionID = "front";
  let paragraphIndex = 0;

  for (const event of events) {
    if (event.start > cursor) {
      paragraphIndex = appendTextBlocks(
        blocks,
        source.slice(cursor, event.start),
        sectionID,
        paragraphIndex,
      );
    }
    cursor = Math.max(cursor, event.end);

    if (event.kind === "skip") continue;
    if (event.kind === "abstract") {
      blocks.push({
        id: "abstract",
        kind: "abstract",
        source: normalizeVisibleText(event.source),
        translatable: true,
        level: 2,
      });
      continue;
    }
    if (event.kind === "heading") {
      sectionID = `section-${event.section.number.replaceAll(".", "-")}`;
      paragraphIndex = 0;
      blocks.push({
        id: sectionID,
        kind: "heading",
        source: normalizeVisibleText(event.section.title),
        translatable: true,
        level: event.section.level,
        ...(event.section.level < 4 ? { number: event.section.number } : {}),
      });
      continue;
    }
    if (event.kind === "formula") {
      blocks.push({
        id: `equation-${event.equation.number}`,
        kind: "formula",
        source: equationDisplayMath(event.equation),
        translatable: false,
        number: event.equation.number,
      });
      continue;
    }
    if (event.kind === "display-formula") {
      blocks.push({
        id: `display-formula-${blocks.length + 1}`,
        kind: "formula",
        source: event.source,
        translatable: false,
      });
      continue;
    }
    if (event.kind === "figure") {
      const caption = plainFigureCaption(event.figure);
      if (caption || event.figure.graphics.length) {
        blocks.push({
          id: `figure-${event.figure.number}-caption`,
          kind: "figure-caption",
          source: caption,
          translatable: !!caption,
          number: event.figure.number,
          ...(event.figure.graphics.length
            ? { assets: event.figure.graphics }
            : {}),
        });
      }
      continue;
    }
    const caption = plainTableCaption(event.table);
    const table = fullTranslationTable(event.table);
    if (caption || table) {
      blocks.push({
        id: `table-${event.table.number}-caption`,
        kind: "table-caption",
        source: caption,
        translatable: !!caption,
        number: event.table.number,
        ...(table ? { table } : {}),
      });
    }
  }

  if (cursor < contentEnd) {
    appendTextBlocks(
      blocks,
      source.slice(cursor, contentEnd),
      sectionID,
      paragraphIndex,
    );
  }

  return {
    schemaVersion: 1,
    arxivId,
    sourceHash: stableSourceHash(
      `${FULL_TRANSLATION_PARSER_VERSION}\0${source}`,
    ),
    blocks,
  };
}

function fullTranslationTable(table: TexTable): FullTranslationTable | null {
  if (!table.tabularTex) return null;
  const body = outerTabularBody(table.tabularTex);
  if (body == null) return null;
  const activeRowSpans: number[] = [];
  const rows = splitTableSource(body, "row")
    .map((row) => parseTableRow(row, activeRowSpans))
    .filter((row) => row.some((cell) => tableCellText(cell)));
  return rows.length ? { rows } : null;
}

function parseTableRow(
  source: string,
  activeRowSpans: number[],
): FullTranslationTableCell[] {
  const occupied = activeRowSpans.map((remaining) => remaining > 0);
  for (let index = 0; index < activeRowSpans.length; index++) {
    activeRowSpans[index] = Math.max(0, activeRowSpans[index] - 1);
  }

  const cells: FullTranslationTableCell[] = [];
  let column = 0;
  for (const sourceCell of splitTableSource(source, "column")) {
    const cell = parseTableCell(sourceCell);
    const text = tableCellText(cell);
    const colSpan = typeof cell === "string" ? 1 : (cell.colSpan ?? 1);
    const rowSpan = typeof cell === "string" ? 1 : (cell.rowSpan ?? 1);

    // LaTeX keeps an empty `&` placeholder beneath a multirow cell. HTML
    // represents that slot through rowspan, so emitting the placeholder would
    // create an extra column.
    while (occupied[column] && text) column += 1;
    if (occupied[column]) {
      column += colSpan;
      continue;
    }

    cells.push(cell);
    if (rowSpan > 1) {
      for (let offset = 0; offset < colSpan; offset++) {
        const target = column + offset;
        activeRowSpans[target] = Math.max(
          activeRowSpans[target] ?? 0,
          rowSpan - 1,
        );
      }
    }
    column += colSpan;
  }
  return cells;
}

function parseTableCell(value: string): FullTranslationTableCell {
  let source = stripTableRules(value).trim();
  let colSpan = 1;
  let rowSpan = 1;

  for (let iteration = 0; iteration < 5; iteration++) {
    source = unwrapOuterBraces(source);
    const command = source.match(
      /^\\(multicolumn|multirow|shortstack)\b/,
    )?.[1] as "multicolumn" | "multirow" | "shortstack" | undefined;
    if (!command) break;
    const parsed = readTableLayoutCommand(source, 0, command);
    if (!parsed || source.slice(parsed.end).trim()) break;
    colSpan = Math.max(colSpan, parsed.colSpan ?? 1);
    rowSpan = Math.max(rowSpan, parsed.rowSpan ?? 1);
    source = parsed.content;
  }

  const text = normalizeTableCell(source);
  return colSpan > 1 || rowSpan > 1
    ? {
        text,
        ...(colSpan > 1 ? { colSpan } : {}),
        ...(rowSpan > 1 ? { rowSpan } : {}),
      }
    : text;
}

function tableCellText(cell: FullTranslationTableCell): string {
  return typeof cell === "string" ? cell : cell.text;
}

function normalizeTableCell(value: string): string {
  let cell = stripTableRules(value).trim();
  for (let iteration = 0; iteration < 5; iteration++) {
    const previous = cell;
    cell = unwrapTableLayoutCommands(cell);
    cell = flattenNestedTabulars(cell);
    cell = unwrapOuterBraces(cell);
    cell = normalizeLatexTextCommands(cell);
    cell = normalizeLatexCommonCommands(cell);
    cell = normalizeTableMarkdown(cell);
    cell = stripTableRules(cell).trim();
    if (cell === previous) break;
  }
  if (!cell.startsWith("$") || !cell.endsWith("$")) {
    cell = cell.replace(/\\%/g, "%");
  }
  return normalizeInlineMathWhitespace(cell)
    .replace(/~/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTableMarkdown(value: string): string {
  return value.replace(/\*\*([\s\S]*?)\*\*/g, (_match, content: string) => {
    if (!content.trim()) return content;
    const leading = content.match(/^\s*/)?.[0] ?? "";
    const trailing = content.match(/\s*$/)?.[0] ?? "";
    const end = content.length - trailing.length;
    return `${leading}**${content.slice(leading.length, end)}**${trailing}`;
  });
}

type TableSeparator = "row" | "column";

function outerTabularBody(tex: string): string | null {
  const begin = tex.match(/^\\begin\{(tabular\*?|tabularx|longtable)\}/);
  if (!begin) return null;
  const env = begin[1];
  let cursor = skipWhitespace(tex, begin[0].length);
  if (tex[cursor] === "[") {
    const optional = readDelimitedValue(tex, cursor, "[", "]");
    if (!optional) return null;
    cursor = skipWhitespace(tex, optional.end);
  }
  const requiredArgs = env === "tabular*" || env === "tabularx" ? 2 : 1;
  for (let index = 0; index < requiredArgs; index++) {
    const argument = readBracedValue(tex, cursor);
    if (!argument) return null;
    cursor = skipWhitespace(tex, argument.end);
    if (index === 0 && tex[cursor] === "[") {
      const optional = readDelimitedValue(tex, cursor, "[", "]");
      if (!optional) return null;
      cursor = skipWhitespace(tex, optional.end);
    }
  }
  const end = new RegExp(`\\\\end\\{${escapeRegExp(env)}\\}\\s*$`).exec(tex);
  if (!end || end.index < cursor) return null;
  return tex.slice(cursor, end.index);
}

function splitTableSource(source: string, separator: TableSeparator): string[] {
  const parts: string[] = [];
  let start = 0;
  let braceDepth = 0;
  let environmentDepth = 0;
  let mathDelimiter: "$" | "$$" | "\\(" | "\\[" | null = null;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === "\\" && source[index - 1] !== "\\") {
      if (source.startsWith("\\(", index) && !mathDelimiter) {
        mathDelimiter = "\\(";
        index += 1;
        continue;
      }
      if (source.startsWith("\\)", index) && mathDelimiter === "\\(") {
        mathDelimiter = null;
        index += 1;
        continue;
      }
      if (source.startsWith("\\[", index) && !mathDelimiter) {
        mathDelimiter = "\\[";
        index += 1;
        continue;
      }
      if (source.startsWith("\\]", index) && mathDelimiter === "\\[") {
        mathDelimiter = null;
        index += 1;
        continue;
      }
      const environment = source.slice(index).match(/^\\(begin|end)\{[^{}]+\}/);
      if (environment && !mathDelimiter) {
        environmentDepth += environment[1] === "begin" ? 1 : -1;
        environmentDepth = Math.max(0, environmentDepth);
        index += environment[0].length - 1;
        continue;
      }
    }
    if (char === "$" && source[index - 1] !== "\\") {
      const delimiter = source[index + 1] === "$" ? "$$" : "$";
      if (!mathDelimiter) mathDelimiter = delimiter;
      else if (mathDelimiter === delimiter) mathDelimiter = null;
      if (delimiter === "$$") index += 1;
      continue;
    }
    if (mathDelimiter) continue;
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (braceDepth || environmentDepth) continue;

    if (separator === "column" && char === "&") {
      parts.push(source.slice(start, index));
      start = index + 1;
      continue;
    }
    if (separator === "row" && source.startsWith("\\\\", index)) {
      parts.push(source.slice(start, index));
      index = tableRowSeparatorEnd(source, index) - 1;
      start = index + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}

function tableRowSeparatorEnd(source: string, start: number): number {
  let cursor = start + 2;
  if (source[cursor] === "*") cursor += 1;
  cursor = skipWhitespace(source, cursor);
  if (source[cursor] === "[") {
    const optional = readDelimitedValue(source, cursor, "[", "]");
    if (optional) cursor = optional.end;
  }
  return cursor;
}

function stripTableRules(value: string): string {
  return value
    .replace(
      /\\(?:toprule|midrule|bottomrule|hlineB|hline)\b(?:\s*\{[^{}]*\})?/g,
      "",
    )
    .replace(/\\(?:cmidrule|cline)\s*(?:\([^)]*\))?\s*\{[^{}]*\}/g, "")
    .replace(/\\(?:addlinespace|noalign)\b(?:\s*\{[^{}]*\})?/g, "");
}

function unwrapTableLayoutCommands(value: string): string {
  let out = "";
  let cursor = 0;
  while (cursor < value.length) {
    const next = (["multicolumn", "multirow", "shortstack"] as const)
      .map((command) => ({
        command,
        start: value.indexOf(`\\${command}`, cursor),
      }))
      .filter(({ start }) => start >= 0)
      .sort((left, right) => left.start - right.start)[0];
    if (!next) return out + value.slice(cursor);
    out += value.slice(cursor, next.start);
    const parsed = readTableLayoutCommand(value, next.start, next.command);
    if (!parsed) {
      out += value[next.start];
      cursor = next.start + 1;
      continue;
    }
    out += parsed.content;
    cursor = parsed.end;
  }
  return out;
}

function readTableLayoutCommand(
  text: string,
  start: number,
  command: "multicolumn" | "multirow" | "shortstack",
): {
  content: string;
  end: number;
  colSpan?: number;
  rowSpan?: number;
} | null {
  let cursor = start + command.length + 1;
  if (command === "shortstack") {
    cursor = skipWhitespace(text, cursor);
    if (text[cursor] === "[") {
      const optional = readDelimitedValue(text, cursor, "[", "]");
      if (!optional) return null;
      cursor = skipWhitespace(text, optional.end);
    }
    const argument = readBracedValue(text, cursor);
    return argument ? { content: argument.value, end: argument.end } : null;
  }
  if (command === "multirow" && text[cursor] === "[") {
    const optional = readDelimitedValue(text, cursor, "[", "]");
    if (!optional) return null;
    cursor = skipWhitespace(text, optional.end);
  }
  const argumentsFound: Array<{ value: string; end: number }> = [];
  for (let index = 0; index < 3; index++) {
    cursor = skipWhitespace(text, cursor);
    if (command === "multirow" && text[cursor] === "[") {
      const optional = readDelimitedValue(text, cursor, "[", "]");
      if (!optional) return null;
      cursor = skipWhitespace(text, optional.end);
    }
    const argument = readBracedValue(text, cursor);
    if (!argument) return null;
    argumentsFound.push(argument);
    cursor = argument.end;
  }
  const span = positiveTableSpan(argumentsFound[0].value);
  return {
    content: argumentsFound[2].value,
    end: cursor,
    ...(command === "multicolumn" && span > 1 ? { colSpan: span } : {}),
    ...(command === "multirow" && span > 1 ? { rowSpan: span } : {}),
  };
}

function positiveTableSpan(value: string): number {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return 1;
  return Math.max(1, Number.parseInt(normalized, 10));
}

function flattenNestedTabulars(value: string): string {
  let flattened = value;
  flattened = removeTabularBeginCommands(flattened);
  flattened = flattened.replace(
    /\\end\{(?:tabular\*?|tabularx|longtable)\}/g,
    "",
  );
  return replaceTextLineBreaks(flattened);
}

function removeTabularBeginCommands(value: string): string {
  let out = "";
  let cursor = 0;
  const beginRe = /\\begin\{(tabular\*?|tabularx|longtable)\}/g;
  let match: RegExpExecArray | null;
  while ((match = beginRe.exec(value)) !== null) {
    out += value.slice(cursor, match.index);
    const env = match[1];
    let end = skipWhitespace(value, match.index + match[0].length);
    if (value[end] === "[") {
      const optional = readDelimitedValue(value, end, "[", "]");
      if (optional) end = skipWhitespace(value, optional.end);
    }
    const argumentCount = env === "tabular*" || env === "tabularx" ? 2 : 1;
    for (let index = 0; index < argumentCount; index++) {
      const argument = readBracedValue(value, end);
      if (!argument) break;
      end = skipWhitespace(value, argument.end);
    }
    cursor = end;
    beginRe.lastIndex = end;
  }
  return out + value.slice(cursor);
}

function replaceTextLineBreaks(value: string): string {
  let out = "";
  let cursor = 0;
  let math: "$" | "$$" | null = null;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "$" && value[index - 1] !== "\\") {
      const delimiter = value[index + 1] === "$" ? "$$" : "$";
      if (!math) math = delimiter;
      else if (math === delimiter) math = null;
      if (delimiter === "$$") index += 1;
      continue;
    }
    if (!math && value.startsWith("\\\\", index)) {
      out += value.slice(cursor, index) + " ";
      index = tableRowSeparatorEnd(value, index) - 1;
      cursor = index + 1;
    }
  }
  return out + value.slice(cursor);
}

function unwrapOuterBraces(value: string): string {
  let text = value.trim();
  while (text.startsWith("{") && text.endsWith("}")) {
    const wrapped = readBracedValue(text, 0);
    if (!wrapped || wrapped.end !== text.length) break;
    text = wrapped.value.trim();
  }
  return text;
}

function readDelimitedValue(
  text: string,
  start: number,
  open: string,
  close: string,
): { value: string; end: number } | null {
  if (text[start] !== open) return null;
  let depth = 0;
  for (let index = start; index < text.length; index++) {
    if (text[index] === "\\") {
      index += 1;
      continue;
    }
    if (text[index] === open) depth += 1;
    if (text[index] === close) {
      depth -= 1;
      if (depth === 0) {
        return { value: text.slice(start + 1, index), end: index + 1 };
      }
    }
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function protectLatexForTranslation(source: string): ProtectedLatexText {
  const placeholders: LatexPlaceholder[] = [];
  const text = source.replace(
    /\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$]+\$|\\(?:eqref|ref|autoref|cref|Cref|pageref)\*?\{[^{}\n]+\}/g,
    (latex) => {
      const token = `ZAILATEXTOKEN${placeholders.length}X`;
      placeholders.push({ token, latex });
      return token;
    },
  );
  return { text, placeholders };
}

export function restoreLatexAfterTranslation(
  translated: string,
  placeholders: LatexPlaceholder[],
): string | null {
  let restored = translated;
  for (const placeholder of placeholders) {
    if (occurrences(restored, placeholder.token) !== 1) return null;
    restored = restored.replace(placeholder.token, placeholder.latex);
  }
  return restored;
}

function structuralEvents(
  source: string,
  start: number,
  end: number,
): StructuralEvent[] {
  const allLayoutEvents = sourceOnlyLayoutEvents(source, 0, source.length);
  const sectionSource = maskEventRanges(source, allLayoutEvents);
  const events: StructuralEvent[] = allLayoutEvents.filter(
    (event) => event.start >= start && event.end <= end,
  );
  const sectionsByStart = new Map(
    parseSections(sectionSource).map((section) => [section.start, section]),
  );

  HEADER_RE.lastIndex = 0;
  let header: RegExpExecArray | null;
  while ((header = HEADER_RE.exec(sectionSource)) !== null) {
    const section = sectionsByStart.get(header.index);
    if (section && header.index >= start && header.index < end) {
      events.push({
        start: header.index,
        end: header.index + header[0].length,
        kind: "heading",
        section,
      });
    }
  }

  ABSTRACT_RE.lastIndex = 0;
  let abstract: RegExpExecArray | null;
  while ((abstract = ABSTRACT_RE.exec(source)) !== null) {
    events.push({
      start: abstract.index,
      end: abstract.index + abstract[0].length,
      kind: "abstract",
      source: abstract[1],
    });
  }

  for (const equation of parseEquations(source)) {
    events.push({
      start: equation.start,
      end: equation.end,
      kind: "formula",
      equation,
    });
  }
  STARRED_EQUATION_RE.lastIndex = 0;
  let starredEquation: RegExpExecArray | null;
  while ((starredEquation = STARRED_EQUATION_RE.exec(source)) !== null) {
    events.push({
      start: starredEquation.index,
      end: starredEquation.index + starredEquation[0].length,
      kind: "display-formula",
      source: cleanDisplayFormulaBody(starredEquation[1]),
    });
  }
  MULTIROW_EQUATION_RE.lastIndex = 0;
  let multirowEquation: RegExpExecArray | null;
  while ((multirowEquation = MULTIROW_EQUATION_RE.exec(source)) !== null) {
    const env = multirowEquation[1];
    const body = multirowEquation[3];
    events.push({
      start: multirowEquation.index,
      end: multirowEquation.index + multirowEquation[0].length,
      kind: "display-formula",
      source:
        env === "align"
          ? alignedDisplayFormula(body)
          : env === "gather"
            ? gatheredDisplayFormula(body)
            : multlineDisplayFormula(body),
    });
  }
  for (const figure of parseFigures(source)) {
    events.push({
      start: figure.start,
      end: figure.end,
      kind: "figure",
      figure,
    });
  }
  for (const table of parseTables(source)) {
    events.push({
      start: table.start,
      end: table.end,
      kind: "table",
      table,
    });
  }

  BIBLIOGRAPHY_RE.lastIndex = 0;
  let bibliography: RegExpExecArray | null;
  while ((bibliography = BIBLIOGRAPHY_RE.exec(source)) !== null) {
    events.push({
      start: bibliography.index,
      end: bibliography.index + bibliography[0].length,
      kind: "skip",
    });
  }

  return removeOverlaps(
    events.filter((event) => event.start >= start && event.end <= end),
  );
}

type SourceOnlyLayoutCommand =
  | "@startsection"
  | "setlength"
  | "titlespacing"
  | "renewcommand"
  | "makeatletter"
  | "makeatother";

function sourceOnlyLayoutEvents(
  source: string,
  start: number,
  end: number,
): StructuralEvent[] {
  const events: StructuralEvent[] = [];
  const commandRe =
    /\\(@startsection|setlength|titlespacing|renewcommand|makeatletter|makeatother)\b/g;
  commandRe.lastIndex = start;
  let match: RegExpExecArray | null;
  while ((match = commandRe.exec(source)) !== null && match.index < end) {
    const command = match[1] as SourceOnlyLayoutCommand;
    const commandEnd = sourceOnlyLayoutCommandEnd(source, match.index, command);
    if (commandEnd == null || commandEnd > end) continue;
    events.push({ start: match.index, end: commandEnd, kind: "skip" });
    commandRe.lastIndex = commandEnd;
  }
  return events;
}

function sourceOnlyLayoutCommandEnd(
  source: string,
  start: number,
  command: SourceOnlyLayoutCommand,
): number | null {
  let cursor = start + command.length + 1;
  if (command === "makeatletter" || command === "makeatother") return cursor;
  if (source[cursor] === "*") cursor += 1;
  cursor = skipWhitespace(source, cursor);

  if (command === "@startsection") {
    for (let index = 0; index < 6; index++) {
      const argument = readBracedValue(source, skipWhitespace(source, cursor));
      if (!argument) return null;
      cursor = argument.end;
    }
    return cursor;
  }

  if (command === "titlespacing") {
    const target = readCommandTarget(source, cursor);
    if (target == null) return null;
    cursor = target;
    for (let index = 0; index < 3; index++) {
      const argument = readBracedValue(source, skipWhitespace(source, cursor));
      if (!argument) return null;
      cursor = argument.end;
    }
    const optional = readDelimitedValue(
      source,
      skipWhitespace(source, cursor),
      "[",
      "]",
    );
    return optional?.end ?? cursor;
  }

  const target = readCommandTarget(source, cursor);
  if (target == null) return null;
  cursor = target;
  if (command === "setlength") {
    const value = readBracedValue(source, skipWhitespace(source, cursor));
    return value?.end ?? null;
  }

  for (let index = 0; index < 2; index++) {
    const optional = readDelimitedValue(
      source,
      skipWhitespace(source, cursor),
      "[",
      "]",
    );
    if (!optional) break;
    cursor = optional.end;
  }
  const definition = readBracedValue(source, skipWhitespace(source, cursor));
  return definition?.end ?? null;
}

function readCommandTarget(source: string, start: number): number | null {
  if (source[start] === "{") return readBracedValue(source, start)?.end ?? null;
  if (source[start] !== "\\") return null;
  let cursor = start + 1;
  if (/[A-Za-z@]/.test(source[cursor] ?? "")) {
    while (/[A-Za-z@]/.test(source[cursor] ?? "")) cursor += 1;
  } else {
    cursor += 1;
  }
  return cursor;
}

function maskEventRanges(source: string, events: StructuralEvent[]): string {
  let masked = "";
  let cursor = 0;
  for (const event of events) {
    masked += source.slice(cursor, event.start);
    masked += " ".repeat(event.end - event.start);
    cursor = event.end;
  }
  return masked + source.slice(cursor);
}

function removeOverlaps(events: StructuralEvent[]): StructuralEvent[] {
  const priority: Record<StructuralEvent["kind"], number> = {
    skip: 5,
    figure: 4,
    table: 4,
    abstract: 3,
    "display-formula": 3,
    formula: 2,
    heading: 1,
  };
  const sorted = events.slice().sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (priority[a.kind] !== priority[b.kind]) {
      return priority[b.kind] - priority[a.kind];
    }
    return b.end - a.end;
  });
  const out: StructuralEvent[] = [];
  for (const event of sorted) {
    const previous = out.at(-1);
    if (!previous || event.start >= previous.end) out.push(event);
  }
  return out;
}

function cleanDisplayFormulaBody(source: string): string {
  return source
    .replace(/\\label\{[^}]+\}/g, "")
    .replace(/\\(?:notag|nonumber)\b/g, "")
    .trim();
}

function alignedDisplayFormula(source: string): string {
  return `\\begin{aligned}\n${cleanDisplayFormulaBody(source)}\n\\end{aligned}`;
}

function gatheredDisplayFormula(source: string): string {
  return `\\begin{gathered}\n${cleanDisplayFormulaBody(source)}\n\\end{gathered}`;
}

function multlineDisplayFormula(source: string): string {
  const rows = cleanDisplayFormulaBody(source)
    .split(/\\\\/)
    .map((row) => row.trim())
    .filter(Boolean);
  if (rows.length <= 1) return rows[0] ?? "";
  return `\\begin{aligned}\n${rows.map((row) => `&${row}`).join(" \\\\\n")}\n\\end{aligned}`;
}

function appendTextBlocks(
  blocks: FullTranslationBlock[],
  raw: string,
  sectionID: string,
  initialIndex: number,
): number {
  let paragraphIndex = initialIndex;
  const cleaned = normalizeTextCommands(raw)
    .replace(/^\[(?:Equation|Figure|Table) \([^\n]+$/gm, "")
    .replace(/\\label\{[^}]+\}/g, "")
    .replace(
      /\\(?:maketitle|appendix|centering|noindent|small|normalsize|large|Large|clearpage|newpage|par|vfill)\b/g,
      "",
    )
    .replace(/\\(?:setcounter|addtocounter)\{[^}]+\}\{[^}]+\}/g, "")
    .replace(/\\(?:vspace|hspace)\*?\{[^}]*\}/g, "")
    .replace(/\\bibliography(?:style)?\{[^}]*\}/g, "")
    .replace(/\{\s*\}/g, "")
    .trim();
  if (!cleaned) return paragraphIndex;

  for (const part of cleaned.split(/\n\s*\n+/)) {
    const parsed = splitEmbeddedDisplayFormulas(part).flatMap<DisplaySegment>(
      (segment): DisplaySegment[] => {
        const formula =
          segment.kind === "formula"
            ? nonEmptyFormula(segment.source)
            : standaloneDisplayFormula(segment.source);
        if (formula) return [{ kind: "formula", source: formula }];
        const source = normalizeVisibleText(segment.source);
        if (
          !source ||
          /^\\[A-Za-z@]+(?:\[[^\]]*\])?(?:\{[^}]*\})?$/.test(source)
        ) {
          return [];
        }
        return [{ kind: "text", source }];
      },
    );
    const splitParagraph =
      parsed.some((segment) => segment.kind === "formula") &&
      parsed.some((segment) => segment.kind === "text");
    if (splitParagraph) paragraphIndex += 1;
    let splitIndex = 0;

    for (const segment of parsed) {
      if (segment.kind === "formula") {
        blocks.push({
          id: `display-formula-${blocks.length + 1}`,
          kind: "formula",
          source: segment.source,
          translatable: false,
        });
        continue;
      }
      if (!splitParagraph) paragraphIndex += 1;
      splitIndex += 1;
      blocks.push({
        id: `${sectionID}-p${paragraphIndex}${splitParagraph ? `-s${splitIndex}` : ""}`,
        kind: /^(?:[-*]|\d+\.)\s/m.test(segment.source) ? "list" : "paragraph",
        source: segment.source,
        translatable: true,
      });
    }
  }
  return paragraphIndex;
}

type DisplaySegment = {
  kind: "text" | "formula";
  source: string;
};

function splitEmbeddedDisplayFormulas(source: string): DisplaySegment[] {
  const normalized = source.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }

  const segments: DisplaySegment[] = [];
  let segmentStart = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    if (lines[lineIndex]?.trim() !== "$") continue;
    const bodyStart = offsets[lineIndex]! + lines[lineIndex]!.length + 1;
    let closing:
      | { lineIndex: number; dollar: number; end: number; punctuation: string }
      | undefined;
    for (let candidate = lineIndex + 1; candidate < lines.length; candidate++) {
      const match = /(?<!\\)\$([,.;:]?)[ \t]*$/.exec(lines[candidate]!);
      if (!match) continue;
      closing = {
        lineIndex: candidate,
        dollar: offsets[candidate]! + match.index,
        end: offsets[candidate]! + match.index + match[0].length,
        punctuation: match[1] ?? "",
      };
      break;
    }
    if (!closing) continue;

    const formula = normalized.slice(bodyStart, closing.dollar).trim();
    if (!formula) continue;
    const opener = offsets[lineIndex]!;
    if (opener > segmentStart) {
      segments.push({
        kind: "text",
        source: normalized.slice(segmentStart, opener),
      });
    }
    segments.push({
      kind: "formula",
      source: `${formula}${closing.punctuation}`,
    });
    segmentStart = closing.end;
    lineIndex = closing.lineIndex;
  }
  if (segmentStart < normalized.length) {
    segments.push({ kind: "text", source: normalized.slice(segmentStart) });
  }
  return segments.length ? segments : [{ kind: "text", source: normalized }];
}

function standaloneDisplayFormula(source: string): string | null {
  const trimmed = source.replace(/\r\n?/g, "\n").trim();
  if (trimmed.startsWith("$$") && trimmed.endsWith("$$")) {
    return nonEmptyFormula(trimmed.slice(2, -2));
  }
  if (trimmed.startsWith("\\[") && trimmed.endsWith("\\]")) {
    return nonEmptyFormula(trimmed.slice(2, -2));
  }
  const singleLine = /^\$([^$\n]+)(?<!\\)\$([,.;:]?)$/.exec(trimmed);
  if (singleLine) {
    return nonEmptyFormula(`${singleLine[1]}${singleLine[2] ?? ""}`);
  }

  const openingLine = trimmed.indexOf("\n");
  if (openingLine < 0 || trimmed.slice(0, openingLine).trim() !== "$") {
    return null;
  }
  const closing = /(?<!\\)\$([,.;:]?)\s*$/.exec(trimmed.slice(openingLine + 1));
  if (!closing) return null;
  const body = trimmed
    .slice(openingLine + 1, openingLine + 1 + closing.index)
    .trim();
  return nonEmptyFormula(`${body}${closing[1] ?? ""}`);
}

function nonEmptyFormula(source: string): string | null {
  const formula = source.trim();
  return formula || null;
}

function normalizeTextCommands(text: string): string {
  return normalizeEpigraphs(
    unwrapTwocolumn(normalizeAcknowledgments(normalizeLegacyBold(text))),
  );
}

function normalizeLegacyBold(text: string): string {
  let normalized = "";
  let cursor = 0;
  for (let start = text.indexOf("{\\bf", cursor); start >= 0; ) {
    const group = readBracedValue(text, start);
    const content = group?.value.match(/^\\bf(?![A-Za-z@])\s*([\s\S]*)$/)?.[1];
    if (!group || content == null) {
      start = text.indexOf("{\\bf", start + 4);
      continue;
    }
    normalized += text.slice(cursor, start) + `**${content.trim()}**`;
    cursor = group.end;
    start = text.indexOf("{\\bf", cursor);
  }
  return cursor ? normalized + text.slice(cursor) : text;
}

function normalizeAcknowledgments(text: string): string {
  const command = "\\acknowledgments";
  let normalized = "";
  let cursor = 0;
  for (let start = text.indexOf(command, cursor); start >= 0; ) {
    const argument = readBracedValue(
      text,
      skipWhitespace(text, start + command.length),
    );
    if (!argument) {
      start = text.indexOf(command, start + command.length);
      continue;
    }
    normalized +=
      text.slice(cursor, start) + `\n**Acknowledgments.**\n${argument.value}\n`;
    cursor = argument.end;
    start = text.indexOf(command, cursor);
  }
  return cursor ? normalized + text.slice(cursor) : text;
}

function unwrapTwocolumn(text: string): string {
  const command = "\\twocolumn";
  let normalized = "";
  let cursor = 0;
  for (let start = text.indexOf(command, cursor); start >= 0; ) {
    const argumentStart = skipWhitespace(text, start + command.length);
    const argument = readDelimitedValue(text, argumentStart, "[", "]");
    normalized += text.slice(cursor, start);
    if (argument) {
      normalized += `\n${argument.value}\n`;
      cursor = argument.end;
    } else {
      cursor = start + command.length;
    }
    start = text.indexOf(command, cursor);
  }
  return cursor ? normalized + text.slice(cursor) : text;
}

function normalizeEpigraphs(text: string): string {
  const command = "\\epigraph";
  let cursor = 0;
  let normalized = "";
  while (cursor < text.length) {
    const start = text.indexOf(command, cursor);
    if (start < 0) return normalized + text.slice(cursor);
    const quote = readBracedValue(
      text,
      skipWhitespace(text, start + command.length),
    );
    const attribution = quote
      ? readBracedValue(text, skipWhitespace(text, quote.end))
      : null;
    if (!quote || !attribution) {
      normalized += text.slice(cursor, start + command.length);
      cursor = start + command.length;
      continue;
    }
    normalized += text.slice(cursor, start);
    normalized += markdownBlockquote(quote.value, attribution.value);
    cursor = attribution.end;
  }
  return normalized;
}

function markdownBlockquote(quote: string, attribution: string): string {
  const lines = normalizeVisibleText(quote)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `${lines}\n>\n> ${normalizeVisibleText(attribution)}`;
}

function skipWhitespace(text: string, start: number): number {
  let cursor = start;
  while (/\s/.test(text[cursor] ?? "")) cursor += 1;
  return cursor;
}

function readBracedValue(
  text: string,
  start: number,
): { value: string; end: number } | null {
  if (text[start] !== "{") return null;
  let depth = 0;
  for (let index = start; index < text.length; index++) {
    if (text[index] === "\\") {
      index += 1;
      continue;
    }
    if (text[index] === "{") depth += 1;
    if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return { value: text.slice(start + 1, index), end: index + 1 };
      }
    }
  }
  return null;
}

function normalizeVisibleText(text: string): string {
  return normalizeInlineMathWhitespace(normalizeLatexCommonCommands(text))
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function normalizeInlineMathWhitespace(text: string): string {
  return text.replace(/(?<!\$)\$([^$\n]+)\$(?!\$)/g, (match, body: string) => {
    const hasBoundaryWhitespace = /^\s/.test(body) || /\s$/.test(body);
    if (!hasBoundaryWhitespace) return match;
    const strongMathSignal = /\\[A-Za-z]+|[_^={}<>]/.test(body);
    if (!(strongMathSignal || (/^\s/.test(body) && /\s$/.test(body)))) {
      return match;
    }
    return `$${body.trim()}$`;
  });
}

function readCommandArgument(source: string, command: string): string | null {
  const needle = `\\${command}`;
  const start = source.indexOf(needle);
  if (start < 0) return null;
  let cursor = start + needle.length;
  while (/\s/.test(source[cursor] ?? "")) cursor += 1;
  if (source[cursor] !== "{") return null;
  let depth = 0;
  for (let index = cursor; index < source.length; index++) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(cursor + 1, index);
    }
  }
  return null;
}

function commandEnd(source: string, command: string): number | null {
  const start = source.indexOf(command);
  return start >= 0 ? start + command.length : null;
}

function stableSourceHash(source: string): string {
  let high = 0xcbf29ce4 >>> 0;
  let low = 0x84222325 >>> 0;
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    high = Math.imul(high ^ code, 0x01000193) >>> 0;
    low = Math.imul(low ^ (code + 0x9e37), 0x01000193) >>> 0;
  }
  return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
}

function occurrences(text: string, token: string): number {
  return text.split(token).length - 1;
}
