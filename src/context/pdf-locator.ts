import { splitSentences } from "../translate/sentence-splitter";
import { DEFAULT_CONTEXT_POLICY } from "./policy";

// Locator that maps a verbatim text passage to PDF coordinates so we can
// write a Zotero highlight at the correct rectangle.
//
// Why this file is hard:
// 1. Zotero exposes TWO PDF text APIs we have to support:
//    - "processed" (Zotero 8/9): char-level data with rects and break flags.
//    - "textContent" (PDF.js fallback): item-level strings with transforms,
//      no per-char rects — we synthesize them by interpolating x within
//      each item's width.
// 2. The PDF text we match against is normalized (lowercased, ligatures
//    expanded, hyphen-line-breaks collapsed, whitespace coalesced). We must
//    map normalized offsets back to ORIGINAL char offsets to extract rects
//    accurately. That's `normalizeWithMap` + `originalRangeFromNormalized`.
// 3. Match runs in two stages per page: exact substring in normalized text,
//    falling back to a Levenshtein fuzzy scan with stride = needle/4. We
//    never claim a hit below `minConfidence` (default 0.85).
// 4. Annotations in Zotero sort by a "pageIndex|offset|topY" string. The
//    semantics of `offset` differ between the two text-source paths — see
//    `sortOffsetForRange`.
//
// REF: Zotero source `Zotero.Annotations.saveFromJSON`, PDF.js
//      `getTextContent`, Zotero pdf-reader `_pdfPages` / `getProcessedData`.

export type PdfRect = [number, number, number, number];

export interface LocateResult {
  pageIndex: number;
  pageLabel: string;
  rects: PdfRect[];
  sortIndex: string;
  matchedText: string;
  confidence: number;
  anchorOffset?: number;
  headOffset?: number;
}

export interface LocatedSentence {
  text: string;
  pageIndex: number;
  pageLabel: string;
  rects: PdfRect[];
  sortIndex: string;
  pageSentenceIndex: number;
  pageSentenceCount: number;
  paragraphContext: string;
  // Page-local range + sort top, so a document-wide sortIndex can be rebuilt
  // deterministically via `documentSortIndexForRange`. WHY: sentenceAtPoint /
  // sentenceAtIndex pass a page-local offset (0) for a fast click→select path
  // (no preceding-page extraction), so their `sortIndex` is PROVISIONAL and
  // must be rebuilt to a document-wide value before persisting an annotation.
  rangeStart: number;
  rangeEnd: number;
  sortTop: number;
}

export interface PdfPageContent {
  pageIndex: number;
  pageLabel: string;
  pageText: string;
  normalizedText: string;
  normalizedToOriginal: number[];
  viewBox?: PdfRect;
}

export interface PdfLocator {
  attachmentID: number;
  pageCount: number;
  getFullText(): Promise<string>;
  extractTextFromPosition(position: unknown): Promise<string>;
  getPageContent(pageIndex: number): Promise<PdfPageContent | null>;
  closestTextOffset?(
    pageIndex: number,
    point: { x: number; y: number },
  ): Promise<number | null>;
  sentenceAtPoint?(
    pageIndex: number,
    point: { x: number; y: number },
  ): Promise<LocatedSentence | null>;
  sentenceAtIndex?(
    pageIndex: number,
    sentenceIndex: number,
  ): Promise<LocatedSentence | null>;
  // Paragraph-granular variants of sentenceAtPoint/sentenceAtIndex: the returned
  // LocatedSentence spans a whole paragraph (text + merged rects), and its
  // pageSentenceIndex/pageSentenceCount carry the PARAGRAPH index/count so the
  // translate card can step paragraph-by-paragraph through the same field.
  paragraphAtPoint?(
    pageIndex: number,
    point: { x: number; y: number },
  ): Promise<LocatedSentence | null>;
  paragraphAtIndex?(
    pageIndex: number,
    paragraphIndex: number,
  ): Promise<LocatedSentence | null>;
  // Rebuild a document-wide annotation sortIndex from a page-local range. Used
  // by the translate save path to upgrade the provisional page-local sortIndex
  // of sentenceAtPoint/sentenceAtIndex, keeping reading-order sort consistent
  // with locate()-saved and legacy annotations on the same page.
  documentSortIndexForRange?(
    pageIndex: number,
    rangeStart: number,
    rangeEnd: number,
    top: number,
  ): Promise<string | null>;
  locate(
    needle: string,
    opts?: { minConfidence?: number; pageIndex?: number; exactOnly?: boolean },
  ): Promise<LocateResult | null>;
  renderRegion(
    pageIndex: number,
    rects: PdfRect[],
    onTrace?: (msg: string) => void,
  ): Promise<Uint8Array | null>;
  dispose(): void;
}

interface PdfDocumentLike {
  numPages?: number;
  pdfInfo?: { numPages?: number };
  _pdfInfo?: { numPages?: number };
  getPage?(pageNumber: number): Promise<PdfPageLike>;
  getPageLabels?(): Promise<Array<string | null> | null>;
  getPageLabels2?(): Promise<Array<string | null> | null>;
  getProcessedData?(): Promise<{ pages?: ProcessedPageCollection }>;
  getPageData?(options: { pageIndex: number }): Promise<ProcessedPageLike>;
}

interface PdfPageLike {
  view?: unknown;
  viewBox?: unknown;
  _pageInfo?: { view?: unknown };
  viewport?: { viewBox?: unknown };
  getTextContent(options?: {
    disableCombineTextItems?: boolean;
  }): Promise<{ items?: PdfTextItemLike[] }>;
}

interface PdfTextItemLike {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
  width?: number;
  height?: number;
}

interface ItemAnchor {
  itemIndex: number;
  pageIndex: number;
  startOffset: number;
  endOffset: number;
  x: number;
  y: number;
  width: number;
  height: number;
  itemString: string;
  lineBreakAfter?: boolean;
  paragraphBreakAfter?: boolean;
  source?: "textContent" | "processed";
}

interface PageBundle {
  pageIndex: number;
  pageLabel: string;
  pageText: string;
  anchors: ItemAnchor[];
  normalizedText: string;
  normalizedToOriginal: number[];
  viewBox?: PdfRect;
  source?: "textContent" | "processed";
}

interface NormalizedText {
  text: string;
  map: number[];
}

interface NormalizedMatch {
  page: PageBundle;
  normalizedStart: number;
  normalizedEnd: number;
  confidence: number;
}

interface PdfPageSource {
  pageCount: number;
  getPage?(pageIndex: number): Promise<PdfPageLike>;
  getPageBundle?(
    pageIndex: number,
    pageLabel: string,
  ): Promise<PageBundle | null>;
  getPageLabels(): Promise<string[]>;
}

type ProcessedPageCollection =
  | Record<string, ProcessedPageLike | undefined>
  | Array<ProcessedPageLike | undefined>;

interface ProcessedPageLike {
  chars?: ProcessedCharLike[];
  viewBox?: unknown;
}

interface ProcessedCharLike {
  c?: string;
  u?: string;
  rect?: unknown;
  inlineRect?: unknown;
  ignorable?: boolean;
  spaceAfter?: boolean;
  lineBreakAfter?: boolean;
  paragraphBreakAfter?: boolean;
  wordBreakAfter?: boolean;
}

// Tuning constants. INVARIANT: changes here must be re-validated against
// real PDFs (small-font 2-col papers expose Y-grouping bugs first).
const DEFAULT_MIN_CONFIDENCE = 0.85;
// LINE_Y_TOLERANCE is in PDF user-space units: items whose y differs by
// ≤2 are treated as the same visual line. Loose enough for descender drift,
// tight enough to keep adjacent lines separate at body font sizes.
const LINE_Y_TOLERANCE = 2;
const SELECTION_RECT_TOLERANCE = 2;
// Reader can be polled for up to 5s before its iframe has a pdfDocument.
// GOTCHA: opening a tab via `Zotero.Reader.open` resolves before the PDF.js
// viewer is ready; we MUST wait, not throw immediately.
const PDF_SOURCE_WAIT_MS = 5000;
const PDF_SOURCE_POLL_MS = 120;
// Common Latin ligatures the PDF text layer emits as single codepoints.
// Expanded BEFORE matching so a needle "office" finds "oﬃce".
const LIGATURES: Record<string, string> = {
  "\ufb00": "ff",
  "\ufb01": "fi",
  "\ufb02": "fl",
  "\ufb03": "ffi",
  "\ufb04": "ffl",
  "\ufb05": "st",
  "\ufb06": "st",
};

