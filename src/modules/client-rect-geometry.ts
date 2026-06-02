// DOM client-rect geometry + visual text reconstruction from a PDF reader text
// selection. Pure helpers over DOMRect / Selection / text nodes — no Zotero
// runtime, no shared sidebar state, no calls back into sidebar.ts.

export interface VisualCharFragment {
  char: string;
  rect: DOMRect;
  key: string;
}

export function selectionClientRects(selection: Selection): DOMRect[] {
  const rects: DOMRect[] = [];
  for (let index = 0; index < selection.rangeCount; index++) {
    const range = selection.getRangeAt(index);
    rects.push(
      ...clientRectArray(range.getClientRects()).filter(isUsefulClientRect),
    );
  }
  return rects;
}

export function isUsableVisualSelectionText(
  visualText: string,
  rawText: string,
): boolean {
  if (!visualText) return false;
  if (!rawText) return visualText.length >= 2;
  if (visualText === rawText) return true;
  return visualText.length >= Math.max(12, rawText.length * 0.25);
}

export function extractVisualTextFromClientRects(
  doc: Document,
  selectionRects: DOMRect[],
): string {
  if (!selectionRects.length) return "";
  const bounds = unionClientRects(selectionRects);
  const fragments = visualCharFragments(doc, selectionRects, bounds);
  return textFromVisualFragments(fragments);
}

export function visualCharFragments(
  doc: Document,
  selectionRects: DOMRect[],
  bounds: DOMRect,
): VisualCharFragment[] {
  const fragments: VisualCharFragment[] = [];
  const seen = new Set<string>();
  const range = doc.createRange();
  const nodes = collectSelectionTextNodes(doc, bounds);
  nodes.forEach((node, nodeIndex) => {
    const text = node.nodeValue ?? "";
    for (const segment of textCodeUnitSegments(text)) {
      const char = text.slice(segment.start, segment.end);
      if (!char.trim()) continue;
      try {
        range.setStart(node, segment.start);
        range.setEnd(node, segment.end);
      } catch {
        continue;
      }
      const rect = bestOverlappingClientRect(
        clientRectArray(range.getClientRects()).filter(isUsefulClientRect),
        selectionRects,
      );
      if (!rect) continue;
      const key = `${nodeIndex}:${segment.start}:${segment.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fragments.push({ char, rect, key });
    }
  });
  range.detach?.();
  return fragments;
}

export function collectSelectionTextNodes(
  doc: Document,
  bounds: DOMRect,
): Text[] {
  const roots = (
    Array.from(doc.querySelectorAll(".textLayer")) as Element[]
  ).filter((root) => clientRectListOverlaps(root.getClientRects(), bounds));
  const searchRoots: Node[] = roots.length ? roots : doc.body ? [doc.body] : [];
  const nodes: Text[] = [];
  const showText = doc.defaultView?.NodeFilter?.SHOW_TEXT ?? 4;
  for (const root of searchRoots) {
    const walker = doc.createTreeWalker(root, showText);
    let current = walker.nextNode();
    while (current) {
      if (current.nodeType === 3) {
        const text = current as Text;
        if (
          text.nodeValue?.trim() &&
          text.parentElement &&
          clientRectListOverlaps(text.parentElement.getClientRects(), bounds)
        ) {
          nodes.push(text);
        }
      }
      current = walker.nextNode();
    }
  }
  return nodes;
}

export function textFromVisualFragments(fragments: VisualCharFragment[]): string {
  if (!fragments.length) return "";
  const rows: Array<{
    y: number;
    height: number;
    chars: VisualCharFragment[];
  }> = [];
  const sorted = fragments
    .slice()
    .sort(
      (a, b) =>
        clientRectMidY(a.rect) - clientRectMidY(b.rect) ||
        a.rect.left - b.rect.left,
    );

  for (const fragment of sorted) {
    const y = clientRectMidY(fragment.rect);
    const height = Math.max(fragment.rect.height, 1);
    const row = rows.find(
      (candidate) =>
        Math.abs(candidate.y - y) <= Math.max(2, Math.min(8, height * 0.6)),
    );
    if (row) {
      row.chars.push(fragment);
      row.height = Math.max(row.height, height);
      row.y = (row.y + y) / 2;
    } else {
      rows.push({ y, height, chars: [fragment] });
    }
  }

  return rows
    .sort((a, b) => a.y - b.y)
    .map((row) => visualRowText(row.chars, row.height))
    .filter(Boolean)
    .join(" ");
}

export function visualRowText(
  chars: VisualCharFragment[],
  rowHeight: number,
): string {
  const sorted = chars
    .slice()
    .sort((a, b) => a.rect.left - b.rect.left || a.key.localeCompare(b.key));
  let output = "";
  let previous: VisualCharFragment | null = null;
  for (const fragment of sorted) {
    if (previous) {
      const gap = fragment.rect.left - previous.rect.right;
      if (
        gap > Math.max(2, rowHeight * 0.22) &&
        shouldInsertVisualSpace(previous.char, fragment.char)
      ) {
        output += " ";
      }
    }
    output += fragment.char;
    previous = fragment;
  }
  return output.trim();
}

export function shouldInsertVisualSpace(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (/[,.;:!?，。；：！？)]/.test(right)) return false;
  if (/[(（]$/.test(left)) return false;
  return (
    /[A-Za-z0-9一-鿿)\]]/.test(left) &&
    /[A-Za-z0-9一-鿿([（]/.test(right)
  );
}

export function textCodeUnitSegments(
  text: string,
): Array<{ start: number; end: number }> {
  const segments: Array<{ start: number; end: number }> = [];
  let offset = 0;
  for (const char of Array.from(text)) {
    const end = offset + char.length;
    segments.push({ start: offset, end });
    offset = end;
  }
  return segments;
}

export function bestOverlappingClientRect(
  candidates: DOMRect[],
  selectionRects: DOMRect[],
): DOMRect | null {
  let best: { rect: DOMRect; area: number } | null = null;
  for (const rect of candidates) {
    for (const selectionRect of selectionRects) {
      const area = clientRectOverlapArea(rect, selectionRect, 1);
      if (area > 0.5 && (!best || area > best.area)) {
        best = { rect, area };
      }
    }
  }
  return best?.rect ?? null;
}

export function clientRectListOverlaps(
  rects: DOMRectList,
  bounds: DOMRect,
): boolean {
  return clientRectArray(rects).some(
    (rect) => isUsefulClientRect(rect) && clientRectsOverlap(rect, bounds),
  );
}

export function clientRectArray(rects: DOMRectList | null): DOMRect[] {
  return rects ? Array.from(rects) : [];
}

export function unionClientRects(rects: DOMRect[]): DOMRect {
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return DOMRect.fromRect({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  });
}

export function isUsefulClientRect(rect: DOMRect): boolean {
  return rect.width > 0.5 && rect.height > 0.5;
}

export function clientRectsOverlap(a: DOMRect, b: DOMRect): boolean {
  return clientRectOverlapArea(a, b) > 0;
}

export function clientRectOverlapArea(
  a: DOMRect,
  b: DOMRect,
  tolerance = 0,
): number {
  const left = Math.max(a.left, b.left - tolerance);
  const right = Math.min(a.right, b.right + tolerance);
  const top = Math.max(a.top, b.top - tolerance);
  const bottom = Math.min(a.bottom, b.bottom + tolerance);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

export function clientRectMidY(rect: DOMRect): number {
  return (rect.top + rect.bottom) / 2;
}
