// Pure LaTeX-source helpers: comment stripping, main-file selection,
// \input inlining. No I/O.

export interface TexFile {
  path: string;
  text: string;
}

// Drop %-to-end-of-line comments; a backslash escapes the next char, so
// `\%` is a literal percent and not a comment start.
function stripLineComment(line: string): string {
  let i = 0;
  while (i < line.length) {
    if (line[i] === "\\") {
      i += 2;
      continue;
    }
    if (line[i] === "%") return line.slice(0, i);
    i += 1;
  }
  return line;
}

export function stripTexComments(text: string): string {
  return text.split("\n").map(stripLineComment).join("\n");
}

// The main .tex file: prefer one with \begin{document} (and \documentclass);
// fall back to any .tex.
export function findMainTex(files: TexFile[]): TexFile | null {
  const tex = files.filter((f) => f.path.toLowerCase().endsWith(".tex"));
  if (!tex.length) return null;
  const withDoc = tex.filter((f) => f.text.includes("\\begin{document}"));
  return (
    withDoc.find((f) => f.text.includes("\\documentclass")) ??
    withDoc[0] ??
    tex[0]
  );
}

// Inline zero-argument macro definitions from the source — replace every
// `\NAME` (at a word boundary) with its body until fixpoint. WHY: an arXiv
// paper's preamble defines paper-specific macros (`\ModelSymbol`, `\ours`,
// `\E`, ...). When the model parrots those macros in its response, KaTeX in
// the sidebar cannot render them and the user sees source-only tokens.
// Expanding the macros locally gives the model chat-ready LaTeX.
//
// This is intentionally a small, safe subset rather than a LaTeX compiler:
// supported definitions are zero-arg `\newcommand`, `\renewcommand`,
// `\providecommand`, `\DeclareRobustCommand`, and `\def`; parameterized
// macros are left untouched. Definition spans are protected from rewriting
// so the preamble remains readable for debugging.
export function expandMacros(text: string): string {
  const defs = collectZeroArgMacroDefinitions(text);
  if (defs.size === 0) return text;

  const protectedSpans = Array.from(defs.values())
    .map((def) => ({ start: def.start, end: def.end }))
    .sort((a, b) => a.start - b.start);

  let out = "";
  let cursor = 0;
  for (const span of protectedSpans) {
    if (span.start > cursor) {
      out += expandMacroSegment(text.slice(cursor, span.start), defs);
    }
    out += text.slice(span.start, span.end);
    cursor = span.end;
  }
  if (cursor < text.length) {
    out += expandMacroSegment(text.slice(cursor), defs);
  }
  return out;
}

// Convert LaTeX citation commands into a stable, human-readable placeholder.
// WHY: `\cite{foo}` is source syntax, not PDF-visible prose; if we send it to
// the model, it tends to quote raw bibliography keys. We do not hard-code
// paper-specific keys or try to reconstruct bibliography numbering here — that
// would require compiling/parsing the bibliography style. A neutral marker is
// better than leaking source-only control sequences into evidence quotes.
export function normalizeCitations(text: string): string {
  let out = "";
  let cursor = 0;
  while (cursor < text.length) {
    const parsed = findNextCitationCommand(text, cursor);
    if (!parsed) return out + text.slice(cursor);
    out += text.slice(cursor, parsed.start);
    out += parsed.replacement;
    cursor = parsed.end;
  }
  return out;
}

export function findNextCitationCommand(
  text: string,
  cursor: number,
): { start: number; end: number; replacement: string } | null {
  for (let i = cursor; i < text.length; i++) {
    const parsed = parseCitationCommandAt(text, i);
    if (parsed) return { start: i, ...parsed };
  }
  return null;
}