export async function createPdfLocator(reader: unknown): Promise<PdfLocator> {
  const source = await waitForPdfSource(reader);
  if (!source) {
    throw new Error(
      "No PDF document is available from the active Zotero Reader.",
    );
  }

  const attachmentID = extractAttachmentID(reader);
  if (attachmentID == null) {
    throw new Error(
      "No PDF attachment ID is available from the active Zotero Reader.",
    );
  }

  // Page bundles are loaded lazily and memoized as PROMISES (not values),
  // so two concurrent locate() calls share one extraction pass per page.
  // INVARIANT: never re-extract a page — the textContent / processed
  // results are not guaranteed to be identical across calls.
  const bundles = new Map<number, Promise<PageBundle | null>>();
  const pageLengths = new Map<number, number>();
  const pageLabels = await source.getPageLabels();

  const bundleFor = (pageIndex: number): Promise<PageBundle | null> => {
    const existing = bundles.get(pageIndex);
    if (existing) return existing;
    const bundle = readPageBundle(source, pageIndex, pageLabels[pageIndex])
      .then((page) => {
        if (page) pageLengths.set(pageIndex, page.pageText.length);
        return page;
      })
      .catch(() => null);
    bundles.set(pageIndex, bundle);
    return bundle;
  };

  // Sum of pageText lengths for pages [0, pageIndex). Used by the
  // textContent source to build a document-wide sort offset (Zotero needs
  // this so annotations sort in reading order across pages).
  const cumulativeOffset = async (pageIndex: number): Promise<number> => {
    let offset = 0;
    for (let index = 0; index < pageIndex; index++) {
      if (!pageLengths.has(index)) {
        await bundleFor(index);
      }
      offset += pageLengths.get(index) ?? 0;
    }
    return offset;
  };

  return {
    attachmentID,
    pageCount: source.pageCount,
    async getFullText() {
      const pages: string[] = [];
      for (let pageIndex = 0; pageIndex < source.pageCount; pageIndex++) {
        const page = await bundleFor(pageIndex);
        if (page?.pageText) pages.push(page.pageText.trimEnd());
      }
      return pages.join("\n");
    },
    async extractTextFromPosition(position) {
      const groups = selectionRectGroups(position);
      const pages: string[] = [];
      for (const group of groups) {
        const page = await bundleFor(group.pageIndex);
        if (!page) continue;
        const text = extractBestPageTextFromSelectionRects(page, group.rects);
        debugPdfLocator("extract-position", {
          pageIndex: group.pageIndex,
          rects: group.rects.length,
          source: page.source,
          hasViewBox: !!page.viewBox,
          text: debugTextInfo(text),
        });
        if (text) pages.push(text);
      }
      return pages.join("\n");
    },
    async getPageContent(pageIndex) {
      const page = await bundleFor(pageIndex);
      if (!page) return null;
      return {
        pageIndex: page.pageIndex,
        pageLabel: page.pageLabel,
        pageText: page.pageText,
        normalizedText: page.normalizedText,
        normalizedToOriginal: page.normalizedToOriginal,
        viewBox: page.viewBox,
      };
    },
    async closestTextOffset(pageIndex, point) {
      const page = await bundleFor(pageIndex);
      if (!page) return null;
      return closestTextOffset(page.anchors, point);
    },
    async sentenceAtPoint(pageIndex, point) {
      const page = await bundleFor(pageIndex);
      if (!page) return null;
      // Page-local offset (0): only the clicked page is extracted, so the
      // click→select path no longer extracts every preceding page (which froze
      // for seconds on later pages). The returned sortIndex is PROVISIONAL and
      // page-local; the translate save path rebuilds the document-wide value via
      // documentSortIndexForRange. Only translate calls sentenceAtPoint.
      return sentenceAtPointOnPage(page, point, 0);
    },
    async sentenceAtIndex(pageIndex, sentenceIndex) {
      const page = await bundleFor(pageIndex);
      if (!page) return null;
      // Page-local offset (0); provisional sortIndex rebuilt at save — see
      // sentenceAtPoint. Only translate (sentence jump) calls this.
      return sentenceAtIndexOnPage(page, sentenceIndex, 0);
    },
    async paragraphAtPoint(pageIndex, point) {
      const page = await bundleFor(pageIndex);
      if (!page) return null;
      return paragraphAtPointOnPage(page, point, 0);
    },
    async paragraphAtIndex(pageIndex, paragraphIndex) {
      const page = await bundleFor(pageIndex);
      if (!page) return null;
      return paragraphAtIndexOnPage(page, paragraphIndex, 0);
    },
    // Rebuild a document-wide sortIndex from a page-local range. Mirrors
    // locatedSentenceFromSegment's sortIndex rule (including the processed-source
    // itemIndex path), so a translate annotation saved via this sorts identically
    // to one that locate() would have produced.
    async documentSortIndexForRange(pageIndex, rangeStart, rangeEnd, top) {
      const page = await bundleFor(pageIndex);
      if (!page) return null;
      const pageGlobalOffset =
        page.source === "processed" ? 0 : await cumulativeOffset(pageIndex);
      return buildSortIndex(
        page.pageIndex,
        sortOffsetForRange(page, rangeStart, rangeEnd, pageGlobalOffset),
        top,
      );
    },
    // Two-stage match. WHY two stages: most model-supplied passages match
    // verbatim (they were copied from getFullText output), so an O(N) page
    // scan with `indexOf` finds them fast. We only fall back to the O(N·k)
    // fuzzy stage for the minority of cases where ligatures / dehyphenation
    // / column-break artifacts perturb the text.
    //
    // Exact match returns immediately on the first page that contains the
    // needle. Fuzzy match scans ALL pages and picks the highest-confidence
    // window above `minConfidence` — never a same-page early-exit, because
    // a low-confidence early page can mask a high-confidence later page.
    async locate(needle, opts) {
      const normalizedNeedle = normalizeWithMap(needle).text;
      if (!normalizedNeedle) return null;

      const minConfidence = opts?.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
      // exactOnly callers want the cheap O(N) substring pass only. Skipping
      // the O(N·k) fuzzy stage lets a multi-candidate locate try EVERY
      // candidate's exact match before any single one pays for fuzzy.
      const exactOnly = opts?.exactOnly === true;
      const pageIndexes =
        typeof opts?.pageIndex === "number" &&
        Number.isInteger(opts.pageIndex) &&
        opts.pageIndex >= 0 &&
        opts.pageIndex < source.pageCount
          ? [opts.pageIndex]
          : Array.from({ length: source.pageCount }, (_, index) => index);
      let bestFuzzy: NormalizedMatch | null = null;
      // Fuzzy scanning a page is synchronous; once page bundles are cached
      // the whole loop would run as one uninterrupted task. Hand control back
      // to the event loop every ~30ms so a long scan cannot jank Zotero's UI.
      let lastYield = Date.now();
      for (const pageIndex of pageIndexes) {
        const page = await bundleFor(pageIndex);
        if (!page || !page.normalizedText) continue;

        const exactIndex = page.normalizedText.indexOf(normalizedNeedle);
        if (exactIndex >= 0) {
          return locateOnPage(
            page,
            exactIndex,
            exactIndex + normalizedNeedle.length,
            1,
            await cumulativeOffset(pageIndex),
          );
        }

        const interrupted = interruptedExactRanges(
          page.normalizedText,
          normalizedNeedle,
        );
        if (interrupted) {
          return locateInterruptedOnPage(
            page,
            interrupted,
            needle,
            await cumulativeOffset(pageIndex),
          );
        }

        if (exactOnly) continue;

        const fuzzy = fuzzyNormalizedMatch(page, normalizedNeedle);
        if (
          fuzzy &&
          fuzzy.confidence >= minConfidence &&
          (!bestFuzzy || fuzzy.confidence > bestFuzzy.confidence)
        ) {
          bestFuzzy = fuzzy;
        }

        if (Date.now() - lastYield > 30) {
          await delay(0);
          lastYield = Date.now();
        }
      }

      if (!bestFuzzy) return null;
      return locateOnPage(
        bestFuzzy.page,
        bestFuzzy.normalizedStart,
        bestFuzzy.normalizedEnd,
        bestFuzzy.confidence,
        await cumulativeOffset(bestFuzzy.page.pageIndex),
      );
    },
    // Renders a cropped PNG of one PDF region from the live pdf.js viewer.
    // WHY a separate render path (not the text-source object graph above):
    // text extraction needs a `pdfDocument`, but rendering needs the real
    // pdf.js `PDFPageProxy` reachable only via `pdfViewer.getPageView(...)`.
    // A live probe confirmed `pdfDocument.getPage()` returns a non-renderable
    // object — see `extractPdfViewer`. Any failure returns null so callers
    // (the formula-repair pipeline) degrade gracefully.
    async renderRegion(pageIndex, rects, onTrace) {
      try {
        if (!rects.length) {
          onTrace?.("no rects");
          return null;
        }
        const found = extractPdfViewer(reader);
        if (!found) {
          onTrace?.("no pdfViewer");
          return null;
        }
        const pv = found.viewer.getPageView?.(pageIndex);
        if (!pv) {
          onTrace?.("no pageView");
          return null;
        }

        // Crop the canvas pdf.js ALREADY rendered, instead of calling
        // `pdfPage.render()` ourselves. WHY: pdf.js runs in the reader's
        // content compartment and cannot read parameter objects built in the
        // plugin's privileged compartment — `getViewport({scale})` and
        // `render({canvasContext})` both receive `undefined` across the Xray
        // boundary. Reading the canvas pdf.js itself drew sidesteps that.
        if ((!pv.canvas || !pv.canvas.width) && typeof pv.draw === "function") {
          onTrace?.("page not drawn yet — calling pv.draw()");
          try {
            await pv.draw();
          } catch (e) {
            onTrace?.(`pv.draw threw: ${String(e)}`);
          }
        }
        const srcCanvas = pv.canvas;
        if (!srcCanvas || !srcCanvas.width || !srcCanvas.height) {
          onTrace?.("no rendered page canvas");
          return null;
        }
        const cw: number = srcCanvas.width;
        const ch: number = srcCanvas.height;
        onTrace?.(`page canvas ${cw}x${ch}`);

        // PDF user-space page box — maps rects (y-up) onto canvas px (y-down).
        const page = await bundleFor(pageIndex);
        const viewBox = page?.viewBox;
        const pageW = viewBox ? viewBox[2] - viewBox[0] : 0;
        const pageH = viewBox ? viewBox[3] - viewBox[1] : 0;
        if (!viewBox || pageW <= 0 || pageH <= 0) {
          onTrace?.("no usable page viewBox");
          return null;
        }

        const pad = DEFAULT_CONTEXT_POLICY.formulaCropPaddingPt;
        let bx0 = Infinity;
        let by0 = Infinity;
        let bx1 = -Infinity;
        let by1 = -Infinity;
        for (const rect of rects) {
          const left = ((rect[0] - pad - viewBox[0]) / pageW) * cw;
          const right = ((rect[2] + pad - viewBox[0]) / pageW) * cw;
          const top = ((viewBox[3] - (rect[3] + pad)) / pageH) * ch;
          const bottom = ((viewBox[3] - (rect[1] - pad)) / pageH) * ch;
          bx0 = Math.min(bx0, left);
          bx1 = Math.max(bx1, right);
          by0 = Math.min(by0, top);
          by1 = Math.max(by1, bottom);
        }
        const x0 = Math.max(0, Math.min(cw, bx0));
        const y0 = Math.max(0, Math.min(ch, by0));
        const x1 = Math.max(0, Math.min(cw, bx1));
        const y1 = Math.max(0, Math.min(ch, by1));
        const w = Math.max(1, Math.round(x1 - x0));
        const h = Math.max(1, Math.round(y1 - y0));
        onTrace?.(`crop ${w}x${h} at ${Math.round(x0)},${Math.round(y0)}`);

        // Crop canvas lives in the plugin's privileged document so `toBlob`
        // runs fully on this side; `drawImage` reading the content-side page
        // canvas is a permitted cross-compartment read (probe-confirmed).
        const chromeDoc: Document | undefined = (
          globalThis as { Zotero?: { getMainWindow?: () => { document?: Document } | null } }
        ).Zotero?.getMainWindow?.()?.document;
        if (!chromeDoc) {
          onTrace?.("no chrome document");
          return null;
        }
        const crop: any = chromeDoc.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "canvas",
        );
        crop.width = w;
        crop.height = h;
        const cropCtx = crop.getContext("2d");
        if (!cropCtx) {
          onTrace?.("no crop 2d context");
          return null;
        }
        cropCtx.drawImage(srcCanvas, x0, y0, w, h, 0, 0, w, h);

        const blob: Blob = await new Promise((res, rej) =>
          crop.toBlob(
            (b: Blob | null) =>
              b ? res(b) : rej(new Error("toBlob failed")),
            "image/png",
          ),
        );
        onTrace?.(`blob ${blob.size}B`);
        return new Uint8Array(await blob.arrayBuffer());
      } catch (e) {
        onTrace?.(`threw: ${String(e)}`);
        return null;
      }
    },
    dispose() {
      bundles.clear();
      pageLengths.clear();
    },
  };
}

