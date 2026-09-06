// Shared parsing primitives for LaTeX figure, table, and equation indexes.

export function readBalanced(
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

export function skipSpaces(text: string, cursor: number): number {
  let i = cursor;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  return i;
}

export function contextBefore(text: string, start: number): string {
  return compactSnippet(text.slice(Math.max(0, start - 700), start));
}

export function contextAfter(text: string, end: number): string {
  return compactSnippet(text.slice(end, Math.min(text.length, end + 700)));
}

export function compactSnippet(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