// Remove or neutralize LaTeX commands that exist for source compilation, not
// for visible paper text. `\label{...}`, `\notag`, and `\nonumber` should not
// be shown to the model or rendered in chat; cross-references are kept as a
// neutral marker because reconstructing the compiled number requires TeX.
export function normalizeLatexSourceCommands(
  text: string,
  options: {
    preserveSectionLabels?: boolean;
    preserveEquationLabels?: boolean;
    preserveFigureLabels?: boolean;
    preserveTableLabels?: boolean;
  } = {},
): string {
  let out = "";
  let cursor = 0;
  while (cursor < text.length) {
    const parsed = findNextLatexSourceCommand(text, cursor);
    if (!parsed) return out + text.slice(cursor);
    out += text.slice(cursor, parsed.start);
    out += shouldPreserveLatexLabel(text, parsed, options)
      ? text.slice(parsed.start, parsed.end)
      : parsed.replacement;
    cursor = parsed.end;
  }
  return out;
}

export function findNextLatexSourceCommand(
  text: string,
  cursor: number,
): { start: number; end: number; command: string; replacement: string } | null {
  for (let i = cursor; i < text.length; i++) {
    const parsed = parseLatexSourceCommandAt(text, i);
    if (parsed) return { start: i, ...parsed };
  }
  return null;
}

// Convert visible LaTeX list environments to Markdown lists. This keeps the
// paper prose close to the compiled PDF (`enumerate` -> numbered list,
// `itemize` -> bullets) instead of leaking source commands such as `\item`.
export function normalizeLatexListEnvironments(text: string): string {
  let out = "";
  let cursor = 0;
  while (cursor < text.length) {
    const parsed = findNextLatexListEnvironment(text, cursor);
    if (!parsed) return out + text.slice(cursor);
    out += text.slice(cursor, parsed.start);
    out += latexListToMarkdown(parsed);
    cursor = parsed.end;
  }
  return out;
}

export interface LatexListEnvironment {
  start: number;
  end: number;
  env: "enumerate" | "itemize";
  body: string;
}

export function findNextLatexListEnvironment(
  text: string,
  cursor: number,
): LatexListEnvironment | null {
  for (let i = cursor; i < text.length; i++) {
    const parsed = readListEnvironmentAt(text, i);
    if (parsed) return parsed;
  }
  return null;
}

export type LatexTextCommandKind =
  | "emphasis"
  | "strong"
  | "code"
  | "underline"
  | "plain";

export interface LatexTextCommand {
  start: number;
  end: number;
  command: string;
  kind: LatexTextCommandKind;
  content: string;
}

// Convert source-only LaTeX text wrappers to Markdown-ish text while keeping
// their semantic content. This is for chat-ready arXiv text, not raw source:
// `\emph{chunk}` should reach the model as emphasis (`*chunk*`), not as a
// control sequence. Math commands such as `\mathbf{o}_t` are intentionally
// left alone and rendered by KaTeX.
export function normalizeLatexTextCommands(text: string): string {
  let out = "";
  let cursor = 0;
  while (cursor < text.length) {
    const parsed = findNextLatexTextCommand(text, cursor);
    if (!parsed) return out + text.slice(cursor);
    out += text.slice(cursor, parsed.start);
    out += latexTextCommandToMarkdown(parsed);
    cursor = parsed.end;
  }
  return out;
}

export function findNextLatexTextCommand(
  text: string,
  cursor: number,
): LatexTextCommand | null {
  for (let i = cursor; i < text.length; i++) {
    if (text[i] !== "\\") continue;
    if (isProbablyInMathMode(text, i)) continue;
    const parsed = parseLatexTextCommandAt(text, i);
    if (parsed) return { start: i, ...parsed };
  }
  return null;
}

interface MacroReplacement {
  text: string;
  mathText?: string;
  start: number;
  end: number;
}