function interruptedExactRanges(
  haystack: string,
  needle: string,
): Array<{ start: number; end: number }> | null {
  const minSideLength = 24;
  if (needle.length < minSideLength * 2) return null;
  const seed = needle.slice(0, Math.min(32, needle.length));
  let start = haystack.indexOf(seed);
  while (start >= 0) {
    let shared = 0;
    while (
      shared < needle.length &&
      start + shared < haystack.length &&
      haystack[start + shared] === needle[shared]
    ) {
      shared += 1;
    }
    const remaining = needle.length - shared;
    if (shared >= minSideLength && remaining >= minSideLength) {
      const suffixSeed = needle.slice(shared, shared + minSideLength);
      let resume = haystack.indexOf(suffixSeed, start + shared + 1);
      while (resume >= 0 && resume - (start + shared) <= 200) {
        const noise = haystack.slice(start + shared, resume).trim();
        if (
          isSkippableInsertedPageNoise(noise) &&
          haystack.startsWith(needle.slice(shared), resume)
        ) {
          return [
            { start, end: start + shared },
            { start: resume, end: resume + remaining },
          ];
        }
        resume = haystack.indexOf(suffixSeed, resume + 1);
      }
    }
    start = haystack.indexOf(seed, start + 1);
  }
  return null;
}

function isSkippableInsertedPageNoise(text: string): boolean {
  return (
    !!text &&
    text.length <= 160 &&
    /^(?:[*†‡§]|\d+\s|equal contribution\b)/iu.test(text)
  );
}

async function locateInterruptedOnPage(
  page: PageBundle,
  normalizedRanges: Array<{ start: number; end: number }>,
  needle: string,
  pageGlobalOffset: number,
): Promise<LocateResult | null> {
  const ranges = normalizedRanges
    .map((range) =>
      originalRangeFromNormalized(
        page.pageText,
        page.normalizedToOriginal,
        range.start,
        range.end,
      ),
    )
    .filter(
      (range): range is { start: number; end: number } => range != null,
    );
  if (ranges.length !== normalizedRanges.length) return null;
  const rectGroups = ranges.map((range) =>
    rectsForRange(page.anchors, range.start, range.end),
  );
  if (rectGroups.some((rects) => rects.length === 0)) return null;
  const firstRange = ranges[0]!;
  const firstRects = rectGroups[0]!;
  return {
    pageIndex: page.pageIndex,
    pageLabel: page.pageLabel,
    rects: rectGroups.flat(),
    sortIndex: buildSortIndex(
      page.pageIndex,
      sortOffsetForRange(
        page,
        firstRange.start,
        firstRange.end,
        pageGlobalOffset,
      ),
      sortTopForPage(page, firstRects),
    ),
    matchedText: needle.replace(/\s+/gu, " ").trim(),
    confidence: 1,
  };
}

// Building a locator re-extracts and re-normalizes the entire PDF text layer.
// When a user clicks several "查看原文" links in a row, doing that per click is
// the dominant latency. `getSharedPdfLocator` reuses one locator per Reader:
// the Reader's object identity tracks the open PDF document, so a
// closed-then-reopened tab produces a fresh Reader (hence a fresh locator)
// automatically, and a WeakMap lets a discarded Reader and its locator be
// garbage-collected without any explicit dispose() call.
const sharedLocators = new WeakMap<object, Promise<PdfLocator>>();

// Reach the live PDF.js viewer application of an open Zotero PDF Reader, for
// APIs the text-locator doesn't wrap — notably pdfDocument.getOutline() (the
// embedded TOC bookmarks) and pdfLinkService.goToDestination() (the native,
// top-aligned outline navigation). Returns null for non-PDF readers or a view
// that isn't ready yet.
export function getReaderPdfApp(reader: unknown): any | null {
  const r = reader as any;
  const windows = [
    r?._internalReader?._primaryView?._iframeWindow,
    r?._internalReader?._secondaryView?._iframeWindow,
    r?._internalReader?._iframeWindow,
    r?._iframeWindow,
  ];
  for (const win of windows) {
    for (const app of pdfViewerApplications(win)) {
      if (app?.pdfDocument && typeof app.pdfDocument.getOutline === "function") {
        return app;
      }
    }
  }
  return null;
}

export function getSharedPdfLocator(reader: unknown): Promise<PdfLocator> {
  if (typeof reader !== "object" || reader === null) {
    return createPdfLocator(reader);
  }
  const cached = sharedLocators.get(reader);
  if (cached) return cached;
  // A rejected build (e.g. the PDF view was not ready yet) must not be cached
  // permanently — drop it so the next click can retry.
  const created = createPdfLocator(reader).catch((err) => {
    sharedLocators.delete(reader);
    throw err;
  });
  sharedLocators.set(reader, created);
  return created;
}

async function waitForPdfSource(
  reader: unknown,
): Promise<PdfPageSource | null> {
  const started = Date.now();
  let source = extractPdfSource(reader);
  while (!source && Date.now() - started < PDF_SOURCE_WAIT_MS) {
    await delay(PDF_SOURCE_POLL_MS);
    source = extractPdfSource(reader);
  }
  return source;
}

// Walks the Zotero Reader object graph looking for any PDF text source.
// GOTCHA: Zotero 7/8/9/10 expose this differently and even pre-release builds
// switch between `_internalReader._primaryView` and direct `_iframeWindow`.
// We try every shape we know and take the first that yields pageCount > 0.
// REF: Zotero source `chrome/content/zotero/elements/reader.js`.
function extractPdfSource(reader: unknown): PdfPageSource | null {
  const r = reader as any;
  const views = [
    r?._internalReader?._primaryView,
    r?._internalReader?._secondaryView,
  ].filter(Boolean);
  const windows = [
    ...views.map((view) => view?._iframeWindow),
    r?._internalReader?._iframeWindow,
    r?._iframeWindow,
  ];
  const apps = windows.flatMap((win) => pdfViewerApplications(win));

  return firstPdfSource([
    ...views.map((view) => processedViewSource(view)),
    ...apps.flatMap((app) => [
      processedDocumentSource(
        app?.pdfDocument,
        numberValue(app?.pdfViewer?.pagesCount),
      ),
      processedDocumentSource(
        app?.pdfViewer?.pdfDocument,
        numberValue(app?.pdfViewer?.pagesCount),
      ),
      documentSource(app?.pdfDocument),
      documentSource(app?.pdfViewer?.pdfDocument),
      pageViewSource(app?.pdfViewer),
    ]),
  ]);
}

function pdfViewerApplications(win: unknown): any[] {
  const w = win as any;
  return [
    w?.PDFViewerApplication,
    w?.wrappedJSObject?.PDFViewerApplication,
    w?.contentWindow?.PDFViewerApplication,
    w?.contentWindow?.wrappedJSObject?.PDFViewerApplication,
  ].filter(Boolean);
}

// Walks the same Reader iframe windows as `extractPdfSource`, but resolves to
// the live pdf.js `PDFViewer` instead of a text source. WHY we also return the
// iframe `win`: rendering creates a `<canvas>`, and the canvas must live in the
// same document/compartment as the pdf.js objects driving `render(...)`.
function extractPdfViewer(
  reader: unknown,
): { viewer: any; win: any } | null {
  const r = reader as any;
  const windows = [
    r?._internalReader?._primaryView?._iframeWindow,
    r?._internalReader?._secondaryView?._iframeWindow,
    r?._internalReader?._iframeWindow,
    r?._iframeWindow,
  ].filter(Boolean);
  for (const win of windows) {
    for (const app of pdfViewerApplications(win)) {
      const viewer = app?.pdfViewer;
      if (viewer) return { viewer, win };
    }
  }
  return null;
}

function firstPdfSource(
  values: Array<PdfPageSource | null>,
): PdfPageSource | null {
  for (const value of values) {
    if (value && value.pageCount > 0) return value;
  }
  return null;
}

function processedViewSource(view: unknown): PdfPageSource | null {
  const v = view as {
    _pdfPages?: ProcessedPageCollection;
    _pageLabels?: Array<string | null>;
    _iframeWindow?: unknown;
    _pages?: unknown[];
  } | null;
  if (!v) return null;
  const apps = pdfViewerApplications(v._iframeWindow);
  const doc = apps
    .map((app) => app?.pdfDocument ?? app?.pdfViewer?.pdfDocument)
    .find(Boolean);
  const pageCount = Math.max(
    0,
    Math.floor(
      pageCountFromDocument(doc) ||
        numberValue(v._pageLabels?.length) ||
        numberValue(v._pages?.length) ||
        processedPageCount(v._pdfPages) ||
        0,
    ),
  );
  if (pageCount <= 0 || (!v._pdfPages && !hasProcessedPageAPI(doc))) {
    return null;
  }

  const documentSource = processedDocumentSource(doc, pageCount);
  return {
    pageCount,
    async getPageBundle(pageIndex, pageLabel) {
      const pageData = processedPageAt(v._pdfPages, pageIndex);
      const fallbackViewBox =
        (await viewBoxFromDocument(doc, pageIndex)) ??
        viewBoxFromReaderView(v, apps, pageIndex);
      if (pageData) {
        return buildProcessedPageBundle(
          pageData,
          pageIndex,
          pageLabel,
          fallbackViewBox,
        );
      }
      return documentSource?.getPageBundle?.(pageIndex, pageLabel) ?? null;
    },
    async getPageLabels() {
      if (Array.isArray(v._pageLabels)) {
        return labelsFromArray(v._pageLabels, pageCount);
      }
      return documentSource?.getPageLabels() ?? numericPageLabels(pageCount);
    },
  };
}

