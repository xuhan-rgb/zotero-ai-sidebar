import {
  findFloatingReaderSpace,
  type ReaderRect,
} from "./floating-reader-space";

const STYLE_ID = "zai-floating-pdf-align";
const SPACE_CLASS = "zai-floating-reader-space";
export type FloatingPdfAlignment = "left" | "right" | "native";

interface Avoidance {
  hostWindow: Window;
  answer: ReaderRect | null;
  composer: ReaderRect | null;
}

function alignmentCSS(alignment: FloatingPdfAlignment): string {
  if (alignment === "native") return "";
  return `
.pdfViewer:not(.scrollHorizontal):not(.scrollWrapped) {
  align-items: ${alignment === "left" ? "flex-start" : "safe flex-end"} !important;
}
.pdfViewer:not(.scrollHorizontal):not(.scrollWrapped) > .page,
.pdfViewer:not(.scrollHorizontal):not(.scrollWrapped) > .spread {
  margin-left: ${alignment === "left" ? "0" : "auto"} !important;
  margin-right: ${alignment === "left" ? "auto" : "0"} !important;
}`;
}

export function sameReaderWindow(
  a: Window | null | undefined,
  b: Window | null | undefined,
): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    if (a.document && a.document === b.document) return true;
    const first =
      (a as Window & { wrappedJSObject?: Window }).wrappedJSObject ?? a;
    const second =
      (b as Window & { wrappedJSObject?: Window }).wrappedJSObject ?? b;
    return (
      first === second ||
      (!!first.document && first.document === second.document)
    );
  } catch {
    return false;
  }
}