function collectZeroArgMacroDefinitions(
  text: string,
): Map<string, MacroReplacement> {
  const defs = new Map<string, MacroReplacement>();
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "\\") {
      i += 1;
      continue;
    }
    const parsed = parseMacroDefinitionAt(text, i);
    if (!parsed) {
      i += 1;
      continue;
    }
    if (!defs.has(parsed.name)) {
      defs.set(parsed.name, {
        ...normalizeMacroBody(parsed.body),
        start: parsed.start,
        end: parsed.end,
      });
    }
    i = parsed.end;
  }

  // Resolve macro bodies that are defined in terms of earlier zero-arg
  // macros (`\loss -> \E[L]`). Keep spans from the original definitions.
  for (let iteration = 0; iteration < 10; iteration++) {
    let changed = false;
    for (const [name, def] of defs) {
      const nextText = expandMacroSegment(def.text, defs, name);
      const nextMathText = def.mathText
        ? expandMacroSegment(def.mathText, defs, name)
        : undefined;
      if (nextText !== def.text || nextMathText !== def.mathText) {
        defs.set(name, {
          ...def,
          text: nextText,
          ...(nextMathText ? { mathText: nextMathText } : {}),
        });
        changed = true;
      }
    }
    if (!changed) break;
  }
  return defs;
}