function processedDocumentSource(
  pdfDocument: unknown,
  fallbackPageCount?: number | null,
): PdfPageSource | null {
  const doc = pdfDocument as PdfDocumentLike | null;
  if (!hasProcessedPageAPI(doc)) return null;
  const pageCount = Math.max(
    0,
    Math.floor(
      pageCountFromDocument(doc) || numberValue(fallbackPageCount) || 0,
    ),
  );
  if (pageCount <= 0) return null;

  let processedPages: Promise<ProcessedPageCollection | null> | null = null;
  const readProcessedPages = async () => {
    if (!doc?.getProcessedData) return null;
    if (!processedPages) {
      processedPages = doc
        .getProcessedData()
        .then((data) => data?.pages ?? null)
        .catch(() => null);
    }
    return processedPages;
  };

  return {
    pageCount,
    async getPageBundle(pageIndex, pageLabel) {
      const pages = await readProcessedPages();
      const pageData =
        processedPageAt(pages, pageIndex) ??
        (doc?.getPageData
          ? await doc.getPageData({ pageIndex }).catch(() => null)
          : null);
      return buildProcessedPageBundle(
        pageData,
        pageIndex,
        pageLabel,
        await viewBoxFromDocument(doc, pageIndex),
      );
    },
    getPageLabels: () => readDocumentPageLabels(doc, pageCount),
  };
}

function documentSource(pdfDocument: unknown): PdfPageSource | null {
  const doc = pdfDocument as PdfDocumentLike | null;
  if (!doc || typeof doc.getPage !== "function") return null;
  const getPage = doc.getPage.bind(doc);
  const pageCount = pageCountFromDocument(doc);
  if (pageCount <= 0) return null;
  return {
    pageCount,
    getPage: (pageIndex) => getPage(pageIndex + 1),
    getPageLabels: () => readDocumentPageLabels(doc, pageCount),
  };
}

function pageViewSource(pdfViewer: unknown): PdfPageSource | null {
  const viewer = pdfViewer as {
    pagesCount?: number;
    _pages?: Array<Record<string, unknown> & { pdfPage?: PdfPageLike }>;
    getPageView?: (
      pageIndex: number,
    ) => (Record<string, unknown> & { pdfPage?: PdfPageLike }) | null;
  } | null;
  if (!viewer) return null;
  const pageCount = Math.max(
    0,
    Math.floor(
      numberValue(viewer.pagesCount) ?? numberValue(viewer._pages?.length) ?? 0,
    ),
  );
  if (pageCount <= 0) return null;
  return {
    pageCount,
    async getPage(pageIndex) {
      const pageView =
        viewer.getPageView?.(pageIndex) ?? viewer._pages?.[pageIndex];
      const page = pageView?.pdfPage;
      if (!page || typeof page.getTextContent !== "function") {
        throw new Error(`PDF page ${pageIndex + 1} is not loaded yet.`);
      }
      const fallbackViewBox = viewBoxFromPageView(pageView);
      return fallbackViewBox && !pageViewBox(page)
        ? { ...page, view: fallbackViewBox }
        : page;
    },
    getPageLabels: async () => numericPageLabels(pageCount),
  };
}

function pageCountFromDocument(
  pdfDocument: PdfDocumentLike | null | undefined,
): number {
  if (!pdfDocument) return 0;
  return Math.max(
    0,
    Math.floor(
      numberValue(pdfDocument.numPages) ??
        numberValue(pdfDocument.pdfInfo?.numPages) ??
        numberValue(pdfDocument._pdfInfo?.numPages) ??
        0,
    ),
  );
}

function hasProcessedPageAPI(
  pdfDocument: PdfDocumentLike | null | undefined,
): pdfDocument is PdfDocumentLike {
  return (
    !!pdfDocument &&
    (typeof pdfDocument.getProcessedData === "function" ||
      typeof pdfDocument.getPageData === "function")
  );
}

function processedPageCount(
  pages: ProcessedPageCollection | null | undefined,
): number {
  if (!pages) return 0;
  if (Array.isArray(pages)) return pages.length;
  const numericKeys = Object.keys(pages)
    .map((key) => Number(key))
    .filter((value) => Number.isInteger(value) && value >= 0);
  return numericKeys.length ? Math.max(...numericKeys) + 1 : 0;
}

function processedPageAt(
  pages: ProcessedPageCollection | null | undefined,
  pageIndex: number,
): ProcessedPageLike | null {
  if (!pages) return null;
  const page = Array.isArray(pages)
    ? pages[pageIndex]
    : pages[String(pageIndex)];
  return page && typeof page === "object" ? page : null;
}

function labelsFromArray(
  labels: Array<string | null>,
  pageCount: number,
): string[] {
  return Array.from({ length: pageCount }, (_, index) =>
    labels[index] ? String(labels[index]) : String(index + 1),
  );
}

function numericPageLabels(pageCount: number): string[] {
  return Array.from({ length: pageCount }, (_, index) => String(index + 1));
}

function rectValue(value: unknown): PdfRect | null {
  if (!Array.isArray(value) || value.length < 4) return null;
  const rect = value.slice(0, 4).map((entry) => numberValue(entry));
  if (rect.some((entry) => entry == null)) return null;
  return rect as PdfRect;
}

interface SelectionRectGroup {
  pageIndex: number;
  rects: PdfRect[];
}

function selectionRectGroups(position: unknown): SelectionRectGroup[] {
  const p = position as
    | {
        pageIndex?: unknown;
        rects?: unknown;
      }
    | null
    | undefined;
  const pageIndex = numberValue(p?.pageIndex);
  const rects = rectsValue(p?.rects);
  if (pageIndex == null || pageIndex < 0 || rects.length === 0) return [];
  return [{ pageIndex: Math.floor(pageIndex), rects }];
}

function rectsValue(value: unknown): PdfRect[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => rectValue(entry))
    .filter((rect): rect is PdfRect => !!rect);
}

function extractAttachmentID(reader: unknown): number | null {
  const r = reader as {
    itemID?: number;
    _item?: { id?: number };
  } | null;
  if (typeof r?._item?.id === "number") return r._item.id;
  return typeof r?.itemID === "number" ? r.itemID : null;
}

async function readDocumentPageLabels(
  pdfDocument: PdfDocumentLike,
  pageCount: number,
): Promise<string[]> {
  try {
    const labels =
      (await pdfDocument.getPageLabels2?.()) ??
      (await pdfDocument.getPageLabels?.());
    if (Array.isArray(labels)) {
      return labelsFromArray(labels, pageCount);
    }
  } catch {
    // Fall through to numeric labels.
  }
  return numericPageLabels(pageCount);
}

async function readPageBundle(
  source: PdfPageSource,
  pageIndex: number,
  pageLabel: string,
): Promise<PageBundle | null> {
  if (source.getPageBundle) {
    return source.getPageBundle(pageIndex, pageLabel);
  }
  if (!source.getPage) return null;
  const page = await source.getPage(pageIndex);
  const textContent = await page.getTextContent({
    disableCombineTextItems: false,
  });
  const items = Array.isArray(textContent.items) ? textContent.items : [];
  let pageText = "";
  const anchors: ItemAnchor[] = [];

  items.forEach((item, itemIndex) => {
    const itemString = typeof item.str === "string" ? item.str : "";
    const start = pageText.length;
    pageText += itemString;
    const end = start + itemString.length;
    if (itemString) {
      anchors.push(
        anchorFromItem(item, itemIndex, pageIndex, start, end, itemString),
      );
    }
    if (item.hasEOL) {
      pageText += "\n";
    } else if (itemString && !/\s$/.test(itemString)) {
      pageText += " ";
    }
  });

  if (!pageText || anchors.length === 0) return null;
  const normalized = normalizeWithMap(pageText);
  return {
    pageIndex,
    pageLabel,
    pageText,
    anchors,
    normalizedText: normalized.text,
    normalizedToOriginal: normalized.map,
    viewBox: pageViewBox(page),
    source: "textContent",
  };
}

function pageViewBox(page: PdfPageLike): PdfRect | undefined {
  return (
    rectValue(page.view) ??
    rectValue(page.viewBox) ??
    rectValue(page._pageInfo?.view) ??
    rectValue(page.viewport?.viewBox) ??
    undefined
  );
}

function viewBoxFromPageView(pageView: unknown): PdfRect | undefined {
  const page = pageView as
    | {
        viewport?: { viewBox?: unknown };
        originalPage?: { viewport?: { viewBox?: unknown } };
        pdfPage?: PdfPageLike;
      }
    | null
    | undefined;
  return (
    rectValue(page?.viewport?.viewBox) ??
    rectValue(page?.originalPage?.viewport?.viewBox) ??
    (page?.pdfPage ? pageViewBox(page.pdfPage) : undefined)
  );
}

function viewBoxFromReaderView(
  view: { _pages?: unknown[] },
  apps: any[],
  pageIndex: number,
): PdfRect | undefined {
  return (
    viewBoxFromPageView(view._pages?.[pageIndex]) ??
    firstViewBox(apps.map((app) => viewBoxFromViewer(app?.pdfViewer, pageIndex)))
  );
}

function viewBoxFromViewer(
  pdfViewer: unknown,
  pageIndex: number,
): PdfRect | undefined {
  const viewer = pdfViewer as
    | {
        _pages?: unknown[];
        getPageView?: (pageIndex: number) => unknown;
      }
    | null
    | undefined;
  if (!viewer) return undefined;
  return viewBoxFromPageView(
    viewer.getPageView?.(pageIndex) ?? viewer._pages?.[pageIndex],
  );
}

