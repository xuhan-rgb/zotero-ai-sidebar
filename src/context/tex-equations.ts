import { contextBefore, contextAfter, compactSnippet } from "./tex-parse-utils";
// Build a deterministic equation index from cached LaTeX source.
//
// This intentionally covers common numbered display environments rather than
// trying to be a full TeX compiler. It gives the model a stable local tool for
// "Equation/公式 N" questions instead of making it infer formula numbers
// from nearby prose.

export interface TexEquation {
  number: number;
  env: string;
  label?: string;
  tex: string;
  rowTex?: string;
  start: number;
  end: number;
  contextBefore: string;
  contextAfter: string;
}

const DISPLAY_ENV_RE =
  /\\begin\{(equation|align|alignat|gather|multline)(\*)?\}([\s\S]*?)\\end\{(equation|align|alignat|gather|multline)(\*)?\}/g;
const LABEL_RE = /\\label\{([^}]+)\}/g;
const UNNUMBERED_ROW_RE = /\\(?:notag|nonumber)\b/;
const MULTI_ROW_ENVS = new Set(["align", "alignat", "gather"]);

export function parseEquations(text: string): TexEquation[] {
  const equations: TexEquation[] = [];
  let nextNumber = 1;
  DISPLAY_ENV_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = DISPLAY_ENV_RE.exec(text)) !== null) {
    const [, beginEnv, beginStar, body, endEnv, endStar] = match;
    if (beginEnv !== endEnv || (beginStar ?? "") !== (endStar ?? "")) continue;
    const start = match.index;
    const end = start + match[0].length;
    if (beginStar) continue;

    if (MULTI_ROW_ENVS.has(beginEnv)) {
      const rows = splitLatexRows(body);
      const numberedRows = rows.filter(
        (row) => row.text.trim() && !UNNUMBERED_ROW_RE.test(row.text),
      );
      const envLabels = labelsIn(body);
      for (const row of numberedRows) {
        const labels = labelsIn(row.text);
        const label =
          labels[0] ?? (numberedRows.length === 1 ? envLabels[0] : undefined);
        equations.push({
          number: nextNumber++,
          env: beginEnv,
          ...(label ? { label } : {}),
          tex: match[0],
          rowTex: row.text.trim(),
          start,
          end,
          contextBefore: contextBefore(text, start),
          contextAfter: contextAfter(text, end),
        });
      }
      continue;
    }

    if (UNNUMBERED_ROW_RE.test(body)) continue;
    const labels = labelsIn(body);
    equations.push({
      number: nextNumber++,
      env: beginEnv,
      ...(labels[0] ? { label: labels[0] } : {}),
      tex: match[0],
      start,
      end,
      contextBefore: contextBefore(text, start),
      contextAfter: contextAfter(text, end),
    });
  }

  return equations;
}

export function annotateNumberedEquations(text: string): string {
  const equations = parseEquations(text);
  if (!equations.length) return text;
  let out = text;
  for (const eq of equations.slice().sort((a, b) => b.start - a.start)) {
    const marker = `\n[Equation (${eq.number})${eq.label ? ` label=${eq.label}` : ""}]\n`;
    out = out.slice(0, eq.start) + marker + out.slice(eq.start);
  }
  return out;
}

export function equationDisplayMath(eq: TexEquation): string {
  const rawBody = eq.rowTex ?? equationBody(eq.tex);
  const body = stripEquationSourceCommands(rawBody).trim();
  if (eq.env === "align" || eq.env === "alignat") {
    return `\\begin{aligned}\n${body}\n\\end{aligned}`;
  }
  if (eq.env === "gather") {
    return `\\begin{gathered}\n${body}\n\\end{gathered}`;
  }
  return body;
}

export function findEquation(
  equations: TexEquation[],
  query: { number?: number; label?: string },
): TexEquation | null {
  const label = query.label?.trim();
  if (label) {
    const byLabel = equations.find((eq) => eq.label === label);
    if (byLabel) return byLabel;
  }
  if (query.number != null) {
    return equations.find((eq) => eq.number === query.number) ?? null;
  }
  return null;
}

export function summarizeEquationIndex(equations: TexEquation[]): string {
  if (!equations.length) return "(none)";
  return equations
    .slice(0, 20)
    .map((eq) => `(${eq.number})${eq.label ? ` ${eq.label}` : ""} [${eq.env}]`)
    .join(", ");
}

function labelsIn(text: string): string[] {
  const labels: string[] = [];
  LABEL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LABEL_RE.exec(text)) !== null) labels.push(match[1]);
  return labels;
}

function splitLatexRows(
  body: string,
): Array<{ text: string; start: number; end: number }> {
  const rows: Array<{ text: string; start: number; end: number }> = [];
  let rowStart = 0;
  for (let i = 0; i < body.length - 1; i++) {
    if (body[i] !== "\\" || body[i + 1] !== "\\") continue;
    rows.push({ text: body.slice(rowStart, i), start: rowStart, end: i });
    rowStart = i + 2;
    i += 1;
  }
  rows.push({ text: body.slice(rowStart), start: rowStart, end: body.length });
  return rows;
}

function equationBody(tex: string): string {
  const match = tex.match(/^\\begin\{[^}]+\}([\s\S]*?)\\end\{[^}]+\}\s*$/);
  return match ? match[1] : tex;
}

function stripEquationSourceCommands(text: string): string {
  return text
    .replace(/\\label\{[^}]+\}/g, "")
    .replace(/\\(?:notag|nonumber)\b/g, "");
}
