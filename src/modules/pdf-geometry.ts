// Pure PDF geometry + reader-text math: rect tuples, char-offset matching,
// reader-text normalization, and the Xray-safe plain clone. No Zotero runtime,
// no shared sidebar state, no calls back into sidebar.ts — just math over
// PDF.js reader chars/rects, so it lives in its own module and is unit-tested.

import { finiteNumber } from "./plain-utils";

export type PdfRectTuple = [number, number, number, number];

export function pdfRects(value: unknown): PdfRectTuple[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!Array.isArray(entry) || entry.length < 4) return null;
      const rect = entry.slice(0, 4).map(finiteNumber);
      return rect.every((coord) => coord != null)
        ? (rect as PdfRectTuple)
        : null;
    })
    .filter((rect): rect is PdfRectTuple => !!rect);
}

export function charOffsetsForPdfRects(
  chars: any[],
  rects: PdfRectTuple[],
): [number, number] | null {
  let start = Infinity;
  let end = -1;
  chars.forEach((char, index) => {
    const rect = pdfRectFromChar(char);
    if (
      !rect ||
      !rects.some((selectionRect) => pdfRectCenterInside(rect, selectionRect))
    ) {
      return;
    }
    start = Math.min(start, index);
    end = Math.max(end, index + 1);
  });
  return Number.isFinite(start) && end > start ? [start, end] : null;
}

export function pdfRectFromChar(char: any): PdfRectTuple | null {
  return pdfRects([char?.inlineRect])[0] ?? pdfRects([char?.rect])[0] ?? null;
}

export function charOffsetsForReaderText(
  chars: any[],
  text: string,
  rects: PdfRectTuple[] = [],
): [number, number] | null {
  const needle = normalizedReaderTextWithMap(text).text;
  if (!needle) return null;
  const haystack = normalizedReaderCharsWithMap(chars);
  const matches: Array<[number, number]> = [];
  for (
    let index = haystack.text.indexOf(needle);
    index >= 0;
    index = haystack.text.indexOf(needle, index + 1)
  ) {
    const mapSlice = haystack.map
      .slice(index, index + needle.length)
      .filter((value) => Number.isFinite(value));
    if (!mapSlice.length) continue;
    const start = Math.min(...mapSlice);
    const end = Math.max(...mapSlice) + 1;
    if (end > start) matches.push([start, end]);
  }
  if (!matches.length) return null;
  if (matches.length === 1 || !rects.length) return matches[0]!;
  return matches
    .map((offsets) => ({
      offsets,
      score: rectDistanceScore(
        rectsFromReaderChars(chars.slice(offsets[0], offsets[1])) ?? [],
        rects,
      ),
    }))
    .sort((a, b) => a.score - b.score)[0]!.offsets;
}

export function rectDistanceScore(
  left: PdfRectTuple[],
  right: PdfRectTuple[],
): number {
  if (!left.length || !right.length) return Infinity;
  let total = 0;
  for (const rect of left) {
    total += Math.min(...right.map((target) => pdfRectDistance(rect, target)));
  }
  return total / left.length;
}

export function pdfRectDistance(a: PdfRectTuple, b: PdfRectTuple): number {
  const left = b[2] < a[0];
  const right = a[2] < b[0];
  const bottom = b[3] < a[1];
  const top = a[3] < b[1];

  if (top && left) return Math.hypot(a[0] - b[2], b[1] - a[3]);
  if (left && bottom) return Math.hypot(a[0] - b[2], a[1] - b[3]);
  if (bottom && right) return Math.hypot(a[2] - b[0], a[1] - b[3]);
  if (right && top) return Math.hypot(b[0] - a[2], b[1] - a[3]);
  if (left) return a[0] - b[2];
  if (right) return b[0] - a[2];
  if (bottom) return a[1] - b[3];
  if (top) return b[1] - a[3];
  return 0;
}

export function normalizedReaderTextWithMap(text: string): {
  text: string;
  map: number[];
} {
  return normalizedReaderTokensWithMap(
    Array.from(text).map((char, index) => ({ char, index })),
  );
}

