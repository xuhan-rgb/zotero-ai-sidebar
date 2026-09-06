import type { ModelPreset } from "../settings/types";
import type { DetectedSentence } from "./sentence-detect";
import { closestElement } from "../modules/dom-utils";

export interface ReaderLike {
  _internalReader?: {
    _primaryView?: { _iframeWindow?: Window };
    _secondaryView?: { _iframeWindow?: Window };
    _iframeWindow?: Window;
  };
  _iframeWindow?: Window;
}

export function keyEventWindows(win: Window): Window[] {
  const out: Window[] = [];
  let current: Window | null = win;
  for (let i = 0; i < 4 && current; i++) {
    if (!out.includes(current)) out.push(current);
    let parent: Window | null = null;
    try {
      parent = current.parent;
      if (!parent || parent === current) break;
      // Accessing document verifies we can install a listener in that realm.
      void parent.document;
    } catch {
      break;
    }
    current = parent;
  }
  return out;
}

export function readerWindow(reader: ReaderLike): Window | null {
  const r = reader as ReaderLike;
  return (
    r._internalReader?._primaryView?._iframeWindow ??
    r._internalReader?._secondaryView?._iframeWindow ??
    r._internalReader?._iframeWindow ??
    r._iframeWindow ??
    null
  );
}

export function eventHitsPage(
  win: Window,
  clientX: number,
  clientY: number,
  target: Node | null,
): boolean {
  if (closestElement(target, ".page,[data-page-number]")) return true;

  // Zotero Reader resolves pointer hits with elementsFromPoint(), because the
  // event target can be a child overlay while the PDF page is underneath.
  const elements =
    typeof win.document.elementsFromPoint === "function"
      ? Array.from(win.document.elementsFromPoint(clientX, clientY))
      : [];
  return elements.some((el) => closestElement(el, ".page,[data-page-number]"));
}

export function distance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pickPreset(
  presets: ModelPreset[],
  desiredId: string,
): ModelPreset | null {
  if (!presets.length) return null;
  return presets.find((p) => p.id === desiredId) ?? presets[0]!;
}

export function contextText(
  current: DetectedSentence,
  level: string,
): string | undefined {
  if (level === "paragraph") return current.paragraphContext;
  if (level === "page") return current.bundle.pageText;
  return undefined;
}