function expandMacroSegment(
  segment: string,
  defs: Map<string, MacroReplacement>,
  skipName?: string,
): string {
  let result = segment;
  for (let iteration = 0; iteration < 10; iteration++) {
    let changed = false;
    for (const [name, def] of defs) {
      if (name === skipName) continue;
      const pattern = new RegExp(
        `\\\\${name}(?![A-Za-z])(?:\\\\(?=\\s))?`,
        "g",
      );
      const next = result.replace(pattern, (match, offset: number) => {
        const replacement =
          def.mathText && isProbablyInMathMode(result, offset)
            ? def.mathText
            : def.text;
        // If we consumed LaTeX's explicit space command (`\foo\ bar`), the
        // following real space remains, so no extra space is inserted here.
        return replacement;
      });
      if (next !== result) {
        result = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return result;
}

function parseMacroDefinitionAt(
  text: string,
  start: number,
): { name: string; body: string; start: number; end: number } | null {
  const command = readCommandName(text, start);
  if (!command) return null;
  if (
    command.name === "newcommand" ||
    command.name === "renewcommand" ||
    command.name === "providecommand" ||
    command.name === "DeclareRobustCommand"
  ) {
    let i = command.end;
    if (text[i] === "*") i += 1;
    i = skipSpaces(text, i);
    const macro = readMacroNameArgument(text, i);
    if (!macro) return null;
    i = skipSpaces(text, macro.end);
    // `[1]` / `[2][default]` means argument-aware expansion is required.
    if (text[i] === "[") return null;
    if (text[i] !== "{") return null;
    const body = readBalancedBraces(text, i);
    if (!body) return null;
    return {
      name: macro.name,
      body: body.content,
      start,
      end: body.end,
    };
  }

  if (command.name === "def") {
    let i = skipSpaces(text, command.end);
    const macro = readCommandName(text, i);
    if (!macro) return null;
    i = macro.end;
    const beforeBody = skipSpaces(text, i);
    // `\def\foo#1{...}` is parameterized; only allow whitespace before `{`.
    if (beforeBody !== i && text.slice(i, beforeBody).trim()) return null;
    if (text[beforeBody] !== "{") return null;
    const body = readBalancedBraces(text, beforeBody);
    if (!body) return null;
    return {
      name: macro.name,
      body: body.content,
      start,
      end: body.end,
    };
  }

  return null;
}

const CITE_COMMANDS = new Set([
  "cite",
  "citep",
  "citet",
  "citealp",
  "citealt",
  "citeauthor",
  "citeyear",
  "citeyearpar",
  "parencite",
  "textcite",
  "autocite",
  "footcite",
]);

const TEXT_COMMANDS: Record<string, LatexTextCommandKind> = {
  emph: "emphasis",
  textit: "emphasis",
  textsl: "emphasis",
  textbf: "strong",
  texttt: "code",
  underline: "underline",
  textsc: "plain",
  textrm: "plain",
  textsf: "plain",
  // Custom revision/markup macros that just wrap real prose+math: keep the
  // content, drop the command (don't leak `\edit{`).
  edit: "plain",
};

// `\footnote{…}` is tangential source metadata; dropping the command AND its
// content keeps the quoted sentence readable (inlining a footnote mid-sentence
// breaks the flow). Treated like `\label` — command + braced arg removed.
const SOURCE_ONLY_COMMANDS = new Set(["label", "footnote"]);

const SOURCE_ONLY_BARE_COMMANDS = new Set(["notag", "nonumber"]);

const REFERENCE_COMMANDS = new Set([
  "ref",
  "eqref",
  "pageref",
  "autoref",
  "nameref",
  "cref",
  "Cref",
  "vref",
  "Vref",
]);

const LIST_ENVIRONMENTS = new Set(["enumerate", "itemize"]);

function parseCitationCommandAt(
  text: string,
  start: number,
): { end: number; replacement: string } | null {
  const command = readCommandName(text, start);
  if (!command || !CITE_COMMANDS.has(command.name)) return null;
  let i = command.end;
  if (text[i] === "*") i += 1;
  i = skipSpaces(text, i);
  while (text[i] === "[") {
    const optional = readBalancedDelimiters(text, i, "[", "]");
    if (!optional) return null;
    i = skipSpaces(text, optional.end);
  }
  if (text[i] !== "{") return null;
  const keys = readBalancedBraces(text, i);
  if (!keys) return null;
  return { end: keys.end, replacement: "[citation]" };
}

function parseLatexSourceCommandAt(
  text: string,
  start: number,
): { end: number; command: string; replacement: string } | null {
  const command = readCommandName(text, start);
  if (!command) return null;

  if (SOURCE_ONLY_BARE_COMMANDS.has(command.name)) {
    return { end: command.end, command: command.name, replacement: "" };
  }

  let i = command.end;
  if (text[i] === "*") i += 1;
  i = skipSpaces(text, i);

  if (SOURCE_ONLY_COMMANDS.has(command.name)) {
    if (text[i] !== "{") return null;
    const arg = readBalancedBraces(text, i);
    return arg
      ? { end: arg.end, command: command.name, replacement: "" }
      : null;
  }

  if (REFERENCE_COMMANDS.has(command.name)) {
    while (text[i] === "[") {
      const optional = readBalancedDelimiters(text, i, "[", "]");
      if (!optional) return null;
      i = skipSpaces(text, optional.end);
    }
    if (text[i] !== "{") return null;
    const arg = readBalancedBraces(text, i);
    return arg
      ? { end: arg.end, command: command.name, replacement: "[ref]" }
      : null;
  }

  // Unknown command whose sole argument is a cross-reference label
  // (`type:name`, e.g. \fig{fig:overview}). arXiv papers define custom ref
  // macros (\fig, \tab, \eqn, …) we can't enumerate; the label shape is the
  // reliable signal. Render as a neutral [ref] marker, like \ref / \cref.
  // Cite/text/url commands keep their own handling.
  if (
    text[i] === "{" &&
    !CITE_COMMANDS.has(command.name) &&
    !(command.name in TEXT_COMMANDS) &&
    !URL_COMMANDS.has(command.name)
  ) {
    const arg = readBalancedBraces(text, i);
    if (arg && isCrossReferenceLabelArg(arg.content)) {
      return { end: arg.end, command: command.name, replacement: "[ref]" };
    }
  }

  return null;
}

// A `type:name` cross-reference label (`fig:overview`, `eq:loss`), optionally a
// comma-separated list (\cref-style). The no-space, letters-before-colon shape
// keeps ordinary prose (`Note: foo`), times (`12:30`), and URLs/DOIs
// (`http://…`, `doi:10.1/x`) from matching.
function isCrossReferenceLabelArg(content: string): boolean {
  const label = "[A-Za-z]+:[A-Za-z0-9_.:-]+";
  return new RegExp(`^\\s*${label}(?:\\s*,\\s*${label})*\\s*$`).test(content);
}

const URL_COMMANDS = new Set(["url", "href", "nolinkurl", "path"]);

function isLikelySectionLabel(text: string, start: number): boolean {
  const before = text.slice(Math.max(0, start - 500), start);
  return /\\(?:section|subsection|subsubsection|paragraph)\*?(?:\[[^\]]*\])?\{(?:[^{}]|\{[^{}]*\})*\}\s*$/.test(
    before,
  );
}

function shouldPreserveLatexLabel(
  text: string,
  parsed: { start: number; end: number; command: string; replacement: string },
  options: {
    preserveSectionLabels?: boolean;
    preserveEquationLabels?: boolean;
    preserveFigureLabels?: boolean;
    preserveTableLabels?: boolean;
  },
): boolean {
  if (parsed.command !== "label") return false;
  if (
    options.preserveSectionLabels &&
    isLikelySectionLabel(text, parsed.start)
  ) {
    return true;
  }
  return (
    (options.preserveEquationLabels === true &&
      isLikelyEquationLabel(text, parsed.start)) ||
    (options.preserveFigureLabels === true &&
      isLikelyFigureLabel(text, parsed.start)) ||
    (options.preserveTableLabels === true &&
      isLikelyTableLabel(text, parsed.start))
  );
}

function isLikelyEquationLabel(text: string, start: number): boolean {
  const before = text.slice(Math.max(0, start - 5000), start);
  const beginRe = /\\begin\{(equation|align|alignat|gather|multline)(\*)?\}/g;
  let last: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = beginRe.exec(before)) !== null) last = match;
  if (!last || last[2]) return false;
  const env = last[1];
  const lastBeginEnd = Math.max(0, start - 5000) + last.index + last[0].length;
  const between = text.slice(lastBeginEnd, start);
  if (new RegExp(`\\\\end\\{${env}\\*?\\}`).test(between)) return false;
  return new RegExp(`\\\\end\\{${env}\\}`).test(
    text.slice(start, start + 5000),
  );
}

