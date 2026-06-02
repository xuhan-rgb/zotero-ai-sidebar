// Semantic formatting of raw PDF selection text into paragraph/list/heading
// blocks. Pure string helpers; no shared sidebar state.

export type SelectedTextBlockKind = "paragraph" | "list" | "heading";

export interface SelectedTextBlock {
  kind: SelectedTextBlockKind;
  text: string;
}

export function formatSelectedTextSemantically(text: string): string {
  const blocks: SelectedTextBlock[] = [];
  let current: SelectedTextBlock | null = null;
  const flush = () => {
    if (!current) return;
    const value = current.text.trim();
    if (value) blocks.push({ ...current, text: value });
    current = null;
  };

  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = normalizeSelectedTextLine(rawLine);
    if (!line) {
      flush();
      continue;
    }
    const kind = selectedTextBlockKind(line);
    if (kind !== "paragraph") {
      flush();
      current = { kind, text: line };
      continue;
    }
    if (!current) {
      current = { kind: "paragraph", text: line };
    } else {
      current.text = `${current.text} ${line}`;
    }
  }
  flush();
  return joinSelectedTextBlocks(blocks);
}

export function normalizeSelectedTextLine(line: string): string {
  return line
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .trim();
}

export function selectedTextBlockKind(line: string): SelectedTextBlockKind {
  if (/^(?:\d{1,3}[\).]|\([a-zA-Z0-9]\)|[a-zA-Z]\))\s+/.test(line)) {
    return "list";
  }
  if (/^(?:[A-Z]\.|[IVXLC]+\.|Fig(?:ure)?\.?\s*\d+[:.])\s+/.test(line)) {
    return "heading";
  }
  return "paragraph";
}

export function joinSelectedTextBlocks(blocks: SelectedTextBlock[]): string {
  let output = "";
  let previous: SelectedTextBlock | null = null;
  for (const block of blocks) {
    if (!output) {
      output = block.text;
    } else {
      output +=
        previous?.kind === "list" && block.kind === "list" ? "\n" : "\n\n";
      output += block.text;
    }
    previous = block;
  }
  return output.trim();
}

export function repairPdfSelectionLineBreaks(text: string): string {
  return text
    .replace(/([A-Za-z]{3,})-\s*\r?\n\s*([a-z]{3,})/g, "$1$2")
    .replace(/([A-Za-z]{3,})-\s{2,}([a-z]{3,})/g, "$1$2");
}