function firstViewBox(values: Array<PdfRect | undefined>): PdfRect | undefined {
  return values.find((value): value is PdfRect => !!value);
}

async function viewBoxFromDocument(
  pdfDocument: PdfDocumentLike | null | undefined,
  pageIndex: number,
): Promise<PdfRect | undefined> {
  if (!pdfDocument || typeof pdfDocument.getPage !== "function") {
    return undefined;
  }
  try {
    return pageViewBox(await pdfDocument.getPage(pageIndex + 1));
  } catch {
    return undefined;
  }
}

function buildProcessedPageBundle(
  pageData: ProcessedPageLike | null | undefined,
  pageIndex: number,
  pageLabel: string,
  fallbackViewBox?: PdfRect,
): PageBundle | null {
  const chars = Array.isArray(pageData?.chars) ? pageData.chars : [];
  if (!chars.length) return null;

  let pageText = "";
  const anchors: ItemAnchor[] = [];
  chars.forEach((char, charIndex) => {
    if (char.ignorable) return;
    const charText = typeof char.c === "string" ? char.c : "";
    const start = pageText.length;
    pageText += charText;
    const end = start + charText.length;
    const rect = rectValue(char.inlineRect) ?? rectValue(char.rect);
    if (charText && rect) {
      const inlineRect = rectValue(char.inlineRect) ?? rect;
      anchors.push({
        itemIndex: charIndex,
        pageIndex,
        startOffset: start,
        endOffset: end,
        x: inlineRect[0],
        y: inlineRect[1],
        width: Math.max(0, inlineRect[2] - inlineRect[0]),
        height: Math.max(0, inlineRect[3] - inlineRect[1]),
        itemString: charText,
        lineBreakAfter: !!char.lineBreakAfter,
        paragraphBreakAfter: !!char.paragraphBreakAfter,
        source: "processed",
      });
    }
    if (char.spaceAfter || char.lineBreakAfter || char.paragraphBreakAfter) {
      pageText += " ";
    }
  });

  if (!pageText || anchors.length === 0) return null;
  const normalized = normalizeWithMap(pageText);
  return {
    pageIndex,
    pageLabel,
    pageText,
    anchors,
    normalizedText: normalized.text,
    normalizedToOriginal: normalized.map,
    viewBox: rectValue(pageData?.viewBox) ?? fallbackViewBox,
    source: "processed",
  };
}

function anchorFromItem(
  item: PdfTextItemLike,
  itemIndex: number,
  pageIndex: number,
  startOffset: number,
  endOffset: number,
  itemString: string,
): ItemAnchor {
  const transform = Array.isArray(item.transform) ? item.transform : [];
  const fontSize = Math.abs(
    numberValue(transform[3]) ?? numberValue(transform[0]) ?? 10,
  );
  return {
    itemIndex,
    pageIndex,
    startOffset,
    endOffset,
    x: numberValue(transform[4]) ?? 0,
    y: numberValue(transform[5]) ?? 0,
    width: Math.abs(
      numberValue(item.width) ?? fontSize * itemString.length * 0.5,
    ),
    height: Math.abs(numberValue(item.height) ?? fontSize),
    itemString,
  };
}

// Normalizer with offset back-mapping.
// Returns:
//   text: lowercased + ligatures expanded + zero-widths stripped + each run
//         of whitespace collapsed to a single space.
//   map:  for each char in `text`, the offset in the ORIGINAL `input` that
//         char came from. Used by `originalRangeFromNormalized` to recover
//         original-space offsets after we match in normalized space.
//
// Special-case `-\n` (hyphen at line end): both consumed, no output. WHY:
// PDFs hyphenate words across lines; preserving the hyphen would make
// "self-\nattention" fail to match "self-attention".
//
// INVARIANT: map.length === [...text].length AT EVERY POINT during build —
// used by `originalRangeFromNormalized` to find the source char of `text[i]`.
function normalizeWithMap(input: string): NormalizedText {
  const chars: string[] = [];
  const map: number[] = [];
  let pendingSpaceOffset: number | null = null;
  let index = 0;

  const pushSpace = () => {
    if (pendingSpaceOffset == null) return;
    if (chars.length > 0 && chars[chars.length - 1] !== " ") {
      chars.push(" ");
      map.push(pendingSpaceOffset);
    }
    pendingSpaceOffset = null;
  };

  while (index < input.length) {
    const hyphenBreakEnd = hyphenBreakEndAt(input, index);
    if (hyphenBreakEnd > index) {
      index = hyphenBreakEnd;
      continue;
    }

    const codePoint = input.codePointAt(index);
    if (codePoint == null) break;
    const rawChar = String.fromCodePoint(codePoint);
    const charLength = rawChar.length;

    if (isZeroWidth(rawChar)) {
      index += charLength;
      continue;
    }

    if (/\s/u.test(rawChar)) {
      if (pendingSpaceOffset == null) pendingSpaceOffset = index;
      index += charLength;
      continue;
    }

    pushSpace();
    for (const char of expandNormalizedChar(rawChar)) {
      if (/\s/u.test(char)) {
        if (pendingSpaceOffset == null) pendingSpaceOffset = index;
      } else {
        chars.push(char);
        map.push(index);
      }
    }
    index += charLength;
  }

  if (chars[chars.length - 1] === " ") {
    chars.pop();
    map.pop();
  }

  return { text: chars.join(""), map };
}

function hyphenBreakEndAt(input: string, index: number): number {
  if (input[index] !== "-") return -1;
  let cursor = index + 1;
  while (cursor < input.length && isHorizontalSpace(input[cursor])) cursor++;
  const newlineEnd = newlineEndAt(input, cursor);
  if (newlineEnd < 0) return -1;
  cursor = newlineEnd;
  while (cursor < input.length && /\s/u.test(input[cursor])) cursor++;
  return cursor;
}

function newlineEndAt(input: string, index: number): number {
  if (input[index] === "\r" && input[index + 1] === "\n") return index + 2;
  if (input[index] === "\r" || input[index] === "\n") return index + 1;
  return -1;
}

function isHorizontalSpace(char: string): boolean {
  return char === " " || char === "\t" || char === "\f" || char === "\v";
}

function expandNormalizedChar(char: string): string[] {
  const expanded = LIGATURES[char] ?? char.normalize("NFKC");
  const lower = expanded.toLowerCase();
  const output: string[] = [];
  for (const normalizedChar of Array.from(lower)) {
    output.push(...Array.from(LIGATURES[normalizedChar] ?? normalizedChar));
  }
  return output;
}

function isZeroWidth(char: string): boolean {
  return (
    char === "\u200b" ||
    char === "\u200c" ||
    char === "\u200d" ||
    char === "\ufeff"
  );
}

function debugPdfLocator(label: string, detail: unknown): void {
  try {
    (globalThis as any).Zotero?.debug?.(
      `[zai-debug] pdf-locator.${label} ${JSON.stringify(detail)}`,
    );
  } catch {
    // Diagnostics should never affect PDF selection extraction.
  }
}

function debugTextInfo(text: string): { length: number; head: string } {
  const head = text.replace(/\s+/g, " ").trim().slice(0, 160);
  return { length: text.length, head };
}

// Fuzzy match: slide a needle-sized window across the page in coarse
// strides and pick the highest-confidence window. Confidence = 1 - (edit
// distance / max(window, needle)).
// WHY stride = needleLength / 4 (not 1): full O(N·k) Levenshtein over every
// offset would be too slow for long pages. A stride of needle/4 still finds
// the optimum window within a few characters, and the misalignment is
// absorbed by Levenshtein insertions/deletions on the boundaries.
// GOTCHA: this CANNOT find a match shorter than `needleLength` — by design,
// since the caller wants a passage of roughly the needle's size.
function fuzzyNormalizedMatch(
  page: PageBundle,
  normalizedNeedle: string,
): NormalizedMatch | null {
  const haystack = page.normalizedText;
  const needleLength = normalizedNeedle.length;
  if (!haystack || needleLength === 0) return null;

  const step = Math.max(1, Math.floor(needleLength / 4));
  let best: NormalizedMatch | null = null;
  for (let start = 0; start < haystack.length; start += step) {
    const end = Math.min(haystack.length, start + needleLength);
    if (end <= start) continue;
    const candidate = haystack.slice(start, end);
    const distance = levenshteinDistance(candidate, normalizedNeedle);
    const confidence = 1 - distance / Math.max(candidate.length, needleLength);
    if (!best || confidence > best.confidence) {
      best = {
        page,
        normalizedStart: start,
        normalizedEnd: end,
        confidence,
      };
    }
  }
  return best;
}

function levenshteinDistance(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let i = 0; i < left.length; i++) {
    const current = [i + 1];
    for (let j = 0; j < right.length; j++) {
      const cost = left[i] === right[j] ? 0 : 1;
      current[j + 1] = Math.min(
        current[j] + 1,
        previous[j + 1] + 1,
        previous[j] + cost,
      );
    }
    previous = current;
  }
  return previous[right.length];
}

async function locateOnPage(
  page: PageBundle,
  normalizedStart: number,
  normalizedEnd: number,
  confidence: number,
  pageGlobalOffset: number,
): Promise<LocateResult | null> {
  const range = originalRangeFromNormalized(
    page.pageText,
    page.normalizedToOriginal,
    normalizedStart,
    normalizedEnd,
  );
  if (!range) return null;

  const rects = rectsForRange(page.anchors, range.start, range.end);
  if (rects.length === 0) return null;

  const matchedText = page.pageText
    .slice(range.start, range.end)
    .replace(/\s+/g, " ")
    .trim();
  const top = sortTopForPage(page, rects);
  const offsets = processedSelectionOffsetsForRange(
    page,
    range.start,
    range.end,
  );
  return {
    pageIndex: page.pageIndex,
    pageLabel: page.pageLabel,
    rects,
    sortIndex: buildSortIndex(
      page.pageIndex,
      sortOffsetForRange(page, range.start, range.end, pageGlobalOffset),
      top,
    ),
    matchedText,
    confidence,
    ...(offsets
      ? { anchorOffset: offsets[0], headOffset: offsets[1] }
      : {}),
  };
}

