// pdf-navigation: navigate the Zotero reader to a PDF selection/location/section
// (outline jump, synthesized dest, text-needle fallback), reader scroll +
// transient-state cleanup, and the reading-route highlight overlay. Layer 2 of
// the reader subsystem: depends on reader-access + pdf-geometry + leaf utils;
// the chat-bound jumpToPdfSelection (re-syncs selection UI) stays in sidebar.ts.

import { loadArxivSectionsForArxivId } from "../context/arxiv-tools";
import { resolveArxivIdForItemID } from "../context/arxiv-id";
import type { OverviewSection } from "../context/overview-types";
import {
  createPdfLocator,
  getReaderPdfApp,
  getSharedPdfLocator,
  type LocateResult,
  type PdfRect,
} from "../context/pdf-locator";
import type { PdfSelectionLocator } from "../providers/types";
import { mountSelectionPopupGuard } from "../translate/overlay";
import {
  normalizeLatexListEnvironments,
  normalizeLatexSourceCommands,
} from "../context/tex-clean";
import { findSection, type TexSection } from "../context/tex-sections";
import { debugZai, errorMessage, textDebugInfo } from "./debug-utils";
import {
  charOffsetsForPdfRects,
  charOffsetsForReaderText,
  clonePlainForScope,
  pdfRects,
  rectsFromReaderChars,
  selectionSortIndex,
  type PdfRectTuple,
} from "./pdf-geometry";
import { clonePlainRecord, finiteNumber } from "./plain-utils";
import {
  activeReaderConversationItemID,
  activeReaderViews,
  getActiveReader,
  getActiveReaderSelection,
  getReaderForAttachmentOrItem,
  normalizeSelectedText,
  readerAttachmentID,
  readerItemIDs,
} from "./reader-access";
import {
  locateReadingRouteReference,
  type ReadingRouteReferenceKind,
} from "./reading-route-reference";
import {
  activeRouteHighlights,
  ignoredSelectedTextByItem,
  selectedAnnotationByItem,
  selectedTextByItem,
  type PanelState,
} from "./sidebar-state";

export async function jumpToPdfSelectionPreview(
  mount: HTMLElement,
  state: PanelState,
  locator: PdfSelectionLocator,
) {
  const win = mount.ownerDocument?.defaultView;
  const activeReader = getActiveReader(win);
  const activeConversationID = win ? activeReaderConversationItemID(win) : null;
  const reader =
    readerAttachmentID(activeReader) === locator.attachmentID
      ? activeReader
      : getReaderForAttachmentOrItem(win, state.itemID, locator.attachmentID);
  if (!reader || typeof reader.navigate !== "function") {
    debugZai("task.pdf-selection-preview.jump.unavailable", {
      attachmentID: locator.attachmentID,
      itemID: state.itemID,
      activeAttachmentID: readerAttachmentID(activeReader),
      activeConversationID,
    });
    return;
  }
  try {
    const selectionLocator = await enrichPdfSelectionLocatorWithReaderOffsets(
      reader,
      locator,
    );
    setTempLoadMarkStatus(mount, "选区中");
    suppressReaderSelectionTextForPrompt(reader, selectionLocator.selectedText);
    const restored = await navigateReaderToPdfSelectionPreview(
      win,
      reader,
      selectionLocator,
    );
    suppressReaderSelectionTextForPrompt(reader, selectionLocator.selectedText);
    setTempLoadMarkStatus(mount, restored ? "选区OK" : "选区失败");
    debugZai("task.pdf-selection-preview.jump", {
      attachmentID: selectionLocator.attachmentID,
      pageIndex: selectionLocator.pageIndex,
      restoredSelection: !!restored,
      hasOffsets: locatorHasSelectionOffsets(selectionLocator),
      domText: textDebugInfo(getActiveReaderSelection(reader), 120),
      text: textDebugInfo(selectionLocator.selectedText, 120),
    });
  } catch (err) {
    setTempLoadMarkStatus(mount, "选区异常");
    debugZai("task.pdf-selection-preview.jump.failed", {
      error: errorMessage(err),
      attachmentID: locator.attachmentID,
    });
  }
}

export function setTempLoadMarkStatus(mount: HTMLElement, text: string): void {
  const button = mount.querySelector(
    ".zai-temp-load-mark",
  ) as HTMLElement | null;
  if (!button) return;
  button.textContent = text;
  button.title = `临时调试状态：${text}`;
}

export async function enrichPdfSelectionLocatorWithReaderOffsets(
  reader: unknown,
  locator: PdfSelectionLocator,
): Promise<PdfSelectionLocator> {
  if (locatorHasSelectionOffsets(locator)) return locator;
  let pdfLocator: Awaited<ReturnType<typeof createPdfLocator>> | null = null;
  try {
    pdfLocator = await createPdfLocator(reader);
    const result = await pdfLocator.locate(locator.selectedText, {
      minConfidence: 0.85,
      pageIndex: locator.pageIndex,
    });
    if (!result || result.anchorOffset == null || result.headOffset == null) {
      return locator;
    }
    return {
      ...locator,
      selectedText: result.matchedText || locator.selectedText,
      pageIndex: result.pageIndex,
      pageLabel: result.pageLabel,
      position: {
        ...locator.position,
        pageIndex: result.pageIndex,
        rects: result.rects,
        zaiAnchorOffset: result.anchorOffset,
        zaiHeadOffset: result.headOffset,
      },
    };
  } catch (err) {
    debugZai("task.pdf-selection-preview.enrich-offsets.failed", {
      error: errorMessage(err),
      attachmentID: locator.attachmentID,
      pageIndex: locator.pageIndex,
    });
    return locator;
  } finally {
    pdfLocator?.dispose();
  }
}

