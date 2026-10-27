import { getPdfViewerApplication } from "./pdf-viewer-application";
import { readerRectInHost, sameReaderWindow } from "./floating-pdf-alignment";
import type { AdaptivePdfMetrics } from "./adaptive-chat-layout";
import { visiblePdfWidth, type PdfReadingViewport } from "./pdf-visible-width";
/** Measure bounded, fully rendered edge strips; never infer margins from text alone. */
function blankColumns(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  fromRight: boolean,
): number {
  for (let edge = 0; edge < width; edge++) {
    const x = fromRight ? width - edge - 1 : edge;
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] > 32 && Math.min(data[i], data[i + 1], data[i + 2]) < 245)
        return edge;
    }
  }
  return width;
}
export function blankRightColumns(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  return blankColumns(data, width, height, true);
}
export function blankLeftColumns(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  return blankColumns(data, width, height, false);
}

export function createPdfRightMargin(options: { preserveZoom?: boolean } = {}) {
  const pages = new Map<
    HTMLElement,
    {
      value: string;
      priority: string;
      left: string;
      leftPriority: string;
      leftBlankAtScaleOne?: number;
      rightBlankAtScaleOne?: number;
    }
  >();
  interface Viewer {
    currentScale: number;
    currentScaleValue: string | number;
    currentPageNumber: number;
    pagesCount?: number;
    getPageView?(index: number): { viewport?: { width: number } } | null;
  }
  const fits = new Map<
    Document,
    {
      viewer: Viewer;
      original: string | number;
      lastScale: number;
      pageWidthAtScaleOne: number;
      availableWidth: number;
      manual: boolean;
    }
  >();
  const restoreFit = (doc: Document) => {
    const fit = fits.get(doc)!;
    try {
      if (
        !fit.manual &&
        Math.abs(fit.viewer.currentScale - fit.lastScale) < 0.01
      )
        fit.viewer.currentScaleValue = fit.original;
    } catch {
      /* The reader may already be destroyed when its tab closes. */
    }
    fits.delete(doc);
  };

  const fitToWidth = (
    doc: Document,
    viewer: Viewer,
    container: HTMLElement | null,
    available: number,
    pageWidth?: number,
  ) => {
    const scale = viewer.currentScale;
    let fit = fits.get(doc);
    if (fit && Math.abs(scale - fit.lastScale) > 0.01) fit.manual = true;
    if (available <= 40 || !Number.isFinite(scale) || scale <= 0 || fit?.manual)
      return;
    if (!fit) {
      if (!pageWidth || !Number.isFinite(pageWidth)) return;
      fit = {
        viewer,
        original: viewer.currentScaleValue,
        lastScale: scale,
        pageWidthAtScaleOne: pageWidth / scale,
        availableWidth: 0,
        manual: false,
      };
      fits.set(doc, fit);
    }
    // Scroll position never changes this reference width; only the viewport can.
    if (Math.abs(available - fit.availableWidth) <= 2) return;
    fit.availableWidth = available;
    const next = (available - 20) / fit.pageWidthAtScaleOne;
    if (Math.abs(next / scale - 1) <= 0.02) return;
    if (container) container.scrollLeft = 0;
    viewer.currentScaleValue = next;
    fit.lastScale = viewer.currentScale;
    if (container) container.scrollLeft = 0;
  };

  const styles = new Map<Document, Element>();
  const sharedMargins = new Map<Document, { left: number; right: number }>();
  const measured = new WeakMap<
    HTMLCanvasElement,
    { width: number; height: number; columns: number; leftColumns: number }
  >();
  const restore = (page: HTMLElement) => {
    const before = pages.get(page)!;
    if (before.value)
      page.style.setProperty("margin-right", before.value, before.priority);
    else page.style.removeProperty("margin-right");
    if (before.left)
      page.style.setProperty("margin-left", before.left, before.leftPriority);
    else page.style.removeProperty("margin-left");
    pages.delete(page);
  };
  const sync = (
    windows: Window[],
    enabled: boolean,
    viewport?: PdfReadingViewport,
  ) => {
    const metrics: AdaptivePdfMetrics[] = [];
    const active = new Set<Document>(
      enabled
        ? windows
            .map((win) => win.document)
            .filter((doc): doc is Document => !!doc)
        : [],
    );
    for (const doc of fits.keys()) if (!active.has(doc)) restoreFit(doc);
    for (const doc of sharedMargins.keys())
      if (!active.has(doc)) sharedMargins.delete(doc);
    for (const [doc, style] of styles) {
      if (active.has(doc)) continue;
      style.remove();
      styles.delete(doc);
    }
    const activePages = new Set<HTMLElement>();
    for (const doc of active) {
      const container = doc.getElementById(
        "viewerContainer",
      ) as HTMLElement | null;
      const view =
        windows.find((window) => sameReaderWindow(window, doc.defaultView)) ??
        doc.defaultView;
      const visibleWidth =
        viewport && container && view
          ? visiblePdfWidth(view, container, windows, viewport)
          : null;
      const css =
        ".pdfViewer:not(.scrollHorizontal):not(.scrollWrapped) { padding-left: 2px !important; padding-right: 2px !important; }" +
        (visibleWidth
          ? `\n#viewerContainer { max-width: ${visibleWidth}px !important; }`
          : "");
      let style = styles.get(doc);
      if (!style) {
        style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
        const parent = doc.head ?? doc.documentElement;
        if (!parent) continue;
        parent.append(style);
        styles.set(doc, style);
      }
      if (style.textContent !== css) style.textContent = css;
      const candidates = Array.from(
        doc.querySelectorAll(
          ".pdfViewer:not(.scrollHorizontal):not(.scrollWrapped) > .page",
        ),
      ) as HTMLElement[];
      const viewer = view
        ? getPdfViewerApplication<{ pdfViewer?: Viewer }>(view)?.pdfViewer
        : undefined;
      const available = viewport
        ? Math.min(container?.clientWidth ?? 0, visibleWidth ?? 0)
        : (container?.clientWidth ?? 0);
      // Reuse a measured reference during redraws instead of waiting for a canvas.
      if (viewer && !options.preserveZoom)
        fitToWidth(doc, viewer, container, available);
      let pageWidthAtScaleOne = 0;
      if (options.preserveZoom && viewer && viewer.currentScale > 0) {
        for (let i = 0; i < (viewer.pagesCount ?? 0); i++) {
          const width = viewer.getPageView?.(i)?.viewport?.width;
          if (width != null && Number.isFinite(width) && width > 0)
            pageWidthAtScaleOne = Math.max(
              pageWidthAtScaleOne,
              width / viewer.currentScale,
            );
        }
      }
      const shared = sharedMargins.get(doc);
      let commonLeft = shared?.left ?? Infinity,
        commonRight = shared?.right ?? Infinity;
      let contentWidthAtScaleOne = 0;
      let fitted = false;
      for (const page of candidates) {
        if (page.classList.contains("loading")) {
          const previous = pages.get(page);
          if (previous) {
            commonLeft = Math.min(
              commonLeft,
              previous.leftBlankAtScaleOne ?? 0,
            );
            commonRight = Math.min(
              commonRight,
              previous.rightBlankAtScaleOne ?? 0,
            );
            const scale = viewer?.currentScale ?? 0;
            if (
              scale > 0 &&
              previous.leftBlankAtScaleOne != null &&
              previous.rightBlankAtScaleOne != null
            ) {
              page.style.setProperty(
                "margin-left",
                `${-Math.max(0, previous.leftBlankAtScaleOne * scale - 8)}px`,
                "important",
              );
              page.style.setProperty(
                "margin-right",
                `${-Math.max(0, previous.rightBlankAtScaleOne * scale - 8)}px`,
                "important",
              );
            }
            activePages.add(page);
          }
          continue;
        }
        const canvas = page.querySelector<HTMLCanvasElement>(
          "canvas:not([hidden]):not([zooming])",
        );
        if (!canvas || !canvas.width || !canvas.height) continue;
        const cssWidth = canvas.getBoundingClientRect().width;
        if (!Number.isFinite(cssWidth) || cssWidth <= 0) continue;
        let cached = measured.get(canvas);
        if (
          !cached ||
          cached.width !== canvas.width ||
          cached.height !== canvas.height
        ) {
          const width = Math.max(1, Math.floor(canvas.width * 0.15));
          let columns = 0,
            leftColumns = 0;
          try {
            const context = canvas.getContext(
              "2d",
            ) as CanvasRenderingContext2D | null;
            const pixels = context?.getImageData(
              canvas.width - width,
              0,
              width,
              canvas.height,
            );
            if (pixels)
              columns = blankRightColumns(pixels.data, width, canvas.height);
            const leftPixels = context?.getImageData(
              0,
              0,
              width,
              canvas.height,
            );
            if (leftPixels)
              leftColumns = blankLeftColumns(
                leftPixels.data,
                width,
                canvas.height,
              );
          } catch {
            /* A protected canvas keeps its native page margin. */
          }
          cached = {
            width: canvas.width,
            height: canvas.height,
            columns,
            leftColumns,
          };
          measured.set(canvas, cached);
        }
        // Keep a small safety margin beside the last rendered mark.
        const trim = Math.max(
          0,
          (cached.columns * cssWidth) / canvas.width - 8,
        );
        const leftTrim = Math.max(
          0,
          (cached.leftColumns * cssWidth) / canvas.width - 8,
        );
        const scale = viewer?.currentScale ?? 0;
        if (Number.isFinite(scale) && scale > 0) {
          pageWidthAtScaleOne = Math.max(pageWidthAtScaleOne, cssWidth / scale);
          commonLeft = Math.min(
            commonLeft,
            (cached.leftColumns * cssWidth) / canvas.width / scale,
          );
          commonRight = Math.min(
            commonRight,
            (cached.columns * cssWidth) / canvas.width / scale,
          );
        }
        const pageBounds = page.getBoundingClientRect();
        const viewportBounds = container?.getBoundingClientRect();
        const visiblePage =
          pageBounds.height > 0 && viewportBounds && viewportBounds.height > 0
            ? pageBounds.bottom > viewportBounds.top &&
              pageBounds.top < viewportBounds.bottom
            : !page.dataset.pageNumber ||
              Number(page.dataset.pageNumber) === viewer?.currentPageNumber;
        if (Number.isFinite(scale) && scale > 0 && visiblePage) {
          const inkWidth =
            cssWidth *
            (1 - (cached.columns + cached.leftColumns) / canvas.width);
          contentWidthAtScaleOne = Math.max(
            contentWidthAtScaleOne,
            inkWidth / scale,
          );
        }
        if (
          !options.preserveZoom &&
          !fitted &&
          viewer &&
          (!page.dataset.pageNumber ||
            Number(page.dataset.pageNumber) === viewer.currentPageNumber)
        ) {
          fitted = true;
          // Full paper width is the safety bound: authors, captions and diagrams
          // can extend beyond the body margins measured on the current page.
          let pageWidth = cssWidth;
          if (viewer.getPageView) {
            for (let i = 0; i < (viewer.pagesCount ?? 0); i++) {
              const width = viewer.getPageView(i)?.viewport?.width;
              if (
                typeof width === "number" &&
                Number.isFinite(width) &&
                width > pageWidth
              )
                pageWidth = width;
            }
          }
          fitToWidth(doc, viewer, container, available, pageWidth);
        }
        if (trim <= 0 && leftTrim <= 0 && !options.preserveZoom) continue;
        activePages.add(page);
        if (!pages.has(page))
          pages.set(page, {
            value: page.style.getPropertyValue("margin-right"),
            priority: page.style.getPropertyPriority("margin-right"),
            left: page.style.getPropertyValue("margin-left"),
            leftPriority: page.style.getPropertyPriority("margin-left"),
          });
        const saved = pages.get(page)!;
        if (scale > 0) {
          saved.leftBlankAtScaleOne =
            (cached.leftColumns * cssWidth) / canvas.width / scale;
          saved.rightBlankAtScaleOne =
            (cached.columns * cssWidth) / canvas.width / scale;
        }
        const value = `${-trim}px`;
        if (
          page.style.getPropertyValue("margin-right") !== value ||
          page.style.getPropertyPriority("margin-right") !== "important"
        )
          page.style.setProperty("margin-right", value, "important");
        const leftValue = `${-leftTrim}px`;
        if (
          page.style.getPropertyValue("margin-left") !== leftValue ||
          page.style.getPropertyPriority("margin-left") !== "important"
        )
          page.style.setProperty("margin-left", leftValue, "important");
      }
      // One crop origin for the document keeps equal paper sizes and page numbers aligned.
      if (
        options.preserveZoom &&
        Number.isFinite(commonLeft) &&
        Number.isFinite(commonRight)
      ) {
        const scale = viewer?.currentScale ?? 0;
        if (scale > 0) {
          sharedMargins.set(doc, { left: commonLeft, right: commonRight });
          for (const page of candidates) {
            if (!pages.has(page))
              pages.set(page, {
                value: page.style.getPropertyValue("margin-right"),
                priority: page.style.getPropertyPriority("margin-right"),
                left: page.style.getPropertyValue("margin-left"),
                leftPriority: page.style.getPropertyPriority("margin-left"),
              });
            activePages.add(page);
            page.style.setProperty(
              "margin-left",
              `${-Math.max(0, commonLeft * scale - 8)}px`,
              "important",
            );
            page.style.setProperty(
              "margin-right",
              `${-Math.max(0, commonRight * scale - 8)}px`,
              "important",
            );
          }
          if (contentWidthAtScaleOne > 0)
            contentWidthAtScaleOne = Math.max(
              contentWidthAtScaleOne,
              pageWidthAtScaleOne - commonLeft - commonRight,
            );
        }
      }
      if (
        options.preserveZoom &&
        viewport &&
        view &&
        container &&
        contentWidthAtScaleOne > 0
      ) {
        const bounds = container.getBoundingClientRect();
        const mapped = readerRectInHost(
          view,
          { left: bounds.left, top: bounds.top, width: 1, height: 1 },
          viewport.hostWindow,
          windows,
        );
        if (mapped)
          metrics.push({
            view,
            left: Math.max(0, mapped.left),
            contentWidthAtScaleOne,
            pageWidthAtScaleOne,
            cssToHost: mapped.width,
            scrollbar: Math.max(
              0,
              container.offsetWidth - container.clientWidth,
            ),
          });
      }
    }
    for (const page of pages.keys()) if (!activePages.has(page)) restore(page);
    return metrics;
  };
  return {
    sync,
    destroy() {
      sync([], false);
    },
  };
}
