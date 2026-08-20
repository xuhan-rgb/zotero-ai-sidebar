// Deterministic figure index for cached LaTeX source. This gives the model a
// concrete "Figure N -> caption + includegraphics path" lookup instead of
// making it infer figures from nearby prose.

export interface TexFigure {
  number: number;
  env: string;
  label?: string;
  caption?: string;
  graphics: string[];
  tex: string;
  start: number;
  end: number;
  contextBefore: string;
  contextAfter: string;
}

const FIGURE_ENV_RE =
  /\\begin\{(figure\*?|wrapfigure|floatingfigure|center)\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{\1\}/g;
const FIGURE_TYPE_SETUP_RE =
  /\\captionsetup(?:\s*\[[^\]]*\])?\s*\{[^{}]*\btype\s*=\s*figure\b[^{}]*\}/;
const FIGURE_CAPTION_OF_RE = /\\captionof\s*\{\s*figure\s*\}/;
const INCLUDE_GRAPHICS_RE = /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g;
const LABEL_RE = /\\label\{([^}]+)\}/;
const FIGURE_COUNTER_RE =
  /\\(setcounter|addtocounter)\s*\{\s*figure\s*\}\s*\{\s*([+-]?\d+)\s*\}|\\(?:refstepcounter|stepcounter)\s*\{\s*figure\s*\}/g;

export function parseFigures(text: string): TexFigure[] {
  const figures: TexFigure[] = [];
  let nextNumber = 1;
  let cursor = 0;
  FIGURE_ENV_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = FIGURE_ENV_RE.exec(text)) !== null) {
    const [, env, body] = match;
    const start = match.index;
    const end = start + match[0].length;
    if (
      env === "center" &&
      !FIGURE_TYPE_SETUP_RE.test(body) &&
      !FIGURE_CAPTION_OF_RE.test(body)
    ) {
      continue;
    }
    nextNumber = applyFigureCounterUpdates(
      text.slice(cursor, start),
      nextNumber,
    );
    const captions = captionCommandsIn(body);
    const captionInfo = captions.find((caption) => caption.kind === "caption");
    nextNumber = applyFigureCounterUpdates(
      body.slice(0, captionInfo?.start ?? body.length),
      nextNumber,
    );
    const label = body.match(LABEL_RE)?.[1];
    const caption = captions
      .map((item) => compactSnippet(item.content))
      .filter(Boolean)
      .join(" ");
    const graphics = graphicsIn(body);
    figures.push({
      number: nextNumber++,
      env,
      ...(label ? { label } : {}),
      ...(caption ? { caption } : {}),
      graphics,
      tex: match[0],
      start,
      end,
      contextBefore: contextBefore(text, start),
      contextAfter: contextAfter(text, end),
    });
    nextNumber = applyFigureCounterUpdates(
      captionInfo ? body.slice(captionInfo.end) : "",
      nextNumber,
    );
    cursor = end;
  }

  return figures;
}

function applyFigureCounterUpdates(text: string, fallback: number): number {
  let nextNumber = fallback;
  FIGURE_COUNTER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FIGURE_COUNTER_RE.exec(text)) !== null) {
    const operation = match[1];
    const value = match[2] == null ? 1 : Number(match[2]);
    if (!Number.isFinite(value)) continue;
    if (operation === "setcounter") nextNumber = value + 1;
    else if (operation === "addtocounter") nextNumber += value;
    else nextNumber += 1;
  }
  return nextNumber;
}

export function annotateNumberedFigures(text: string): string {
  const figures = parseFigures(text);
  if (!figures.length) return text;
  let out = text;
  for (const fig of figures.slice().sort((a, b) => b.start - a.start)) {
    const label = fig.label ? ` label=${fig.label}` : "";
    const graphics = fig.graphics.length
      ? ` graphics=${fig.graphics.join(",")}`
      : "";
    const marker = `\n[Figure (${fig.number})${label}${graphics}]\n`;
    out = out.slice(0, fig.start) + marker + out.slice(fig.start);
  }
  return out;
}

export function findFigure(
  figures: TexFigure[],
  query: { number?: number; label?: string; name?: string },
): TexFigure | null {
  const label = query.label?.trim();
  if (label) {
    const byLabel = figures.find((fig) => fig.label === label);
    if (byLabel) return byLabel;
  }
  if (query.number != null) {
    const byNumber = figures.find((fig) => fig.number === query.number);
    if (byNumber) return byNumber;
  }
  const name = query.name?.trim().toLowerCase();
  if (name) {
    return (
      figures.find((fig) =>
        [fig.caption ?? "", fig.label ?? "", ...fig.graphics]
          .join(" ")
          .toLowerCase()
          .includes(name),
      ) ?? null
    );
  }
  return null;
}

export function summarizeFigureIndex(figures: TexFigure[]): string {
  if (!figures.length) return "(none)";
  return figures
    .slice(0, 20)
    .map((fig) => {
      const label = fig.label ? ` ${fig.label}` : "";
      const graphic = fig.graphics[0] ? ` ${fig.graphics[0]}` : "";
      return `Figure ${fig.number}${label}${graphic}`;
    })
    .join(", ");
}

export function plainFigureCaption(fig: TexFigure): string {
  return stripLatexMarkup(fig.caption ?? "");
}

function graphicsIn(text: string): string[] {
  const graphics: string[] = [];
  INCLUDE_GRAPHICS_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INCLUDE_GRAPHICS_RE.exec(text)) !== null) {
    graphics.push(match[1].trim());
  }
  return graphics;
}

interface FigureCaptionCommand {
  kind: "caption" | "subcaption";
  content: string;
  start: number;
  end: number;
}

function captionCommandsIn(text: string): FigureCaptionCommand[] {
  const captions: FigureCaptionCommand[] = [];
  const commandRe = /\\(subcaption|captionof|caption)\b/g;
  let match: RegExpExecArray | null;
  while ((match = commandRe.exec(text)) !== null) {
    let cursor = match.index + match[0].length;
    if (text[cursor] === "*") cursor += 1;
    cursor = skipSpaces(text, cursor);
    if (match[1] === "captionof") {
      const type = readBalanced(text, cursor, "{", "}");
      if (!type || type.content.trim() !== "figure") continue;
      cursor = skipSpaces(text, type.end);
    }
    if (text[cursor] === "[") {
      const optional = readBalanced(text, cursor, "[", "]");
      if (!optional) continue;
      cursor = skipSpaces(text, optional.end);
    }
    const argument = readBalanced(text, cursor, "{", "}");
    if (!argument) continue;
    captions.push({
      kind: match[1] === "subcaption" ? "subcaption" : "caption",
      content: argument.content,
      start: match.index,
      end: argument.end,
    });
    commandRe.lastIndex = argument.end;
  }
  return captions;
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
  return text
    .replace(/\\&/g, "&")
    .replace(/~/g, " ")
    .replace(/\*\*/g, "")
    .replace(/\\(?:textbf|textit|emph)\{([^{}]*)\}/g, "$1")
    .replace(/\\(?:cite|citep|citet|ref|eqref)\{[^}]+\}/g, "")
    .replace(/\[citation\]/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
