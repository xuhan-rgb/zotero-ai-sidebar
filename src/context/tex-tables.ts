// Deterministic table index for cached LaTeX source. This gives the model a
// stable "Table N -> caption + tabular source" lookup instead of guessing from
// nearby PDF text, where multiple floats can appear on the same page.

export interface TexTable {
  number: number;
  env: string;
  label?: string;
  caption?: string;
  tex: string;
  tabularTex?: string;
  start: number;
  end: number;
  contextBefore: string;
  contextAfter: string;
}

const TABLE_ENV_RE =
  /\\begin\{(table\*?)\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{\1\}/g;
const LABEL_RE = /\\label\{([^}]+)\}/g;
const TABULAR_ENV_RE = /\\(begin|end)\{(tabular\*?|tabularx|longtable)\}/g;

interface CaptionCommand {
  start: number;
  end: number;
  content: string;
}

export function parseTables(text: string): TexTable[] {
  const tables: TexTable[] = [];
  let nextNumber = 1;
  TABLE_ENV_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = TABLE_ENV_RE.exec(text)) !== null) {
    const [, env, body] = match;
    const envStart = match.index;
    const envEnd = envStart + match[0].length;
    const bodyStart = envStart + match[0].indexOf(body);
    const captions = findCaptionCommands(body);
    if (!captions.length) continue;

    captions.forEach((caption, index) => {
      const isSingleCaption = captions.length === 1;
      const chunkStart = isSingleCaption
        ? envStart
        : bodyStart +
          (index === 0
            ? 0
            : splitPointAfterCaption(
                body,
                captions[index - 1].end,
                caption.start,
              ));
      const chunkEnd = isSingleCaption
        ? envEnd
        : bodyStart +
          (captions[index + 1]
            ? splitPointAfterCaption(
                body,
                caption.end,
                captions[index + 1].start,
              )
            : body.length);
      const tex = text.slice(chunkStart, chunkEnd).trim();
      const label = labelsIn(tex)[0];
      const tabularTex = findOuterTabular(tex);
      tables.push({
        number: nextNumber++,
        env,
        ...(label ? { label } : {}),
        caption: compactSnippet(caption.content),
        tex,
        ...(tabularTex ? { tabularTex } : {}),
        start: chunkStart,
        end: chunkEnd,
        contextBefore: contextBefore(text, chunkStart),
        contextAfter: contextAfter(text, chunkEnd),
      });
    });
  }

  return tables;
}

function findOuterTabular(text: string): string | undefined {
  const stack: string[] = [];
  let outerStart = -1;
  TABULAR_ENV_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = TABULAR_ENV_RE.exec(text)) !== null) {
    const [, action, env] = match;
    if (action === "begin") {
      if (stack.length === 0) outerStart = match.index;
      stack.push(env);
      continue;
    }
    if (stack.at(-1) !== env) continue;
    stack.pop();
    if (stack.length === 0 && outerStart >= 0) {
      return text.slice(outerStart, TABULAR_ENV_RE.lastIndex);
    }
  }
  return undefined;
}

export function annotateNumberedTables(text: string): string {
  const tables = parseTables(text);
  if (!tables.length) return text;
  let out = text;
  for (const table of tables.slice().sort((a, b) => b.start - a.start)) {
    const label = table.label ? ` label=${table.label}` : "";
    const caption = table.caption
      ? ` caption=${table.caption.slice(0, 120)}`
      : "";
    const marker = `\n[Table (${table.number})${label}${caption}]\n`;
    out = out.slice(0, table.start) + marker + out.slice(table.start);
  }
  return out;
}

export function findTable(
  tables: TexTable[],
  query: { number?: number; label?: string; name?: string },
): TexTable | null {
  const label = query.label?.trim();
  if (label) {
    const byLabel = tables.find((table) => table.label === label);
    if (byLabel) return byLabel;
  }
  if (query.number != null) {
    const byNumber = tables.find((table) => table.number === query.number);
    if (byNumber) return byNumber;
  }
  const name = query.name?.trim().toLowerCase();
  if (name) {
    return (
      tables.find((table) =>
        [table.caption ?? "", table.label ?? "", table.tex]
          .join(" ")
          .toLowerCase()
          .includes(name),
      ) ?? null
    );
  }
  return null;
}

export function summarizeTableIndex(tables: TexTable[]): string {
  if (!tables.length) return "(none)";
  return tables
    .slice(0, 20)
    .map((table) => {
      const label = table.label ? ` ${table.label}` : "";
      const caption = table.caption ? ` ${table.caption.slice(0, 80)}` : "";
      return `Table ${table.number}${label}${caption}`;
    })
    .join(", ");
}