export function locatorHasSelectionOffsets(locator: PdfSelectionLocator): boolean {
  const anchorOffset = finiteNumber(locator.position?.zaiAnchorOffset);
  const headOffset = finiteNumber(locator.position?.zaiHeadOffset);
  return (
    anchorOffset != null &&
    headOffset != null &&
    Number.isInteger(anchorOffset) &&
    Number.isInteger(headOffset) &&
    headOffset > anchorOffset
  );
}

export async function jumpToPdfLocationOnly(
  mount: HTMLElement,
  state: PanelState,
  locator: PdfSelectionLocator,
  referenceKind?: ReadingRouteReferenceKind,
  opts?: { emphatic?: boolean },
) {
  const win = mount.ownerDocument?.defaultView;
  const activeReader = getActiveReader(win);
  const activeConversationID = win ? activeReaderConversationItemID(win) : null;
  const reader =
    readerAttachmentID(activeReader) === locator.attachmentID
      ? activeReader
      : getReaderForAttachmentOrItem(win, state.itemID, locator.attachmentID);
  if (!reader || typeof reader.navigate !== "function") {
    debugZai("task.pdf-location.jump.unavailable", {
      attachmentID: locator.attachmentID,
      itemID: state.itemID,
      activeAttachmentID: readerAttachmentID(activeReader),
      activeConversationID,
    });
    return;
  }
  const popupGuard = mountReaderSelectionPopupGuard(reader);
  try {
    const navigated = await navigateReaderToPdfLocationOnly(
      win,
      reader,
      locator,
      referenceKind,
    );
    if (!navigated) {
      await reader.navigate({ position: locator.position });
      await clearReaderTransientPdfStateAfterNavigate(win, reader, {
        clearHighlight: false,
        clearSelection: false,
      });
    }
    for (const view of activeReaderViews(reader as any)) {
      if (view?._iframeWindow) {
        mountRouteHighlightOverlay(mount, view, locator, opts);
        break;
      }
    }
    debugZai("task.pdf-location.jump", {
      attachmentID: locator.attachmentID,
      pageIndex: locator.pageIndex,
      text: textDebugInfo(locator.selectedText, 120),
      referenceKind,
      directViewNavigation: navigated,
    });
  } catch (err) {
    debugZai("task.pdf-location.jump.failed", {
      error: errorMessage(err),
      attachmentID: locator.attachmentID,
    });
  } finally {
    destroyGuardAfterDelay(win, popupGuard, 2000);
  }
}

export async function jumpToReadingRouteReference(
  mount: HTMLElement,
  state: PanelState,
  label: string,
  sourceItemID: number | null,
  referenceKind?: ReadingRouteReferenceKind,
): Promise<void> {
  const win = mount.ownerDocument?.defaultView;
  const reader = getReaderForAttachmentOrItem(win, sourceItemID, null);
  if (!reader) {
    setTempLoadMarkStatus(mount, "图表未打开");
    return;
  }

  setTempLoadMarkStatus(mount, "图表定位中");
  let pdfLocator: Awaited<ReturnType<typeof createPdfLocator>> | null = null;
  try {
    pdfLocator = await createPdfLocator(reader);
    const result = await locateReadingRouteReference(pdfLocator, label);
    if (!result) {
      setTempLoadMarkStatus(mount, "图表未定位");
      return;
    }
    const locator = pdfSelectionLocatorFromLocateResult(
      pdfLocator.attachmentID,
      result.matchedText || label,
      result,
    );
    setTempLoadMarkStatus(mount, "图表定位");
    await jumpToPdfLocationOnly(mount, state, locator, referenceKind);
  } catch (err) {
    setTempLoadMarkStatus(mount, "图表异常");
    debugZai("reading-route.reference.jump.failed", {
      error: errorMessage(err),
      label,
      sourceItemID,
    });
  } finally {
    pdfLocator?.dispose();
  }
}

// Normalize a heading for matching: lowercase, collapse whitespace, drop
// punctuation/section numbers so "4 The π0.5 Model" ~ "The π0.5 Model".

export function normalizeHeading(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s ]+/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, "")
    .replace(/^\d+(\.\d+)*\s+/, "")
    .trim();
}

// Jump to a section via the PDF's embedded outline (TOC bookmarks) using the
// reader's NATIVE destination navigation (pdfLinkService.goToDestination) — the
// exact same path as clicking the PDF's own outline: it scrolls the section
// heading to the TOP and adds no transient highlight. Returns true if it
// navigated, false when there's no outline / no title match / no link service
// (caller then falls back to text search). Best-effort: never throws.