function processedSelectionOffsetsForRange(
  page: PageBundle,
  rangeStart: number,
  rangeEnd: number,
): [number, number] | null {
  if (page.source !== "processed") return null;
  const overlapping = page.anchors.filter(
    (anchor) => anchor.startOffset < rangeEnd && anchor.endOffset > rangeStart,
  );
  if (!overlapping.length) return null;
  const anchorOffset = Math.min(...overlapping.map((anchor) => anchor.itemIndex));
  const headOffset =
    Math.max(...overlapping.map((anchor) => anchor.itemIndex)) + 1;
  return headOffset > anchorOffset ? [anchorOffset, headOffset] : null;
}

// Sort offset semantics differ between the two source types:
// - "processed": offset is the FIRST char's `itemIndex` in the page's char
//   stream — Zotero's native annotation sort comparator expects this for
//   processed-page annotations.
// - "textContent" (PDF.js fallback): offset is a document-wide char index
//   (cumulativeOffset + rangeStart). WHY document-wide: Zotero compares
//   sortIndex strings lexicographically, so per-page-relative offsets
//   would sort the same value across different pages incorrectly.
function sortOffsetForRange(
  page: PageBundle,
  rangeStart: number,
  rangeEnd: number,
  pageGlobalOffset: number,
): number {
  if (page.source === "processed") {
    const first = page.anchors.find(
      (anchor) =>
        anchor.startOffset < rangeEnd && anchor.endOffset > rangeStart,
    );
    return first?.itemIndex ?? 0;
  }
  return pageGlobalOffset + rangeStart;
}

function sortTopForPage(page: PageBundle, rects: PdfRect[]): number {
  const y2 = Math.max(...rects.map((rect) => rect[3]));
  if (page.viewBox) {
    const pageHeight = page.viewBox[3] - page.viewBox[1];
    return Math.max(0, pageHeight - y2);
  }
  return y2;
}

function originalRangeFromNormalized(
  original: string,
  map: number[],
  normalizedStart: number,
  normalizedEnd: number,
): { start: number; end: number } | null {
  const start = map[normalizedStart];
  const last = map[normalizedEnd - 1];
  if (start == null || last == null) return null;
  return {
    start,
    end: Math.min(original.length, last + charLengthAt(original, last)),
  };
}

function charLengthAt(text: string, offset: number): number {
  const codePoint = text.codePointAt(offset);
  if (codePoint == null) return 1;
  return codePoint > 0xffff ? 2 : 1;
}

function rectsForRange(
  anchors: ItemAnchor[],
  matchStart: number,
  matchEnd: number,
): PdfRect[] {
  const parts = anchors
    .map((anchor) => {
      const rect = anchorPartialRect(anchor, matchStart, matchEnd);
      return rect ? { rect, itemIndex: anchor.itemIndex } : null;
    })
    .filter((part): part is RectPart => !!part);
  if (!parts.length) return [];
  return mergeRectParts(parts);
}

interface SentenceSegment {
  text: string;
  startAnchor: number;
  endAnchor: number;
  paragraphStartAnchor: number;
  paragraphEndAnchor: number;
}

function sentenceAtPointOnPage(
  page: PageBundle,
  point: { x: number; y: number },
  pageGlobalOffset: number,
): LocatedSentence | null {
  const anchorIndex = closestAnchorIndex(page.anchors, point);
  if (anchorIndex == null) return null;
  const segments = sentenceSegmentsForPage(page);
  if (!segments.length) return null;
  const segment =
    segments.find(
      (entry) => anchorIndex >= entry.startAnchor && anchorIndex <= entry.endAnchor,
    ) ?? closestSentenceSegment(segments, anchorIndex);
  return segment
    ? locatedSentenceFromSegment(page, segments, segment, pageGlobalOffset)
    : null;
}

function sentenceAtIndexOnPage(
  page: PageBundle,
  sentenceIndex: number,
  pageGlobalOffset: number,
): LocatedSentence | null {
  const segments = sentenceSegmentsForPage(page);
  const segment = Number.isInteger(sentenceIndex)
    ? segments[sentenceIndex]
    : undefined;
  return segment
    ? locatedSentenceFromSegment(page, segments, segment, pageGlobalOffset)
    : null;
}

function paragraphAtPointOnPage(
  page: PageBundle,
  point: { x: number; y: number },
  pageGlobalOffset: number,
): LocatedSentence | null {
  const ranges = paragraphAnchorRanges(page.anchors);
  if (!ranges.length) return null;
  const anchorIndex = closestAnchorIndex(page.anchors, point);
  if (anchorIndex == null) return null;
  let index = ranges.findIndex(
    ([start, end]) => anchorIndex >= start && anchorIndex <= end,
  );
  if (index < 0) index = closestParagraphRangeIndex(ranges, anchorIndex);
  return index >= 0
    ? locatedParagraphFromRange(page, ranges, index, pageGlobalOffset)
    : null;
}

function paragraphAtIndexOnPage(
  page: PageBundle,
  paragraphIndex: number,
  pageGlobalOffset: number,
): LocatedSentence | null {
  const ranges = paragraphAnchorRanges(page.anchors);
  return Number.isInteger(paragraphIndex)
    ? locatedParagraphFromRange(page, ranges, paragraphIndex, pageGlobalOffset)
    : null;
}