function isLikelyFigureLabel(text: string, start: number): boolean {
  const before = text.slice(Math.max(0, start - 10000), start);
  const beginRe = /\\begin\{figure\*?\}(?:\[[^\]]*\])?/g;
  let last: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = beginRe.exec(before)) !== null) last = match;
  if (!last) return false;
  const lastBeginEnd = Math.max(0, start - 10000) + last.index + last[0].length;
  const between = text.slice(lastBeginEnd, start);
  if (/\\end\{figure\*?\}/.test(between)) return false;
  return /\\end\{figure\*?\}/.test(text.slice(start, start + 10000));
}

function isLikelyTableLabel(text: string, start: number): boolean {
  const before = text.slice(Math.max(0, start - 10000), start);
  const beginRe = /\\begin\{table\*?\}(?:\[[^\]]*\])?/g;
  let last: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = beginRe.exec(before)) !== null) last = match;
  if (!last) return false;
  const lastBeginEnd = Math.max(0, start - 10000) + last.index + last[0].length;
  const between = text.slice(lastBeginEnd, start);
  if (/\\end\{table\*?\}/.test(between)) return false;
  return /\\end\{table\*?\}/.test(text.slice(start, start + 10000));
}

function readListEnvironmentAt(
  text: string,
  start: number,
): LatexListEnvironment | null {
  const opener = readListBoundaryAt(text, start);
  if (!opener || opener.kind !== "begin") return null;
  const close = findMatchingListEnvironmentEnd(text, opener.end, opener.env);
  if (!close) return null;
  return {
    start,
    end: close.end,
    env: opener.env,
    body: text.slice(opener.end, close.start),
  };
}