export function plainTableCaption(table: TexTable): string {
  return stripLatexMarkup(table.caption ?? "");
}

function splitPointAfterCaption(
  text: string,
  from: number,
  until: number,
): number {
  const between = text.slice(from, until);
  const minipageEnd = between.match(/\\end\{minipage\}/);
  if (minipageEnd?.index != null) {
    return skipSpaces(text, from + minipageEnd.index + minipageEnd[0].length);
  }
  const label = between.match(/\\label\{[^}]+\}/);
  if (label?.index != null) {
    return skipSpaces(text, from + label.index + label[0].length);
  }
  return from;
}

function findCaptionCommands(text: string): CaptionCommand[] {
  const captions: CaptionCommand[] = [];
  for (let i = 0; i < text.length; i++) {
    const captionOf = readCaptionOfTableAt(text, i);
    if (captionOf) {
      captions.push(captionOf);
      i = captionOf.end - 1;
      continue;
    }
    const caption = readCaptionAt(text, i);
    if (caption) {
      captions.push(caption);
      i = caption.end - 1;
    }
  }
  return captions;
}

function readCaptionAt(text: string, start: number): CaptionCommand | null {
  const command = "\\caption";
  if (!text.startsWith(command, start)) return null;
  const next = text[start + command.length];
  if (/[A-Za-z@]/.test(next ?? "")) return null;
  let cursor = start + command.length;
  if (text[cursor] === "*") return null;
  cursor = skipSpaces(text, cursor);
  if (text[cursor] === "[") {
    const optional = readBalanced(text, cursor, "[", "]");
    if (!optional) return null;
    cursor = skipSpaces(text, optional.end);
  }
  if (text[cursor] !== "{") return null;
  const arg = readBalanced(text, cursor, "{", "}");
  if (!arg) return null;
  return { start, end: arg.end, content: arg.content };
}

function readCaptionOfTableAt(
  text: string,
  start: number,
): CaptionCommand | null {
  const command = "\\captionof";
  if (!text.startsWith(command, start)) return null;
  const next = text[start + command.length];
  if (/[A-Za-z@]/.test(next ?? "")) return null;
  let cursor = skipSpaces(text, start + command.length);
  if (text[cursor] !== "{") return null;
  const type = readBalanced(text, cursor, "{", "}");
  if (!type || type.content.trim() !== "table") return null;
  cursor = skipSpaces(text, type.end);
  if (text[cursor] === "[") {
    const optional = readBalanced(text, cursor, "[", "]");
    if (!optional) return null;
    cursor = skipSpaces(text, optional.end);
  }
  if (text[cursor] !== "{") return null;
  const arg = readBalanced(text, cursor, "{", "}");
  if (!arg) return null;
  return { start, end: arg.end, content: arg.content };
}

function labelsIn(text: string): string[] {
  const labels: string[] = [];
  LABEL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LABEL_RE.exec(text)) !== null) labels.push(match[1]);
  return labels;
}

function readBalanced(
  text: string,
  start: number,
  open: string,
  close: string,
): { content: string; end: number } | null {
  if (text[start] !== open) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "\\") {
      i += 1;
      continue;
    }
    if (text[i] === open) depth += 1;
    if (text[i] === close) {
      depth -= 1;
      if (depth === 0) return { content: text.slice(start + 1, i), end: i + 1 };
    }
  }
  return null;
}

function skipSpaces(text: string, cursor: number): number {
  let i = cursor;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  return i;
}

function stripLatexMarkup(text: string): string {
  const math: string[] = [];
  const protectedText = text.replace(
    /\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\n]+\$/g,
    (source) => {
      const token = `ZAITABLEMATHTOKEN${math.length}X`;
      math.push(source);
      return token;
    },
  );
  const stripped = protectedText
    .replace(/\\&/g, "&")
    .replace(/~/g, " ")
    .replace(/\*\*/g, "")
    .replace(/\\(?:textbf|textit|emph)\{([^{}]*)\}/g, "$1")
    .replace(/\\(?:cite|citep|citet|ref|eqref)\{[^}]+\}/g, "")
    .replace(/\[citation\]/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return math.reduce(
    (caption, source, index) =>
      caption.replace(`ZAITABLEMATHTOKEN${index}X`, source),
    stripped,
  );
}

function contextBefore(text: string, start: number): string {
  return compactSnippet(text.slice(Math.max(0, start - 700), start));
}

function contextAfter(text: string, end: number): string {
  return compactSnippet(text.slice(end, Math.min(text.length, end + 700)));
}

function compactSnippet(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