function closestParagraphRangeIndex(
  ranges: Array<[number, number]>,
  anchorIndex: number,
): number {
  let best = -1;
  let bestDistance = Infinity;
  ranges.forEach(([start, end], index) => {
    const distance =
      anchorIndex < start
        ? start - anchorIndex
        : anchorIndex > end
          ? anchorIndex - end
          : 0;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

// Build a LocatedSentence that spans a whole paragraph (anchor range): merged
// rects + full paragraph text. pageSentenceIndex/Count carry the PARAGRAPH
// index/count so the translate card steps paragraph-by-paragraph.
function locatedParagraphFromRange(
  page: PageBundle,
  ranges: Array<[number, number]>,
  rangeIndex: number,
  pageGlobalOffset: number,
): LocatedSentence | null {
  const range = ranges[rangeIndex];
  if (!range) return null;
  const [startAnchor, endAnchor] = range;
  const start = page.anchors[startAnchor]?.startOffset;
  const end = page.anchors[endAnchor]?.endOffset;
  if (start == null || end == null || end <= start) return null;
  const rects = rectsForRange(page.anchors, start, end);
  if (!rects.length) return null;
  const text = page.pageText.slice(start, end).replace(/\s+/g, " ").trim();
  if (!text) return null;
  const sortTop = sortTopForPage(page, rects);
  return {
    text,
    pageIndex: page.pageIndex,
    pageLabel: page.pageLabel,
    rects,
    sortIndex: buildSortIndex(
      page.pageIndex,
      sortOffsetForRange(page, start, end, pageGlobalOffset),
      sortTop,
    ),
    pageSentenceIndex: rangeIndex,
    pageSentenceCount: ranges.length,
    paragraphContext: text,
    rangeStart: start,
    rangeEnd: end,
    sortTop,
  };
}

function locatedSentenceFromSegment(
  page: PageBundle,
  segments: SentenceSegment[],
  segment: SentenceSegment,
  pageGlobalOffset: number,
): LocatedSentence | null {
  const start = page.anchors[segment.startAnchor]?.startOffset;
  const end = page.anchors[segment.endAnchor]?.endOffset;
  if (start == null || end == null || end <= start) return null;
  const rects = rectsForRange(page.anchors, start, end);
  if (!rects.length) return null;
  const paraStart = page.anchors[segment.paragraphStartAnchor]?.startOffset ?? start;
  const paraEnd = page.anchors[segment.paragraphEndAnchor]?.endOffset ?? end;
  const text = page.pageText.slice(start, end).replace(/\s+/g, " ").trim();
  const pageSentenceIndex = segments.indexOf(segment);
  const sortTop = sortTopForPage(page, rects);
  return {
    text: text || segment.text,
    pageIndex: page.pageIndex,
    pageLabel: page.pageLabel,
    rects,
    sortIndex: buildSortIndex(
      page.pageIndex,
      sortOffsetForRange(page, start, end, pageGlobalOffset),
      sortTop,
    ),
    pageSentenceIndex,
    pageSentenceCount: segments.length,
    paragraphContext: page.pageText
      .slice(paraStart, paraEnd)
      .replace(/\s+/g, " ")
      .trim(),
    rangeStart: start,
    rangeEnd: end,
    sortTop,
  };
}

function closestAnchorIndex(
  anchors: ItemAnchor[],
  point: { x: number; y: number },
): number | null {
  let bestIndex: number | null = null;
  let bestDistance = Infinity;
  const pointRect: PdfRect = [point.x, point.y, point.x, point.y];
  anchors.forEach((anchor, index) => {
    const distance = rectsDist(fullAnchorRect(anchor), pointRect);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });
  return bestIndex;
}

function closestSentenceSegment(
  segments: SentenceSegment[],
  anchorIndex: number,
): SentenceSegment | null {
  let best: SentenceSegment | null = null;
  let bestDistance = Infinity;
  for (const segment of segments) {
    const distance =
      anchorIndex < segment.startAnchor
        ? segment.startAnchor - anchorIndex
        : anchorIndex > segment.endAnchor
          ? anchorIndex - segment.endAnchor
          : 0;
    if (distance < bestDistance) {
      best = segment;
      bestDistance = distance;
    }
  }
  return best;
}

function sentenceSegmentsForPage(page: PageBundle): SentenceSegment[] {
  const paragraphs = paragraphAnchorRanges(page.anchors);
  const segments: SentenceSegment[] = [];
  for (const [paragraphStartAnchor, paragraphEndAnchor] of paragraphs) {
    const anchors = page.anchors.slice(
      paragraphStartAnchor,
      paragraphEndAnchor + 1,
    );
    const { text, anchorIndexByTextIndex } = segmenterTextForAnchors(
      page.pageText,
      anchors,
    );
    const raw = splitSentencesForPdfText(text);
    for (const sentence of raw) {
      const startAnchor = anchorIndexByTextRange(
        anchorIndexByTextIndex,
        sentence.start,
        sentence.end,
        true,
      );
      const endAnchor = anchorIndexByTextRange(
        anchorIndexByTextIndex,
        sentence.start,
        sentence.end,
        false,
      );
      if (startAnchor == null || endAnchor == null || endAnchor < startAnchor) {
        continue;
      }
      segments.push({
        text: sentence.text,
        startAnchor: paragraphStartAnchor + startAnchor,
        endAnchor: paragraphStartAnchor + endAnchor,
        paragraphStartAnchor,
        paragraphEndAnchor,
      });
    }
  }
  return segments;
}

function paragraphAnchorRanges(anchors: ItemAnchor[]): Array<[number, number]> {
  const lines: Array<{
    start: number;
    end: number;
    rect: PdfRect;
    text: string;
  }> = [];
  let lineStart = 0;
  const pushLine = (end: number) => {
    const lineAnchors = anchors.slice(lineStart, end + 1);
    const rects = lineAnchors.map(fullAnchorRect);
    lines.push({
      start: lineStart,
      end,
      rect: unionRects(rects),
      text: lineAnchors.map((anchor) => anchor.itemString).join("").trim(),
    });
    lineStart = end + 1;
  };
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i]!;
    if (anchor.lineBreakAfter || i === anchors.length - 1) pushLine(i);
  }
  if (!lines.length) return [];

  // Typical vertical line advance (median over same-column consecutive lines),
  // so a paragraph break can also be detected by EXTRA spacing — the cue that
  // justified papers (no first-line indent) use. Relative to the page's own
  // spacing, so it's robust to font size.
  const sameColumn = (a: { rect: PdfRect }, b: { rect: PdfRect }): boolean =>
    b.rect[0] < a.rect[2] && a.rect[0] < b.rect[2];
  const lineCenterY = (l: { rect: PdfRect }): number =>
    (l.rect[1] + l.rect[3]) / 2;
  const advances: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (sameColumn(lines[i - 1]!, lines[i]!)) {
      advances.push(
        Math.abs(lineCenterY(lines[i - 1]!) - lineCenterY(lines[i]!)),
      );
    }
  }
  const sortedAdvances = [...advances].sort((a, b) => a - b);
  const medianAdvance = sortedAdvances.length
    ? sortedAdvances[sortedAdvances.length >> 1]!
    : 0;

  // A line's column left/right margin, from the DOMINANT (frequent) line edges.
  // Body text lines all share their column's left/right margin, so those edges
  // recur on many lines; figure tick-labels, captions and equations sit at
  // scattered, infrequent positions and never form a margin. Using dominant
  // edges (NOT a raw min/max over x-overlapping lines) stops a full-width caption
  // OR a stray figure label that merely clips a column's edge from dragging the
  // margin across the page — which was making every line in a column look
  // "indented" (or "short") and inventing paragraph breaks.
  const edgeBucket = (v: number): number => Math.round(v / 3) * 3;
  const minMarginCount = Math.max(3, Math.floor(lines.length * 0.08));
  const dominantEdges = (vals: number[]): number[] => {
    const counts = new Map<number, number>();
    for (const v of vals) {
      const k = edgeBucket(v);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, c]) => c >= minMarginCount)
      .map(([x]) => x)
      .sort((a, b) => a - b);
  };
  const leftEdges = dominantEdges(lines.map((l) => l.rect[0]));
  const rightEdges = dominantEdges(lines.map((l) => l.rect[2]));
  // Drop first-line-indent margins: a left edge only a little (≤ INDENT_MAX) to
  // the right of another dominant edge is an indent, not a column body margin —
  // so an indented first line is still measured against its column's true left.
  const INDENT_MAX = 40;
  const bodyLeft = leftEdges.filter(
    (m, i) => i === 0 || m - leftEdges[i - 1]! > INDENT_MAX,
  );
  const colLeftOf = (l: { rect: PdfRect }): number => {
    let best = l.rect[0];
    for (const m of bodyLeft) if (m <= l.rect[0] + 4) best = m;
    return best;
  };
  const colRightOf = (l: { rect: PdfRect }): number => {
    for (const m of rightEdges) if (m >= l.rect[2] - 4) return m;
    return l.rect[2];
  };

  const ranges: Array<[number, number]> = [];
  let startLine = 0;
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1]!;
    const current = lines[i]!;
    const previousAnchor = anchors[prev.end]!;
    // Extra vertical space between two same-column lines, after a sentence end:
    // how justified papers (no first-line indent) separate paragraphs.
    const bigVerticalGap =
      medianAdvance > 0 &&
      sameColumn(prev, current) &&
      Math.abs(lineCenterY(prev) - lineCenterY(current)) > medianAdvance * 1.5;
    // Ragged last line: prev ends well short of its column's right margin.
    const colWidth = Math.max(1, colRightOf(prev) - colLeftOf(prev));
    const shortLastLine = colRightOf(prev) - prev.rect[2] > colWidth * 0.1;
    // 首行缩进（空两格）: current starts indented past its column's left margin
    // (> ~0.6 line height ≈ ≥1 char), the classic paragraph-start cue. Compared
    // to the column margin, not the previous line, so it's reliable.
    const lineH = Math.max(1, current.rect[3] - current.rect[1]);
    const firstLineIndent = current.rect[0] - colLeftOf(current) > lineH * 0.6;
    // NOTE: do NOT break on `current.rect[0] > prev.rect[0]` (current indented
    // vs the PREVIOUS line) — at a column boundary the next column's left edge
    // is far right of the previous column's, so that fired a false break that
    // split paragraphs spanning two columns. firstLineIndent (vs the column's
    // own left margin) detects real indentation without that side effect.
    //
    // A paragraph boundary must land at a SENTENCE start: never break right
    // before a line that begins with a lowercase letter — such a line continues
    // the previous sentence (e.g. its tail wrapping into the next column), so a
    // break there would strand a fragment at the next paragraph's start. This
    // also overrides a mis-set paragraphBreakAfter flag.
    const startsNewSentence = !/^[a-z]/.test(current.text.trim());
    const geometryBreak = firstLineIndent || bigVerticalGap || shortLastLine;
    // The paragraphBreakAfter flag is unreliable on real papers, so trust it
    // ONLY where geometry can't help: a prev line that does NOT end with
    // sentence punctuation (headings, list items, captions). When prev DOES end
    // a sentence, ignore the flag and require a GEOMETRY cue (indent / extra
    // spacing / short last line) — that's what distinguishes a true paragraph
    // end from a mid-paragraph sentence end, which the flag often gets wrong (it
    // both misses real breaks and invents false ones). And never break before a
    // line that begins lowercase (it continues the previous sentence).
    const hasBreak =
      startsNewSentence &&
      ((previousAnchor.paragraphBreakAfter && !lineEndsSentence(prev.text)) ||
        (previousAnchor.lineBreakAfter &&
          lineEndsSentence(prev.text) &&
          geometryBreak));
    if (hasBreak) {
      ranges.push([lines[startLine]!.start, prev.end]);
      startLine = i;
    }
  }
  ranges.push([lines[startLine]!.start, lines[lines.length - 1]!.end]);
  return ranges;
}

function lineEndsSentence(text: string): boolean {
  return /[.!?。？！][)"'\]\u2019\u201d]*$/.test(text.trim());
}

function unionRects(rects: PdfRect[]): PdfRect {
  return [
    Math.min(...rects.map((rect) => rect[0])),
    Math.min(...rects.map((rect) => rect[1])),
    Math.max(...rects.map((rect) => rect[2])),
    Math.max(...rects.map((rect) => rect[3])),
  ];
}

function segmenterTextForAnchors(
  pageText: string,
  anchors: ItemAnchor[],
): {
  text: string;
  anchorIndexByTextIndex: number[];
} {
  const parts: string[] = [];
  const anchorIndexByTextIndex: number[] = [];
  let length = 0;
  anchors.forEach((anchor, index) => {
    for (let j = 0; j < anchor.itemString.length; j++) {
      anchorIndexByTextIndex[length + j] = index;
    }
    parts.push(anchor.itemString);
    length += anchor.itemString.length;

    const next = anchors[index + 1];
    const gap = next
      ? pageText.slice(anchor.endOffset, next.startOffset).replace(/\s/g, " ")
      : "";
    // Zotero stores word/line gaps as char flags; pageText already expands
    // those gaps, so use anchor offsets to preserve them for sentence splits.
    if (gap) {
      parts.push(gap);
      length += gap.length;
    }
  });
  return {
    text: parts.join(""),
    anchorIndexByTextIndex,
  };
}

function splitSentencesForPdfText(
  text: string,
): Array<{ text: string; start: number; end: number }> {
  return splitSentences(text).filter(
    (segment) => segment.end > segment.start && segment.text.trim(),
  );
}

function anchorIndexByTextRange(
  map: number[],
  start: number,
  end: number,
  forward: boolean,
): number | null {
  let i = forward ? start : end - 1;
  const step = forward ? 1 : -1;
  const stop = forward ? end : start - 1;
  for (; i !== stop; i += step) {
    if (map[i] !== undefined) return map[i]!;
  }
  return null;
}

interface RectPart {
  rect: PdfRect;
  itemIndex: number;
}

// Build rectangles for the exact text segments, not a single min/max block.
// This matters for two-column PDFs: a sentence can wrap from the bottom of
// the left column to the top of the right column, and one union rectangle
// would cover unrelated text between those two visual positions.
function mergeRectParts(parts: RectPart[]): PdfRect[] {
  const rows = groupRectPartsByY(parts);
  const rects: PdfRect[] = [];

  for (const row of rows) {
    const sorted = row
      .slice()
      .sort((a, b) => a.rect[0] - b.rect[0] || a.itemIndex - b.itemIndex);
    let current: PdfRect | null = null;

    for (const part of sorted) {
      if (current && shouldMergeInline(current, part.rect)) {
        current = unionRect(current, part.rect);
        continue;
      }
      if (current) rects.push(roundRect(current));
      current = part.rect;
    }

    if (current) rects.push(roundRect(current));
  }

  return rects;
}