export async function jumpViaPdfOutline(
  reader: unknown,
  section: OverviewSection,
): Promise<boolean> {
  const app = getReaderPdfApp(reader);
  const linkService = app?.pdfLinkService;
  if (!app?.pdfDocument || !linkService) return false;
  try {
    const outline = await app.pdfDocument.getOutline();
    if (!Array.isArray(outline) || !outline.length) return false;

    const flat: Array<{ title: string; dest: unknown }> = [];
    const walk = (items: unknown[]): void => {
      for (const raw of items) {
        const it = raw as { title?: unknown; dest?: unknown; items?: unknown };
        if (typeof it?.title === "string") {
          flat.push({ title: it.title, dest: it.dest });
        }
        if (Array.isArray(it?.items) && it.items.length) walk(it.items);
      }
    };
    walk(outline);

    // Match by word-overlap (not exact/startsWith): outline titles differ from
    // the overview's in punctuation, case, ALL-CAPS, and how π / 0.5 render, so
    // a tolerant token score finds far more sections than a strict compare.
    const tokenize = (s: string): string[] =>
      normalizeHeading(s)
        .split(" ")
        .filter((w) => w.length > 0);
    const targetTokens = tokenize(section.title);
    if (!targetTokens.length) return false;
    const targetSet = new Set(targetTokens);
    let entry: { title: string; dest: unknown } | null = null;
    let bestScore = 0;
    for (const e of flat) {
      const et = tokenize(e.title);
      if (!et.length) continue;
      const inter = et.filter((w) => targetSet.has(w)).length;
      const score = inter / Math.max(targetTokens.length, et.length);
      if (score > bestScore) {
        bestScore = score;
        entry = e;
      }
    }
    if (!entry || !entry.dest || bestScore < 0.6) return false;

    // Native, top-aligned navigation — same as clicking the PDF's own outline.
    // Fire-and-forget: goToDestination returns a Promise from the PDF iframe's
    // (content) scope; AWAITING it from the plugin (chrome) scope throws an Xray
    // "Permission denied to access property 'then'". The navigation still runs.
    if (typeof linkService.goToDestination === "function") {
      linkService.goToDestination(entry.dest);
      return true;
    }
    if (typeof linkService.navigateTo === "function") {
      linkService.navigateTo(entry.dest);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Top-align a text-located section the SAME way the outline does: synthesize a
// PDF destination from the matched page's ref + the rect's top, and fire the
// reader's native goToDestination (proven to scroll-to-top with no highlight).
// For sections NOT in the embedded outline (e.g. Acknowledgements). Returns
// false if the page ref / link service isn't available → caller uses the
// (centered) reader.navigate fallback. Best-effort: never throws.

export async function jumpToPageTopViaDest(
  reader: unknown,
  pageIndex: number,
  rect: PdfRect | undefined,
): Promise<boolean> {
  const app = getReaderPdfApp(reader);
  const linkService = app?.pdfLinkService;
  if (!app?.pdfDocument || !linkService || !rect) return false;
  try {
    const page = await app.pdfDocument.getPage(pageIndex + 1);
    // This reader's PDF.js doesn't expose page.ref directly; the page reference
    // lives in the internal _pageInfo. Try both.
    const ref = page?.ref ?? page?._pageInfo?.ref;
    if (!ref) return false;
    const [x0, , , y1] = rect;
    const dest = [ref, { name: "XYZ" }, x0, y1, null];
    // goToDestination's async work runs in the PDF iframe's (content) scope and
    // can't read objects we built here (chrome) — it silently no-ops. Re-create
    // the dest IN the content scope by JSON round-tripping through the iframe
    // window (a string crosses compartments fine), so it's content-readable.
    const win = (
      app?.pdfViewer?.container as
        | { ownerDocument?: { defaultView?: { JSON?: typeof JSON } } }
        | undefined
    )?.ownerDocument?.defaultView;
    const navDest = win?.JSON ? win.JSON.parse(JSON.stringify(dest)) : dest;
    // Fire-and-forget (no await): awaiting the content-scope Promise from the
    // plugin scope throws an Xray "Permission denied to access 'then'".
    if (typeof linkService.goToDestination === "function") {
      linkService.goToDestination(navDest);
      return true;
    }
    if (typeof linkService.navigateTo === "function") {
      linkService.navigateTo(navDest);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Jump the Reader to a section. Prefer the PDF's embedded outline (exact); fall
// back to locating its heading/first-sentence text in the extracted text layer.

export async function jumpToOverviewSection(
  mount: HTMLElement,
  state: PanelState,
  section: OverviewSection,
): Promise<void> {
  const win = mount.ownerDocument?.defaultView;
  const reader = getReaderForAttachmentOrItem(win, state.itemID, null);
  if (!reader) {
    setTempLoadMarkStatus(mount, "PDF 未打开");
    return;
  }
  setTempLoadMarkStatus(mount, "定位中");
  try {
    // Locate the heading's rects up front. The emphatic highlight needs pixel
    // rects to paint, and neither the section's charStart nor the embedded PDF
    // outline yields them — only a text-needle locate does. Shared (cached)
    // locator: extraction happens once per Reader, repeats are fast.
    const pdfLocator = await getSharedPdfLocator(reader);
    let result: LocateResult | null = null;
    for (const needle of await sectionLocateNeedles(state.itemID, section)) {
      const hit = await pdfLocator.locate(needle, { minConfidence: 0.5 });
      if (hit) {
        result = hit;
        break;
      }
    }
    const locator = result
      ? pdfSelectionLocatorFromLocateResult(
          pdfLocator.attachmentID,
          result.matchedText || section.title,
          result,
        )
      : null;
    // Scroll: prefer the PDF's own embedded outline (TOC bookmarks) — native
    // dest navigation, precise top-align, no mis-hit; then a synthesized top
    // dest from the located rect; then the centered reader.navigate fallback.
    // The emphatic, pointer-dismissed highlight is mounted on every path from
    // the located rects (the outline path used to scroll with no highlight).
    if (await jumpViaPdfOutline(reader, section)) {
      if (locator) {
        mountRouteHighlightOnReader(mount, reader, locator, { emphatic: true });
      }
      setTempLoadMarkStatus(mount, "已定位");
      return;
    }
    if (!result || !locator) {
      setTempLoadMarkStatus(mount, "未定位到该节");
      return;
    }
    setTempLoadMarkStatus(mount, "已定位");
    if (
      await jumpToPageTopViaDest(reader, result.pageIndex, result.rects?.[0])
    ) {
      mountRouteHighlightOnReader(mount, reader, locator, { emphatic: true });
    } else {
      await jumpToPdfLocationOnly(mount, state, locator, undefined, {
        emphatic: true,
      });
    }
  } catch (err) {
    setTempLoadMarkStatus(mount, "定位失败");
    debugZai("overview.section.jump.failed", {
      error: errorMessage(err),
      title: section.title,
    });
  }
}

// Build locate needles, most accurate first. For arXiv items we have the
// LaTeX source, so the section's first body sentence (long & near-unique)
// pinpoints the section far better than a short heading title. Title-based
// candidates remain as fallbacks for non-arXiv PDFs or when the body match
// fails.
// Cache parsed LaTeX sections per arXiv id so repeated section clicks don't
// re-read and re-parse the source each time.
const overviewSectionCache = new Map<string, Promise<TexSection[] | null>>();

export function cachedArxivSections(
  arxivId: string,
): Promise<TexSection[] | null> {
  let pending = overviewSectionCache.get(arxivId);
  if (!pending) {
    pending = loadArxivSectionsForArxivId(arxivId);
    overviewSectionCache.set(arxivId, pending);
  }
  return pending;
}

export async function sectionLocateNeedles(
  itemID: number | null,
  section: OverviewSection,
): Promise<string[]> {
  const needles: string[] = [];
  const arxivId = resolveArxivIdForItemID(itemID);
  if (arxivId) {
    try {
      const sections = await cachedArxivSections(arxivId);
      if (sections) {
        const sec =
          findSection(sections, section.no) ??
          findSection(sections, section.title);
        const hint = sec ? firstProseSentence(sec.body) : "";
        if (hint) needles.push(hint);
      }
    } catch {
      // Fall through to title-based candidates.
    }
  }
  const title = section.title.trim();
  const no = section.no?.trim() ?? "";
  if (/^[\d.]+$/.test(no)) needles.push(`${no} ${title}`, `${no}. ${title}`);
  needles.push(title);
  return needles.filter((s) => s.trim().length >= 3);
}

// First distinctive prose sentence of a LaTeX section body, cleaned of markup
// that won't appear in the PDF text layer (comments, math, \commands, braces).

export function firstProseSentence(body: string): string {
  // Drop float environments (figure/table/…) and epigraph quotes FIRST: their
  // caption/quote text is NOT the section's prose, so grabbing it makes the
  // needle land on the wrong place (a figure caption, or a famous epigraph).
  const deflowed = body
    .replace(
      /\\begin\s*\{(figure|table|wrapfigure|algorithm|algorithmic|tabular|subfigure)\*?\}[\s\S]*?\\end\s*\{\1\*?\}/g,
      " ",
    )
    .replace(/\\epigraph\s*\{[^{}]*\}\s*\{[^{}]*\}/g, " ");
  const cleaned = normalizeLatexSourceCommands(
    normalizeLatexListEnvironments(deflowed),
  )
    .replace(/%.*$/gm, " ")
    .replace(/\$[^$]*\$/g, " ")
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{[^{}]*\})?/g, " ")
    .replace(/[{}]/g, " ")
    // Markdown-ish emphasis/code markers (**bold**, _em_, `code`) never appear
    // in the PDF text layer — strip them so the needle matches.
    .replace(/[*_`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 12) return "";
  // Want a DISTINCTIVE anchor: a too-short leading fragment (e.g. a bold run-in
  // label like "Data collection and operations.") collides with similarly-worded
  // text elsewhere — notably reference entries — and mis-locates. So accumulate
  // sentences until the slice is long enough to be near-unique.
  const MIN = 40;
  const WINDOW = 160;
  const window = cleaned.slice(0, WINDOW);
  const boundary = /[.。]\s/g;
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(window)) !== null) {
    if (m.index + 1 >= MIN) return window.slice(0, m.index + 1).trim();
  }
  const lastSpace = window.lastIndexOf(" ");
  return (lastSpace > MIN ? window.slice(0, lastSpace) : window).trim();
}

export function mountReaderSelectionPopupGuard(reader: unknown): { destroy(): void } {
  const guards: Array<{ destroy(): void }> = [];
  for (const view of activeReaderViews(reader as any)) {
    const doc = view?._iframeWindow?.document as Document | undefined;
    if (!doc) continue;
    try {
      guards.push(mountSelectionPopupGuard(doc));
    } catch (err) {
      debugZai("task.pdf-location.popup-guard.failed", {
        error: errorMessage(err),
      });
    }
  }
  return {
    destroy() {
      for (const guard of guards) {
        try {
          guard.destroy();
        } catch {
          /* best effort */
        }
      }
    },
  };
}

export function destroyGuardAfterDelay(
  win: Window | null | undefined,
  guard: { destroy(): void },
  delayMs: number,
) {
  void sleepInWindow(win, delayMs).then(() => guard.destroy());
}

export function destroyActiveRouteHighlight(mount: HTMLElement): void {
  activeRouteHighlights.get(mount)?.destroy();
  activeRouteHighlights.delete(mount);
}

export function ensureRouteHighlightStyle(doc: Document): void {
  const STYLE_ID = "zai-route-highlight-style";
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.zai-route-highlight {
  position: absolute;
  background: rgba(100, 160, 240, 0.35);
  border-radius: 2px;
  pointer-events: none;
  mix-blend-mode: multiply;
  z-index: 5;
}
.zai-route-highlight--emphatic {
  background: rgba(255, 190, 60, 0.42);
  border: 1.5px solid rgba(230, 145, 20, 0.95);
  border-radius: 3px;
  animation: zai-route-highlight-pulse 0.42s ease-in-out 3;
}
@keyframes zai-route-highlight-pulse {
  0% {
    background: rgba(255, 190, 60, 0.30);
    box-shadow: 0 0 0 0 rgba(230, 145, 20, 0);
  }
  50% {
    background: rgba(255, 170, 30, 0.65);
    box-shadow: 0 0 7px 3px rgba(230, 145, 20, 0.6);
  }
  100% {
    background: rgba(255, 190, 60, 0.42);
    box-shadow: 0 0 0 0 rgba(230, 145, 20, 0);
  }
}
`;
  (doc.head ?? doc.documentElement!).appendChild(style);
}

// Mount the route highlight on the reader's first active PDF view. Shared by the
// outline and top-dest jump paths, which scroll natively and must paint the cue
// themselves (jumpToPdfLocationOnly already mounts on its own centered path).
export function mountRouteHighlightOnReader(
  mount: HTMLElement,
  reader: unknown,
  locator: PdfSelectionLocator,
  opts?: { emphatic?: boolean },
): void {
  for (const view of activeReaderViews(reader as any)) {
    if (view?._iframeWindow) {
      mountRouteHighlightOverlay(mount, view, locator, opts);
      return;
    }
  }
}

export function mountRouteHighlightOverlay(
  mount: HTMLElement,
  view: any,
  locator: PdfSelectionLocator,
  opts?: { emphatic?: boolean },
): void {
  destroyActiveRouteHighlight(mount);
  const rects = pdfRects(locator.position?.rects);
  const pageIndex =
    finiteNumber(locator.position?.pageIndex) ?? locator.pageIndex;
  if (!rects.length || pageIndex == null) return;

  const iframeDoc = view?._iframeWindow?.document as Document | undefined;
  const pageEl = iframeDoc?.querySelector(
    `[data-page-number="${pageIndex + 1}"]`,
  ) as HTMLElement | null;
  const viewport =
    iframeDoc?.defaultView?.PDFViewerApplication?.pdfViewer?._pages?.[pageIndex]
      ?.viewport;
  if (!iframeDoc || !pageEl || !viewport) {
    debugZai("route-highlight.mount.skipped", {
      hasIframeDoc: !!iframeDoc,
      hasPageEl: !!pageEl,
      hasViewport: !!viewport,
      pageIndex,
    });
    return;
  }

  ensureRouteHighlightStyle(iframeDoc);

  const overlays: HTMLElement[] = [];
  for (const [x1, y1, x2, y2] of rects) {
    try {
      const [vx1, vy2] = viewport.convertToViewportPoint(x1, y1) as [
        number,
        number,
      ];
      const [vx2, vy1] = viewport.convertToViewportPoint(x2, y2) as [
        number,
        number,
      ];
      const div = iframeDoc.createElement("div");
      div.className = opts?.emphatic
        ? "zai-route-highlight zai-route-highlight--emphatic"
        : "zai-route-highlight";
      div.style.left = `${Math.min(vx1, vx2)}px`;
      div.style.top = `${Math.min(vy1, vy2)}px`;
      div.style.width = `${Math.max(1, Math.abs(vx2 - vx1))}px`;
      div.style.height = `${Math.max(1, Math.abs(vy2 - vy1))}px`;
      pageEl.appendChild(div);
      overlays.push(div);
    } catch {
      /* best effort */
    }
  }

  if (overlays.length) {
    // For the overview/section highlight (emphatic), clear it when the pointer
    // enters the PDF so the cue never sits on the text while the user reads.
    // Arm that listener only after a short settle delay: the navigation scroll
    // can fire a pointermove under a stationary cursor and would otherwise
    // self-clear the cue the instant it appears. Reading-route reference
    // highlights pass no opts and keep their persistent behavior.
    const win = mount.ownerDocument?.defaultView;
    let dismissOnPointer: ((ev: Event) => void) | null = null;
    let armTimer: number | null = null;
    if (opts?.emphatic && win) {
      armTimer = win.setTimeout(() => {
        armTimer = null;
        dismissOnPointer = () => destroyActiveRouteHighlight(mount);
        iframeDoc.addEventListener("pointermove", dismissOnPointer, {
          once: true,
          capture: true,
        });
      }, 300);
    }
    activeRouteHighlights.set(mount, {
      destroy() {
        if (armTimer != null) {
          try {
            win?.clearTimeout(armTimer);
          } catch {
            /* best effort */
          }
        }
        if (dismissOnPointer) {
          try {
            iframeDoc.removeEventListener(
              "pointermove",
              dismissOnPointer,
              true,
            );
          } catch {
            /* best effort */
          }
        }
        for (const div of overlays) {
          try {
            div.remove();
          } catch {
            /* best effort */
          }
        }
      },
    });
  }
}

export async function navigateReaderToPdfLocationOnly(
  win: Window | null | undefined,
  reader: unknown,
  locator: PdfSelectionLocator,
  referenceKind?: ReadingRouteReferenceKind,
): Promise<boolean> {
  for (const view of activeReaderViews(reader as any)) {
    if (!view || typeof view.navigateToPosition !== "function") continue;
    try {
      await view.initializedPromise;
      const position = pdfLocationScrollPosition(
        locator.position,
        view,
        referenceKind,
      );
      const scopedPosition = clonePlainForScope(position, view?._iframeWindow);
      clearReaderTransientPdfState(reader);
      view.navigateToPosition(scopedPosition, {
        block: "center",
        behavior: "instant",
      });
      suppressReaderSelectionTextForPrompt(reader, locator.selectedText);
      await restoreReaderTextSelectionQuietAfterNavigate(win, reader, locator);
      await clearReaderTransientPdfStateAfterNavigate(win, reader, {
        clearHighlight: false,
        clearSelection: false,
      });
      return true;
    } catch (err) {
      debugZai("task.pdf-location.direct-jump.failed", {
        error: errorMessage(err),
        attachmentID: locator.attachmentID,
        pageIndex: locator.pageIndex,
      });
    }
  }
  return false;
}

export async function navigateReaderToPdfSelectionPreview(
  win: Window | null | undefined,
  reader: unknown,
  locator: PdfSelectionLocator,
): Promise<boolean> {
  const popupGuard = mountReaderSelectionPopupGuard(reader);
  try {
    for (const view of activeReaderViews(reader as any)) {
      if (!view || typeof view.navigateToPosition !== "function") continue;
      try {
        await view.initializedPromise;
        const position =
          clonePlainRecord(locator.position) ??
          (locator.position as Record<string, unknown>);
        const scopedPosition = clonePlainForScope(
          position,
          view?._iframeWindow,
        );
        clearReaderTransientPdfState(reader);
        view.navigateToPosition(scopedPosition, {
          block: "center",
          behavior: "instant",
        });
        suppressReaderSelectionTextForPrompt(reader, locator.selectedText);
        const restored = await restoreReaderTextSelectionQuietAfterNavigate(
          win,
          reader,
          locator,
        );
        await clearReaderTransientPdfStateAfterNavigate(win, reader, {
          clearHighlight: false,
          clearSelection: false,
        });
        if (restored) centerReaderSelectionInView(view);
        if (restored) return true;
      } catch (err) {
        debugZai("task.pdf-selection-preview.direct-jump.failed", {
          error: errorMessage(err),
          attachmentID: locator.attachmentID,
          pageIndex: locator.pageIndex,
        });
      }
    }

    const navigable = reader as { navigate?: (args: unknown) => Promise<void> };
    if (typeof navigable.navigate !== "function") return false;
    await navigable.navigate({ position: locator.position });
    const restored = await restoreReaderTextSelectionQuietAfterNavigate(
      win,
      reader,
      locator,
    );
    await clearReaderTransientPdfStateAfterNavigate(win, reader, {
      clearHighlight: false,
      clearSelection: false,
    });
    if (restored) centerReaderSelectionInActiveViews(reader);
    return restored;
  } finally {
    destroyGuardAfterDelay(win, popupGuard, 1400);
  }
}

export async function restoreReaderTextSelectionQuietAfterNavigate(
  win: Window | null | undefined,
  reader: unknown,
  locator: PdfSelectionLocator,
): Promise<boolean> {
  for (const delayMs of [0, 80, 240, 600, 1000, 1600]) {
    if (delayMs > 0) await sleepInWindow(win, delayMs);
    if (restoreReaderTextSelectionQuiet(reader, locator)) return true;
  }
  return false;
}

export function restoreReaderTextSelectionQuiet(
  reader: unknown,
  locator: PdfSelectionLocator,
): boolean {
  for (const view of activeReaderViews(reader as any)) {
    const ranges = selectionRangesFromLocator(view, locator);
    if (!ranges.length || typeof view?._setSelectionRanges !== "function") {
      continue;
    }
    try {
      const scopedRanges = clonePlainForScope(ranges, view?._iframeWindow);
      focusReaderViewForSelection(view);
      view._setSelectionRanges(scopedRanges);
      // Keep the visible selection but close Zotero's native selection popup.
      view._onSetSelectionPopup?.();
      view._render?.();
      const visible = setReaderTextLayerSelection(view, scopedRanges);
      return visible;
    } catch (err) {
      debugZai("task.pdf-location.quiet-selection.failed", {
        error: errorMessage(err),
        attachmentID: locator.attachmentID,
        pageIndex: locator.pageIndex,
      });
    }
  }
  return false;
}

export function focusReaderViewForSelection(view: any) {
  try {
    view?.focus?.();
    view?._iframe?.focus?.();
    view?._iframeWindow?.focus?.();
  } catch {
    /* best effort */
  }
}

export function setReaderTextLayerSelection(
  view: any,
  selectionRanges: any[],
): boolean {
  const win = view?._iframeWindow as Window | undefined;
  const doc = win?.document;
  if (!win || !doc || !selectionRanges.length) return false;

  try {
    const first = selectionRanges[0];
    const last = selectionRanges[selectionRanges.length - 1];
    const start = readerTextLayerNodeOffset(
      doc,
      selectionRangePageIndex(first),
      Math.min(
        selectionRangeOffset(first?.anchorOffset),
        selectionRangeOffset(first?.headOffset),
      ),
    );
    const end = readerTextLayerNodeOffset(
      doc,
      selectionRangePageIndex(last),
      Math.max(
        selectionRangeOffset(last?.anchorOffset),
        selectionRangeOffset(last?.headOffset),
      ),
    );
    if (!start || !end) return false;
    const range = doc.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const selection = win.getSelection();
    if (!selection) return false;
    selection.removeAllRanges();
    selection.addRange(range);
    focusReaderViewForSelection(view);
    const visibleText = normalizeSelectedText(selection.toString());
    debugZai("task.pdf-location.dom-selection", {
      rangeCount: selection.rangeCount,
      text: textDebugInfo(visibleText, 120),
    });
    return selection.rangeCount > 0 && !!visibleText;
  } catch (err) {
    debugZai("task.pdf-location.dom-selection.failed", {
      error: errorMessage(err),
    });
    return false;
  }
}

type ReaderScrollContainer = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  getBoundingClientRect: () => DOMRect;
};

export function centerReaderSelectionInActiveViews(reader: unknown): boolean {
  for (const view of activeReaderViews(reader as any)) {
    if (centerReaderSelectionInView(view)) return true;
  }
  return false;
}

export function centerReaderSelectionInView(view: any): boolean {
  const win = view?._iframeWindow as Window | undefined;
  const selection = win?.getSelection?.();
  if (!win || !selection || selection.rangeCount === 0) return false;

  try {
    const range = selection.getRangeAt(0);
    const rect = firstVisibleRangeRect(range);
    if (!rect) return false;

    const container = readerScrollContainer(view);
    if (container) {
      const containerRect = container.getBoundingClientRect();
      const target =
        container.scrollTop +
        rect.top -
        containerRect.top -
        Math.max(80, container.clientHeight * 0.35);
      container.scrollTop = boundedScrollTop(container, target);
      debugZai("task.pdf-selection-preview.centered", {
        top: Math.round(container.scrollTop),
      });
      return true;
    }

    const target =
      win.scrollY + rect.top - Math.max(80, win.innerHeight * 0.35);
    win.scrollTo(win.scrollX, Math.max(0, Math.round(target)));
    return true;
  } catch (err) {
    debugZai("task.pdf-selection-preview.center.failed", {
      error: errorMessage(err),
    });
    return false;
  }
}

export function firstVisibleRangeRect(range: Range): DOMRect | null {
  const rectList = range.getClientRects();
  const rects = Array.from(rectList ?? []).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );
  const rect = rects[0] ?? range.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

export function readerScrollContainer(view: any): ReaderScrollContainer | null {
  const win = view?._iframeWindow as Window | undefined;
  const doc = win?.document;
  return (
    scrollContainerElement(win?.PDFViewerApplication?.pdfViewer?.container) ||
    scrollContainerElement(doc?.getElementById("viewerContainer")) ||
    scrollContainerElement(doc?.scrollingElement)
  );
}

export function scrollContainerElement(value: unknown): ReaderScrollContainer | null {
  const node = value as Partial<ReaderScrollContainer> | null | undefined;
  if (
    !node ||
    typeof node.scrollTop !== "number" ||
    typeof node.scrollHeight !== "number" ||
    typeof node.clientHeight !== "number" ||
    typeof node.getBoundingClientRect !== "function"
  ) {
    return null;
  }
  return node as ReaderScrollContainer;
}

export function boundedScrollTop(
  container: ReaderScrollContainer,
  target: number,
): number {
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
  return Math.min(maxTop, Math.max(0, Math.round(target)));
}

export function readerTextLayerNodeOffset(
  doc: Document,
  pageIndex: number,
  offset: number,
): { node: Node; offset: number } | null {
  const container = doc.querySelector(
    `[data-page-number="${pageIndex + 1}"] .textLayer`,
  );
  if (!container) return null;

  const textNodeType = doc.defaultView?.Node?.TEXT_NODE ?? 3;
  let visibleCharIndex = 0;
  const stack: Node[] = [container];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.nodeType === textNodeType) {
      const value = node.nodeValue ?? "";
      let nodeOffset = 0;
      for (const char of Array.from(value)) {
        if (char.trim()) {
          if (visibleCharIndex === offset) {
            return { node, offset: nodeOffset };
          }
          visibleCharIndex++;
        }
        nodeOffset += char.length;
      }
      if (visibleCharIndex === offset) {
        return { node, offset: nodeOffset };
      }
      continue;
    }
    for (let i = node.childNodes.length - 1; i >= 0; i--) {
      const child = node.childNodes.item(i);
      if (child) stack.push(child);
    }
  }
  return null;
}

export function suppressReaderSelectionTextForPrompt(reader: unknown, text: string) {
  const normalized = normalizeSelectedText(text);
  if (!normalized) return;
  for (const id of readerItemIDs(reader, null)) {
    ignoredSelectedTextByItem.set(id, normalized);
    selectedTextByItem.delete(id);
    selectedAnnotationByItem.delete(id);
  }
}

export function pdfLocationScrollPosition(
  rawPosition: Record<string, unknown>,
  view: any,
  referenceKind?: ReadingRouteReferenceKind,
): Record<string, unknown> {
  const position =
    clonePlainRecord(rawPosition) ??
    rawPosition ??
    ({} as Record<string, unknown>);
  const pageIndex = finiteNumber(position.pageIndex);
  const rects = pdfRects(position.rects);
  if (pageIndex == null || !rects.length) return position;

  const pageBounds = pdfPageBounds(view, pageIndex);
  if (!pageBounds || referenceKind === "equation") return position;

  const [pageX1, pageY1, pageX2, pageY2] = pageBounds;
  const bounds = pdfRectBounds(rects);
  if (!bounds) return position;

  const pageHeight = Math.max(1, pageY2 - pageY1);
  const context = Math.min(Math.max(pageHeight * 0.3, 180), 320);
  const [, y1, , y2] = bounds;
  const contextRect: PdfRectTuple =
    referenceKind === "table"
      ? [pageX1, Math.max(pageY1, y1 - context), pageX2, y2]
      : [pageX1, y1, pageX2, Math.min(pageY2, y2 + context)];
  return {
    ...position,
    pageIndex,
    rects: [contextRect],
  };
}

export function pdfPageBounds(view: any, pageIndex: number): PdfRectTuple | null {
  const pdfPage = readerPageForIndex(view, pageIndex);
  const viewBox = pdfRects([pdfPage?.viewBox])[0];
  if (viewBox) return viewBox;
  const viewportViewBox = pdfRects([
    view?._iframeWindow?.PDFViewerApplication?.pdfViewer?._pages?.[pageIndex]
      ?.viewport?.viewBox,
  ])[0];
  return viewportViewBox ?? null;
}

export function pdfRectBounds(rects: PdfRectTuple[]): PdfRectTuple | null {
  if (!rects.length) return null;
  return [
    Math.min(...rects.map((rect) => rect[0])),
    Math.min(...rects.map((rect) => rect[1])),
    Math.max(...rects.map((rect) => rect[2])),
    Math.max(...rects.map((rect) => rect[3])),
  ];
}

export async function clearReaderTransientPdfStateAfterNavigate(
  win: Window | null | undefined,
  reader: unknown,
  options: { clearHighlight?: boolean; clearSelection?: boolean } = {},
) {
  clearReaderTransientPdfState(reader, options);
  for (const delayMs of [80, 240]) {
    await sleepInWindow(win, delayMs);
    clearReaderTransientPdfState(reader, options);
  }
}

export function clearReaderTransientPdfState(
  reader: unknown,
  options: { clearHighlight?: boolean; clearSelection?: boolean } = {},
) {
  const clearHighlight = options.clearHighlight !== false;
  const clearSelection = options.clearSelection !== false;
  for (const view of activeReaderViews(reader as any)) {
    try {
      if (clearSelection) view?._setSelectionRanges?.();
      view?._onSetSelectionPopup?.();
      view?._onSetAnnotationPopup?.();
      view?._onSetOverlayPopup?.(null);
      if (clearHighlight && "_highlightedPosition" in view) {
        view._highlightedPosition = null;
      }
      if (clearSelection) {
        view?._iframeWindow?.getSelection?.()?.removeAllRanges?.();
      }
      view?._render?.();
    } catch (err) {
      debugZai("task.pdf-location.clear-transient.failed", {
        error: errorMessage(err),
      });
    }
  }
}

export function sleepInWindow(
  win: Window | null | undefined,
  delayMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    if (win?.setTimeout) win.setTimeout(resolve, delayMs);
    else setTimeout(resolve, delayMs);
  });
}

export function selectionRangesFromLocator(
  view: any,
  locator: PdfSelectionLocator,
): Array<Record<string, unknown>> {
  const position = locator.position as { pageIndex?: unknown; rects?: unknown };
  const pageIndex = finiteNumber(position.pageIndex);
  const rects = pdfRects(position.rects);
  if (pageIndex == null || rects.length === 0) return [];

  const page = readerPageForIndex(view, pageIndex);
  const chars = Array.isArray(page?.chars) ? page.chars : [];
  if (!chars.length) return [];

  const offsets =
    selectionOffsetsFromLocatorPosition(position, chars.length) ??
    charOffsetsForReaderText(chars, locator.selectedText, rects) ??
    charOffsetsForPdfRects(chars, rects);
  if (!offsets) {
    debugZai("task.pdf-selection.restore.offsets-missing", {
      pageIndex,
      rects: rects.length,
      text: textDebugInfo(locator.selectedText, 120),
    });
    return [];
  }
  const [anchorOffset, headOffset] = offsets;
  const rangeRects =
    rectsFromReaderChars(chars.slice(anchorOffset, headOffset)) || rects;
  const range = {
    pageIndex,
    anchorOffset,
    headOffset,
    anchor: true,
    head: true,
    collapsed: anchorOffset === headOffset,
    text:
      locator.selectedText ||
      textFromReaderChars(chars.slice(anchorOffset, headOffset)),
    sortIndex: selectionSortIndex(
      pageIndex,
      anchorOffset,
      rangeRects,
      page?.viewBox,
    ),
    position: { pageIndex, rects: rangeRects },
  };
  return range.collapsed ? [] : [range];
}

export function selectionOffsetsFromLocatorPosition(
  position: Record<string, unknown>,
  charCount: number,
): [number, number] | null {
  const anchorOffset = finiteNumber(position.zaiAnchorOffset);
  const headOffset = finiteNumber(position.zaiHeadOffset);
  if (anchorOffset == null || headOffset == null) return null;
  const start = Math.floor(anchorOffset);
  const end = Math.floor(headOffset);
  if (
    start !== anchorOffset ||
    end !== headOffset ||
    start < 0 ||
    end <= start ||
    end > charCount
  ) {
    return null;
  }
  return [start, end];
}

export function readerPageForIndex(view: any, pageIndex: number): any {
  const pages = view?._pdfPages;
  return Array.isArray(pages) ? pages[pageIndex] : pages?.[String(pageIndex)];
}

export function resolveItemKeyForCache(itemID: number | null): string | null {
  if (itemID == null) return null;
  try {
    const item = (
      globalThis as unknown as {
        Zotero?: { Items?: { get?: (id: number) => { key?: string } | null } };
      }
    ).Zotero?.Items?.get?.(itemID);
    const key = typeof item?.key === "string" ? item.key : "";
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

export function selectionRangePageIndex(range: any): number {
  const pageIndex =
    range?.position?.pageIndex ?? range?.pageIndex ?? range?.positionPageIndex;
  return typeof pageIndex === "number" && Number.isFinite(pageIndex)
    ? Math.floor(pageIndex)
    : 0;
}

export function selectionRangeOffset(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function textFromReaderChars(chars: any[]): string {
  const text: string[] = [];
  for (const char of chars) {
    if (!char || char.ignorable) continue;
    if (typeof char.c === "string") text.push(char.c);
    if (char.paragraphBreakAfter) {
      text.push("\n\n");
    } else if (char.lineBreakAfter) {
      text.push("\n");
    } else if (char.spaceAfter) {
      text.push(" ");
    }
  }
  return text.join("").trim();
}

export function pdfSelectionLocatorFromLocateResult(
  attachmentID: number,
  selectedText: string,
  result: {
    pageIndex: number;
    pageLabel: string;
    rects: PdfRectTuple[];
    anchorOffset?: number;
    headOffset?: number;
  },
): PdfSelectionLocator {
  return {
    attachmentID,
    selectedText,
    pageIndex: result.pageIndex,
    pageLabel: result.pageLabel,
    position: {
      pageIndex: result.pageIndex,
      rects: result.rects,
      ...(result.anchorOffset != null
        ? { zaiAnchorOffset: result.anchorOffset }
        : {}),
      ...(result.headOffset != null
        ? { zaiHeadOffset: result.headOffset }
        : {}),
    },
  };
}