function findMatchingListEnvironmentEnd(
  text: string,
  from: number,
  env: "enumerate" | "itemize",
): { start: number; end: number } | null {
  const stack: Array<"enumerate" | "itemize"> = [env];
  for (let i = from; i < text.length; i++) {
    const boundary = readListBoundaryAt(text, i);
    if (!boundary) continue;
    if (boundary.kind === "begin") {
      stack.push(boundary.env);
    } else if (stack[stack.length - 1] === boundary.env) {
      stack.pop();
      if (stack.length === 0) {
        return { start: i, end: boundary.end };
      }
    }
    i = boundary.end - 1;
  }
  return null;
}

function readListBoundaryAt(
  text: string,
  start: number,
): { kind: "begin" | "end"; env: "enumerate" | "itemize"; end: number } | null {
  if (
    !text.startsWith("\\begin{", start) &&
    !text.startsWith("\\end{", start)
  ) {
    return null;
  }
  const kind = text.startsWith("\\begin{", start) ? "begin" : "end";
  const nameStart =
    start + (kind === "begin" ? "\\begin{".length : "\\end{".length);
  const nameEnd = text.indexOf("}", nameStart);
  if (nameEnd < 0) return null;
  const env = text.slice(nameStart, nameEnd);
  if (!LIST_ENVIRONMENTS.has(env)) return null;
  return {
    kind,
    env: env as "enumerate" | "itemize",
    end: nameEnd + 1,
  };
}

function latexListToMarkdown(list: LatexListEnvironment): string {
  const items = splitLatexListItems(list.body);
  if (!items.length) return "";
  return items
    .map((item, index) => {
      const content = normalizeListItemContent(
        normalizeLatexListEnvironments(item.content),
      );
      const prefix =
        item.label != null
          ? item.label
          : list.env === "enumerate"
            ? `${index + 1}.`
            : "-";
      return `${prefix} ${content}`.trimEnd();
    })
    .join("\n");
}

function splitLatexListItems(
  body: string,
): Array<{ label?: string; content: string }> {
  const items: Array<{ label?: string; content: string }> = [];
  let current: { label?: string; start: number } | null = null;
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const boundary = readListBoundaryAt(body, i);
    if (boundary) {
      depth += boundary.kind === "begin" ? 1 : -1;
      i = boundary.end - 1;
      continue;
    }
    if (depth !== 0 || !isLatexItemAt(body, i)) continue;
    if (current) {
      items.push({ ...current, content: body.slice(current.start, i).trim() });
    }
    const parsed = readLatexItemAt(body, i);
    current = {
      ...(parsed.label ? { label: parsed.label } : {}),
      start: parsed.end,
    };
    i = parsed.end - 1;
  }
  if (current) {
    items.push({ ...current, content: body.slice(current.start).trim() });
  }
  return items;
}

function isLatexItemAt(text: string, start: number): boolean {
  return (
    text.startsWith("\\item", start) &&
    !/[A-Za-z]/.test(text[start + "\\item".length] ?? "")
  );
}

function readLatexItemAt(
  text: string,
  start: number,
): { label?: string; end: number } {
  let i = skipSpaces(text, start + "\\item".length);
  if (text[i] !== "[") return { end: i };
  const label = readBalancedDelimiters(text, i, "[", "]");
  if (!label) return { end: i };
  return { label: label.content.trim(), end: skipSpaces(text, label.end) };
}

function normalizeListItemContent(content: string): string {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) return lines[0] ?? "";
  return lines.join(" ");
}

function parseLatexTextCommandAt(
  text: string,
  start: number,
): Omit<LatexTextCommand, "start"> | null {
  const command = readCommandName(text, start);
  if (!command) return null;

  let kind = TEXT_COMMANDS[command.name];
  let i = skipSpaces(text, command.end);

  // `\textcolor{red}{body}` is a two-argument text wrapper. Preserve only
  // the visible body; the color name is source styling, not paper prose.
  if (command.name === "textcolor") {
    const color = readBalancedBraces(text, i);
    if (!color) return null;
    i = skipSpaces(text, color.end);
    kind = "plain";
  }

  if (!kind || text[i] !== "{") return null;
  const body = readBalancedBraces(text, i);
  if (!body) return null;
  return {
    end: body.end,
    command: command.name,
    kind,
    content: body.content,
  };
}