function groupRectPartsByY(parts: RectPart[]): RectPart[][] {
  const sorted = parts
    .slice()
    .sort(
      (a, b) =>
        rectMidY(b.rect) - rectMidY(a.rect) ||
        a.rect[0] - b.rect[0] ||
        a.itemIndex - b.itemIndex,
    );
  const rows: Array<{ y: number; parts: RectPart[] }> = [];

  for (const part of sorted) {
    const y = rectMidY(part.rect);
    const row = rows.find(
      (candidate) => Math.abs(candidate.y - y) <= LINE_Y_TOLERANCE,
    );
    if (row) {
      row.parts.push(part);
    } else {
      rows.push({ y, parts: [part] });
    }
  }

  return rows.map((row) => row.parts);
}

function shouldMergeInline(left: PdfRect, right: PdfRect): boolean {
  const gap = right[0] - left[2];
  const height = Math.max(rectHeight(left), rectHeight(right), 1);
  return gap <= Math.max(2, height * 1.5);
}

function unionRect(a: PdfRect, b: PdfRect): PdfRect {
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
}

function rectMidY(rect: PdfRect): number {
  return (rect[1] + rect[3]) / 2;
}

function rectHeight(rect: PdfRect): number {
  return Math.abs(rect[3] - rect[1]);
}

function roundRect(rect: PdfRect): PdfRect {
  return rect.map((value) => Number(value.toFixed(3))) as PdfRect;
}

// Cuts a partial rect out of one item-level anchor by linearly
// interpolating x within the anchor's width. WHY linear (not glyph-aware):
// the textContent path doesn't expose per-glyph widths, so we approximate
// monospace-style positioning. GOTCHA: this is INACCURATE for proportional
// fonts — a passage like "Wii Wii Wii" gets equal-width slices when the
// real glyphs differ. Acceptable because the highlight is shown over the
// right line and the user can always edit it in Zotero.
function anchorPartialRect(
  anchor: ItemAnchor,
  matchStart: number,
  matchEnd: number,
): PdfRect | null {
  const localStart = Math.max(0, matchStart - anchor.startOffset);
  const localEnd = Math.min(
    anchor.itemString.length,
    matchEnd - anchor.startOffset,
  );
  if (localEnd <= localStart) return null;

  const length = Math.max(1, anchor.itemString.length);
  const startX = anchor.x + (anchor.width * localStart) / length;
  const endX = anchor.x + (anchor.width * localEnd) / length;
  const y0 = Math.min(anchor.y, anchor.y + anchor.height);
  const y1 = Math.max(anchor.y, anchor.y + anchor.height);
  return [Math.min(startX, endX), y0, Math.max(startX, endX), y1];
}

interface TextSpan {
  itemIndex: number;
  startOffset: number;
  endOffset: number;
}

function extractPageTextFromSelectionRects(
  page: PageBundle,
  rects: PdfRect[],
): string {
  const lines = rects
    .map((rect) => extractSelectionRectText(page, rect))
    .filter(Boolean);
  return lines.join("\n").trim();
}

function extractBestPageTextFromSelectionRects(
  page: PageBundle,
  rects: PdfRect[],
): string {
  const flipped = flipSelectionRectsVertically(page, rects);
  if (flipped) {
    const flippedText = extractPageTextFromSelectionRects(page, flipped);
    if (isPlausibleSelectionRectText(flippedText)) return flippedText;
  }

  const direct = extractPageTextFromSelectionRects(page, rects);
  if (isPlausibleSelectionRectText(direct)) return direct;

  return flipped ? extractPageTextFromSelectionRects(page, flipped) : direct;
}

function isPlausibleSelectionRectText(text: string): boolean {
  if (!text.trim()) return false;
  const chars = Array.from(text);
  if (chars.length < 3) return true;
  const printable = chars.filter(
    (char) => /\p{L}|\p{N}|\p{P}|\p{S}|\s/u.test(char) && char !== "\u0000",
  ).length;
  return printable / chars.length >= 0.8;
}

function flipSelectionRectsVertically(
  page: PageBundle,
  rects: PdfRect[],
): PdfRect[] | null {
  const viewBox = page.viewBox;
  if (!viewBox) return null;
  const minY = Math.min(viewBox[1], viewBox[3]);
  const maxY = Math.max(viewBox[1], viewBox[3]);
  return rects.map((rect) => [
    rect[0],
    minY + maxY - rect[3],
    rect[2],
    minY + maxY - rect[1],
  ]);
}

function extractSelectionRectText(page: PageBundle, rect: PdfRect): string {
  const spans = page.anchors
    .map((anchor) => selectionSpanForAnchor(anchor, rect))
    .filter((span): span is TextSpan => !!span)
    .sort((a, b) => a.itemIndex - b.itemIndex);
  if (!spans.length) return "";
  return textFromSpans(page.pageText, spans);
}

function selectionSpanForAnchor(
  anchor: ItemAnchor,
  selectionRect: PdfRect,
): TextSpan | null {
  const anchorRect = fullAnchorRect(anchor);
  if (!rectsOverlap(anchorRect, selectionRect)) return null;
  const yOverlap = intervalOverlap(
    anchorRect[1],
    anchorRect[3],
    selectionRect[1],
    selectionRect[3],
    SELECTION_RECT_TOLERANCE,
  );
  const anchorHeight = Math.max(rectHeight(anchorRect), 1);
  if (yOverlap / anchorHeight < 0.25) return null;

  const xOverlap = intervalOverlap(
    anchorRect[0],
    anchorRect[2],
    selectionRect[0],
    selectionRect[2],
    SELECTION_RECT_TOLERANCE,
  );
  if (xOverlap <= 0) return null;

  const span = partialAnchorTextSpan(anchor, selectionRect);
  return span.endOffset > span.startOffset ? span : null;
}

function partialAnchorTextSpan(
  anchor: ItemAnchor,
  selectionRect: PdfRect,
): TextSpan {
  if (anchor.source === "processed" || anchor.itemString.length <= 1) {
    return {
      itemIndex: anchor.itemIndex,
      startOffset: anchor.startOffset,
      endOffset: anchor.endOffset,
    };
  }

  const length = Math.max(1, anchor.itemString.length);
  const width = Math.max(Math.abs(anchor.width), 1);
  const left = Math.min(anchor.x, anchor.x + anchor.width);
  const right = Math.max(anchor.x, anchor.x + anchor.width);
  const selectionLeft = Math.min(selectionRect[0], selectionRect[2]);
  const selectionRight = Math.max(selectionRect[0], selectionRect[2]);
  const startRatio = clamp01((selectionLeft - left) / width);
  const endRatio = clamp01((selectionRight - left) / width);
  const startOffset =
    anchor.startOffset + Math.max(0, Math.floor(startRatio * length));
  const endOffset =
    anchor.startOffset + Math.min(length, Math.ceil(endRatio * length));

  // If the rect covers the anchor but x ordering was inverted, fall back to
  // the full item instead of returning an empty slice.
  if (
    endOffset <= startOffset &&
    selectionLeft <= right &&
    selectionRight >= left
  ) {
    return {
      itemIndex: anchor.itemIndex,
      startOffset: anchor.startOffset,
      endOffset: anchor.endOffset,
    };
  }

  return { itemIndex: anchor.itemIndex, startOffset, endOffset };
}

function textFromSpans(pageText: string, spans: TextSpan[]): string {
  let output = "";
  let cursor: number | null = null;
  for (const span of spans) {
    const start = Math.max(0, Math.min(pageText.length, span.startOffset));
    const end = Math.max(start, Math.min(pageText.length, span.endOffset));
    if (cursor != null && start > cursor) {
      const gap = pageText.slice(cursor, start);
      output += /\S/.test(gap) ? " " : gap;
    }
    output += pageText.slice(start, end);
    cursor = Math.max(cursor ?? 0, end);
  }
  return output.replace(/[ \t\f\v]+/g, " ").trim();
}

function fullAnchorRect(anchor: ItemAnchor): PdfRect {
  const partial = anchorPartialRect(
    anchor,
    anchor.startOffset,
    anchor.endOffset,
  );
  return (
    partial ?? [
      anchor.x,
      anchor.y,
      anchor.x + anchor.width,
      anchor.y + anchor.height,
    ]
  );
}

function closestTextOffset(
  anchors: ItemAnchor[],
  point: { x: number; y: number },
): number | null {
  let best: ItemAnchor | null = null;
  let bestDistance = Infinity;
  const pointRect: PdfRect = [point.x, point.y, point.x, point.y];
  for (const anchor of anchors) {
    const distance = rectsDist(fullAnchorRect(anchor), pointRect);
    if (distance < bestDistance) {
      best = anchor;
      bestDistance = distance;
    }
  }
  if (!best) return null;
  if (best.source === "processed" || best.itemString.length <= 1) {
    return best.startOffset;
  }
  const left = Math.min(best.x, best.x + best.width);
  const width = Math.max(Math.abs(best.width), 1);
  const ratio = clamp01((point.x - left) / width);
  const localOffset = Math.floor(ratio * best.itemString.length);
  return Math.min(best.endOffset - 1, best.startOffset + localOffset);
}

function rectsDist(a: PdfRect, b: PdfRect): number {
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

function rectsOverlap(a: PdfRect, b: PdfRect): boolean {
  return (
    intervalOverlap(a[0], a[2], b[0], b[2], SELECTION_RECT_TOLERANCE) > 0 &&
    intervalOverlap(a[1], a[3], b[1], b[3], SELECTION_RECT_TOLERANCE) > 0
  );
}

function intervalOverlap(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  tolerance = 0,
): number {
  const left = Math.max(Math.min(a0, a1), Math.min(b0, b1) - tolerance);
  const right = Math.min(Math.max(a0, a1), Math.max(b0, b1) + tolerance);
  return Math.max(0, right - left);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

// Zotero's annotation sort key. Format: "PPPPP|OOOOOO|TTTTT" — three
// zero-padded numeric fields joined with "|". Lexicographic order on this
// string yields reading order: by page, then by stream/char offset, then
// by Y position within the page.
// REF: Zotero source `chrome/content/zotero/elements/annotation-row.js`.
function buildSortIndex(
  pageIndex: number,
  offset: number,
  top: number,
): string {
  return [
    String(pageIndex).padStart(5, "0"),
    String(offset).padStart(6, "0"),
    String(Math.floor(top)).padStart(5, "0"),
  ].join("|");
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