// PDF frames can sit inside a reader browser and another iframe. Work in host
// CSS pixels, including any frame transform, without moving nodes across docs.
function hostRect(
  view: Window,
  rect: ReaderRect,
  host: Window,
  related: Window[],
): ReaderRect | null {
  // DOMRect exposes its coordinates through prototype getters. Spreading it
  // drops those fields in Gecko (and produces NaN during frame conversion).
  const result: ReaderRect = {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
  if (
    !Object.values(result).every(Number.isFinite) ||
    result.width <= 0 ||
    result.height <= 0
  )
    return null;
  const visited: Window[] = [];
  while (!sameReaderWindow(view, host)) {
    if (visited.some((previous) => sameReaderWindow(previous, view)))
      return null;
    visited.push(view);
    let frame = view.frameElement as HTMLElement | null;
    // Some chrome browsing contexts don't expose frameElement to the child.
    if (!frame) {
      for (const parent of [host, ...related]) {
        if (sameReaderWindow(parent, view)) continue;
        frame =
          (Array.from(parent.document.querySelectorAll("iframe, browser")).find(
            (node) =>
              sameReaderWindow((node as HTMLIFrameElement).contentWindow, view),
          ) as HTMLElement | undefined) ?? null;
        if (frame) break;
      }
    }
    const parent = frame?.ownerDocument?.defaultView;
    if (!frame || !parent) return null;
    const bounds = frame.getBoundingClientRect();
    const scaleX =
      bounds.width /
      (frame.offsetWidth || frame.clientWidth || view.innerWidth || 1);
    const scaleY =
      bounds.height /
      (frame.offsetHeight || frame.clientHeight || view.innerHeight || 1);
    if (
      !Number.isFinite(scaleX) ||
      !Number.isFinite(scaleY) ||
      scaleX <= 0 ||
      scaleY <= 0
    )
      return null;
    result.left =
      bounds.left + ((frame.clientLeft ?? 0) + result.left) * scaleX;
    result.top = bounds.top + ((frame.clientTop ?? 0) + result.top) * scaleY;
    result.width *= scaleX;
    result.height *= scaleY;
    view = parent;
  }
  return Object.values(result).every(Number.isFinite) &&
    result.width > 0 &&
    result.height > 0
    ? result
    : null;
}

export { hostRect as readerRectInHost };

/** Use the stable outer reader region, before avoidance padding is applied. */
export function floatingReaderBounds(
  host: Window,
  windows: Window[],
): ReaderRect | null {
  for (const view of windows) {
    const split = view.document.querySelector("#split-view, .split-view");
    if (!split) continue;
    const bounds = hostRect(view, split.getBoundingClientRect(), host, windows);
    if (bounds) return bounds;
  }
  return null;
}

export function createFloatingPdfAlignment() {
  const styles = new Map<
    Document,
    { style: Element; alignment: FloatingPdfAlignment }
  >();
  const spaces = new Map<
    HTMLElement,
    { style: Element; css: string; peers: HTMLElement[] }
  >();
  const removeSpace = (
    node: HTMLElement,
    entry: { style: Element; peers: HTMLElement[] },
  ) => {
    for (const peer of entry.peers) peer.classList.remove(SPACE_CLASS);
    entry.style.remove();
    spaces.delete(node);
  };
  return {
    sync(
      windows: Window[],
      alignment: FloatingPdfAlignment = "left",
      avoidance?: Avoidance,
    ): boolean {
      const active = new Set(windows.map((win) => win.document));
      for (const [doc, entry] of styles) {
        if (!active.has(doc) || alignment === "native") {
          entry.style.remove();
          styles.delete(doc);
        }
      }
      const activeSpaces = new Set<HTMLElement>();
      let blocked = false;
      for (const view of windows) {
        const doc = view.document;
        if (doc.querySelector(".pdfViewer") && alignment !== "native") {
          const existing = styles.get(doc);
          if (existing?.style.isConnected) {
            if (existing.alignment !== alignment) {
              existing.style.textContent = alignmentCSS(alignment);
              existing.alignment = alignment;
            }
          } else {
            const style = doc.createElementNS(
              "http://www.w3.org/1999/xhtml",
              "style",
            );
            style.id = STYLE_ID;
            style.textContent = alignmentCSS(alignment);
            (doc.head ?? doc.documentElement)?.append(style);
            styles.set(doc, { style, alignment });
          }
        }
        const peers = Array.from(
          doc.querySelectorAll("#split-view, .split-view"),
        ) as HTMLElement[];
        const split =
          peers.find((node) => node.id === "split-view") ?? peers[0];
        if (!split || !avoidance || (!avoidance.answer && !avoidance.composer))
          continue;
        const local = split.getBoundingClientRect();
        const bounds = hostRect(view, local, avoidance.hostWindow, windows);
        if (!bounds || bounds.width <= 0 || bounds.height <= 0) continue;
        const free = findFloatingReaderSpace(
          bounds,
          avoidance.answer,
          avoidance.composer,
          alignment === "right" ? "right" : "left",
        );
        const scaleX = bounds.width / local.width,
          scaleY = bounds.height / local.height;
        let css: string;
        if (free) {
          const top = Math.max(0, (free.top - bounds.top) / scaleY);
          const left = Math.max(0, (free.left - bounds.left) / scaleX);
          const right = Math.max(
            0,
            (bounds.left + bounds.width - free.left - free.width) / scaleX,
          );
          const bottom = Math.max(
            0,
            (bounds.top + bounds.height - free.top - free.height) / scaleY,
          );
          // Padding leaves the outer reading bounds unchanged, while resizing
          // and repositioning its child views. PDF.js keeps its local origin
          // and receives a real iframe resize (including native fit-to-width).
          css = `.${SPACE_CLASS} { box-sizing: border-box !important; padding: ${top}px ${right}px ${bottom}px ${left}px !important; }`;
        } else {
          // An impossible layout must not blank the document. Let cleanup
          // below restore the native viewport and keep the PDF available.
          blocked = true;
          continue;
        }
        activeSpaces.add(split);
        // Zotero keeps physical PDF frames and React popup overlays in two
        // sibling split-view containers. They must share the same free area.
        for (const peer of peers) peer.classList.add(SPACE_CLASS);
        const existing = spaces.get(split);
        if (existing) {
          for (const old of existing.peers)
            if (!peers.includes(old)) old.classList.remove(SPACE_CLASS);
          existing.peers = peers;
        }
        if (existing?.style.isConnected) {
          if (existing.css !== css) {
            existing.style.textContent = css;
            existing.css = css;
          }
        } else {
          const style = doc.createElementNS(
            "http://www.w3.org/1999/xhtml",
            "style",
          );
          style.textContent = css;
          (doc.head ?? doc.documentElement)?.append(style);
          spaces.set(split, { style, css, peers });
        }
      }
      for (const [node, entry] of spaces) {
        if (!activeSpaces.has(node)) removeSpace(node, entry);
      }
      return blocked;
    },
    destroy(): void {
      for (const { style } of styles.values()) style.remove();
      styles.clear();
      for (const [node, entry] of spaces) removeSpace(node, entry);
    },
  };
}