function latexTextCommandToMarkdown(command: LatexTextCommand): string {
  const content = normalizeLatexTextCommands(command.content);
  if (command.kind === "emphasis") return `*${content}*`;
  if (command.kind === "strong") return `**${content}**`;
  if (command.kind === "code")
    return content.includes("`") ? content : `\`${content}\``;
  return content;
}

function readMacroNameArgument(
  text: string,
  start: number,
): { name: string; end: number } | null {
  if (text[start] === "{") {
    const braced = readBalancedBraces(text, start);
    if (!braced) return null;
    const inner = braced.content.trim();
    const macro = readCommandName(inner, 0);
    if (!macro || macro.end !== inner.length) return null;
    return { name: macro.name, end: braced.end };
  }
  return readCommandName(text, start);
}

function readCommandName(
  text: string,
  start: number,
): { name: string; end: number } | null {
  if (text[start] !== "\\") return null;
  let i = start + 1;
  while (i < text.length && /[A-Za-z]/.test(text[i])) i += 1;
  if (i === start + 1) return null;
  return { name: text.slice(start + 1, i), end: i };
}

function readBalancedBraces(
  text: string,
  start: number,
): { content: string; end: number } | null {
  if (text[start] !== "{") return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return { content: text.slice(start + 1, i), end: i + 1 };
      }
    }
  }
  return null;
}

function readBalancedDelimiters(
  text: string,
  start: number,
  open: string,
  close: string,
): { content: string; end: number } | null {
  if (text[start] !== open) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === open) depth += 1;
    if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        return { content: text.slice(start + 1, i), end: i + 1 };
      }
    }
  }
  return null;
}

function skipSpaces(text: string, start: number): number {
  let i = start;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  return i;
}

function normalizeMacroBody(body: string): { text: string; mathText?: string } {
  const withoutSpacing = body.replace(/\\xspace(?![A-Za-z])/g, "").trim();
  const ensured = unwrapEnsureMath(withoutSpacing);
  if (ensured != null) {
    return { text: `$${ensured}$`, mathText: ensured };
  }
  return { text: withoutSpacing };
}

function unwrapEnsureMath(body: string): string | null {
  const command = "\\ensuremath";
  if (!body.startsWith(command)) return null;
  const start = skipSpaces(body, command.length);
  const braced = readBalancedBraces(body, start);
  if (!braced) return null;
  if (body.slice(braced.end).trim()) return null;
  return braced.content.trim();
}

function isProbablyInMathMode(text: string, index: number): boolean {
  let math = false;
  for (let i = 0; i < index; i++) {
    if (text[i] === "\\") {
      const next = text[i + 1];
      if (next === "(" || next === "[") {
        math = true;
        i += 1;
        continue;
      }
      if (next === ")" || next === "]") {
        math = false;
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (text[i] === "$") {
      if (text[i + 1] === "$") i += 1;
      math = !math;
    }
  }
  return math;
}

// Recursively replace \input{f} / \include{f} with the referenced file's
// content. Depth-capped against pathological cycles.
export function inlineInputs(
  text: string,
  files: TexFile[],
  depth = 0,
): string {
  if (depth > 12) return text;
  return text.replace(
    /\\(?:input|include)\{([^}]+)\}/g,
    (whole, name: string) => {
      const target = name.trim();
      const f = files.find(
        (x) =>
          x.path === target ||
          x.path === `${target}.tex` ||
          x.path.endsWith(`/${target}`) ||
          x.path.endsWith(`/${target}.tex`),
      );
      return f ? inlineInputs(f.text, files, depth + 1) : whole;
    },
  );
}