export function normalizedReaderCharsWithMap(chars: any[]): {
  text: string;
  map: number[];
} {
  const tokens: Array<{ char: string; index: number }> = [];
  chars.forEach((char, index) => {
    if (!char || char.ignorable) return;
    if (typeof char.c === "string" && char.c) {
      tokens.push({ char: char.c, index });
    }
    if (char.spaceAfter || char.lineBreakAfter || char.paragraphBreakAfter) {
      tokens.push({ char: " ", index });
    }
  });
  return normalizedReaderTokensWithMap(tokens);
}

export function normalizedReaderTokensWithMap(
  tokens: Array<{ char: string; index: number }>,
): { text: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  let pendingSpace: number | null = null;
  const pushSpace = () => {
    if (
      pendingSpace == null ||
      out.length === 0 ||
      out[out.length - 1] === " "
    ) {
      pendingSpace = null;
      return;
    }
    out.push(" ");
    map.push(pendingSpace);
    pendingSpace = null;
  };
  for (const token of tokens) {
    for (const raw of Array.from(token.char)) {
      if (/\s/u.test(raw)) {
        pendingSpace = token.index;
        continue;
      }
      pushSpace();
      out.push(raw.toLowerCase());
      map.push(token.index);
    }
  }
  if (out[out.length - 1] === " ") {
    out.pop();
    map.pop();
  }
  return { text: out.join(""), map };
}

export function rectsFromReaderChars(chars: any[]): PdfRectTuple[] | null {
  const rects: PdfRectTuple[] = [];
  let current: PdfRectTuple | null = null;
  for (const char of chars) {
    if (!char || char.ignorable) continue;
    const rect = pdfRectFromChar(char);
    if (!rect) continue;
    current = current ? pdfRectUnion(current, rect) : rect;
    if (char.lineBreakAfter) {
      rects.push(current);
      current = null;
    }
  }
  if (current) rects.push(current);
  return rects.length ? rects : null;
}

export function pdfRectUnion(
  left: PdfRectTuple,
  right: PdfRectTuple,
): PdfRectTuple {
  return [
    Math.min(left[0], right[0]),
    Math.min(left[1], right[1]),
    Math.max(left[2], right[2]),
    Math.max(left[3], right[3]),
  ];
}

export function pdfRectCenterInside(
  rect: PdfRectTuple,
  target: PdfRectTuple,
): boolean {
  const x = (rect[0] + rect[2]) / 2;
  const y = (rect[1] + rect[3]) / 2;
  return (
    x >= Math.min(target[0], target[2]) &&
    x <= Math.max(target[0], target[2]) &&
    y >= Math.min(target[1], target[3]) &&
    y <= Math.max(target[1], target[3])
  );
}

export function selectionSortIndex(
  pageIndex: number,
  offset: number,
  rects: PdfRectTuple[],
  viewBox: unknown,
): string {
  const topRect = rects[0] ?? [0, 0, 0, 0];
  const box = pdfRects([viewBox])[0];
  const pageHeight = box ? box[3] - box[1] : 0;
  const top = pageHeight > 0 ? Math.max(0, pageHeight - topRect[3]) : 0;
  return [
    String(Math.max(0, pageIndex)).padStart(5, "0"),
    String(Math.max(0, offset)).padStart(6, "0"),
    String(Math.max(0, Math.floor(top))).padStart(5, "0"),
  ].join("|");
}

export function clonePlainForScope<T>(value: T, targetScope?: unknown): T {
  const plain = JSON.parse(JSON.stringify(value)) as T;
  try {
    const cloneInto = (globalThis as any).Components?.utils?.cloneInto;
    if (targetScope && typeof cloneInto === "function") {
      return cloneInto(plain, targetScope, {
        wrapReflectors: true,
        cloneFunctions: true,
      }) as T;
    }
  } catch {
    // Fall through to the plain object clone.
  }
  return plain;
}
