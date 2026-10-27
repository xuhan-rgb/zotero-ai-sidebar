import { getPdfViewerApplication } from "./pdf-viewer-application";
import { adaptiveChatWidth } from "./adaptive-chat-width";

export interface AdaptivePdfMetrics {
  view: Window;
  left: number;
  contentWidthAtScaleOne: number;
  pageWidthAtScaleOne?: number;
  cssToHost: number;
  scrollbar: number;
}

interface PdfViewer {
  currentScale: number;
  currentScaleValue: string | number;
}

interface ReaderState {
  viewer: PdfViewer;
  originalScaleValue: string | number;
  lastScale: number;
  manual: boolean;
  layoutScale?: number;
  layoutGeometry?: string;
  chatWidth?: number;
  fixedChatWidth?: number;
  unsubscribe?: () => void;
}

interface PdfEventBus {
  on(event: string, listener: () => void): void;
  off(event: string, listener: () => void): void;
}

const MIN_AUTOMATIC_PDF_SCALE = 0.75;

const isAutomaticScaleValue = (value: string | number) =>
  typeof value === "string" && !Number.isFinite(Number(value));

const readViewer = (view: Window): PdfViewer | null =>
  getPdfViewerApplication<{ pdfViewer?: PdfViewer }>(view)?.pdfViewer ?? null;

/** Follow PDF zoom without moving the left edge or changing window height. */
function resizeReadingWindow(
  host: Window,
  requiredInnerWidth: number,
  grow: boolean,
) {
  const chromeHost = host as Window & {
    windowState?: number;
    STATE_NORMAL?: number;
  };
  if (
    host.fullScreen ||
    (chromeHost.windowState != null &&
      chromeHost.windowState !== (chromeHost.STATE_NORMAL ?? 3))
  )
    return;
  const screen = host.screen as Screen & { availLeft?: number };
  const frameWidth = Math.max(0, host.outerWidth - host.innerWidth);
  const target = Math.floor(
    Math.min(
      Math.ceil(requiredInnerWidth + frameWidth),
      (screen.availLeft ?? 0) + screen.availWidth - host.screenX,
    ),
  );
  if (
    !Number.isFinite(target) ||
    !Number.isFinite(host.outerHeight) ||
    host.outerHeight <= 0 ||
    target <= 0 ||
    (grow ? target <= host.outerWidth + 1 : target >= host.outerWidth - 1)
  )
    return;
  try {
    host.resizeTo(target, host.outerHeight);
  } catch {
    /* The window manager may refuse resizing; retain the user's PDF zoom. */
  }
}

export function createAdaptiveChatLayout(
  host: Window,
  applyWidth: (width: number) => void,
  onChange?: () => void,
) {
  const readers = new Map<Window, ReaderState>();
  const cachedMetrics = new Map<Window, AdaptivePdfMetrics>();
  const layoutKeys = new Map<Window, string>();
  let pendingFrame: number | null = null;
  let destroyed = false;

  const scheduleChange = () => {
    if (!onChange || destroyed || pendingFrame !== null) return;
    pendingFrame = host.requestAnimationFrame(() => {
      pendingFrame = null;
      if (!destroyed) onChange();
    });
  };

  const subscribe = (view: Window, state: ReaderState) => {
    if (!onChange || state.unsubscribe) return;
    const eventBus = getPdfViewerApplication<{ eventBus?: PdfEventBus }>(
      view,
    )?.eventBus;
    if (
      typeof eventBus?.on !== "function" ||
      typeof eventBus.off !== "function"
    )
      return;
    const listener = () => scheduleChange();
    try {
      eventBus.on("scalechanging", listener);
      eventBus.on("pagerendered", listener);
      eventBus.on("pagechanging", listener);
    } catch {
      return;
    }

    state.unsubscribe = () => {
      try {
        eventBus.off("scalechanging", listener);
        eventBus.off("pagerendered", listener);
        eventBus.off("pagechanging", listener);
      } catch {
        /* A closed reader can invalidate its event-bus wrapper. */
      }
    };
  };

  const observeScale = (state: ReaderState) => {
    const scale = state.viewer.currentScale;
    if (Number.isFinite(scale) && Math.abs(scale - state.lastScale) > 0.01) {
      state.manual = true;
      state.lastScale = scale;
    }
    return scale;
  };

  const release = (view: Window, state: ReaderState) => {
    try {
      observeScale(state);
      if (!state.manual && isAutomaticScaleValue(state.originalScaleValue)) {
        state.viewer.currentScaleValue = state.originalScaleValue;
      }
    } catch {
      // A reader window may have closed before its zoom mode could be restored.
    }
    readers.delete(view);
    state.unsubscribe?.();
    cachedMetrics.delete(view);
    layoutKeys.delete(view);
  };

  return {
    prepare(views: Window[]) {
      const active = new Set(views);
      for (const [view, state] of readers) {
        if (!active.has(view)) release(view, state);
      }

      for (const view of active) {
        let state = readers.get(view);
        if (state) {
          subscribe(view, state);
          observeScale(state);
          if (isAutomaticScaleValue(state.viewer.currentScaleValue)) {
            const scale = state.viewer.currentScale;
            if (Number.isFinite(scale) && scale > 0) {
              state.viewer.currentScaleValue = scale;
              state.lastScale = state.viewer.currentScale;
            }
          }
          continue;
        }
        const viewer = readViewer(view);
        if (!viewer) continue;
        const scale = viewer.currentScale;
        if (!Number.isFinite(scale) || scale <= 0) continue;

        const originalScaleValue = viewer.currentScaleValue;
        const newState: ReaderState = {
          viewer,
          originalScaleValue,
          lastScale: scale,
          manual: false,
        };
        readers.set(view, newState);
        subscribe(view, newState);
        if (isAutomaticScaleValue(originalScaleValue)) {
          try {
            viewer.currentScaleValue = scale;
            newState.lastScale = viewer.currentScale;
          } catch {
            newState.manual = true;
          }
        }
      }
    },

    update(
      metrics: AdaptivePdfMetrics[],
      noteWidth: number,
      splitterWidth: number,
      currentChatWidth?: number,
      fitPdfToSidebar = false,
    ) {
      for (const metric of metrics) {
        if (
          readers.has(metric.view) &&
          Number.isFinite(metric.left) &&
          Number.isFinite(metric.contentWidthAtScaleOne) &&
          metric.contentWidthAtScaleOne > 0 &&
          Number.isFinite(metric.cssToHost) &&
          metric.cssToHost > 0 &&
          Number.isFinite(metric.scrollbar) &&
          metric.scrollbar >= 0
        ) {
          cachedMetrics.set(metric.view, metric);
        }
      }

      let selected: AdaptivePdfMetrics | undefined;
      let selectedState: ReaderState | undefined;
      for (const view of readers.keys()) {
        const metric = cachedMetrics.get(view);
        const state = readers.get(view);
        if (metric && state) {
          selected = metric;
          selectedState = state;
          break;
        }
      }
      if (!selected || !selectedState) return;

      const fitWidthAtScaleOne = Math.max(
        selected.contentWidthAtScaleOne,
        selected.pageWidthAtScaleOne ?? 0,
      );
      const geometry = JSON.stringify([
        selected.left,
        selected.cssToHost,
        noteWidth,
        splitterWidth,
      ]);
      if (selectedState.layoutGeometry !== geometry)
        selectedState.fixedChatWidth = undefined;
      if (
        fitPdfToSidebar &&
        currentChatWidth != null &&
        Number.isFinite(currentChatWidth) &&
        currentChatWidth >= 320
      ) {
        const minimumPdfWidth =
          (fitWidthAtScaleOne * MIN_AUTOMATIC_PDF_SCALE +
            20 +
            selected.scrollbar) *
          selected.cssToHost;
        const maximumChatWidth = Math.floor(
          host.innerWidth -
            selected.left -
            noteWidth -
            splitterWidth -
            minimumPdfWidth,
        );
        currentChatWidth = Math.max(
          320,
          Math.min(currentChatWidth, maximumChatWidth),
        );
        selectedState.fixedChatWidth = currentChatWidth;
        const available =
          host.innerWidth -
          selected.left -
          noteWidth -
          splitterWidth -
          currentChatWidth;
        const nextScale =
          (available / selected.cssToHost - 20 - selected.scrollbar) /
          fitWidthAtScaleOne;
        if (Number.isFinite(nextScale) && nextScale > 0) {
          const targetScale = Math.max(MIN_AUTOMATIC_PDF_SCALE, nextScale);
          if (
            Math.abs(selectedState.viewer.currentScale - targetScale) > 0.0001
          )
            selectedState.viewer.currentScaleValue = targetScale;
          selectedState.lastScale = selectedState.viewer.currentScale;
          selectedState.layoutScale = selectedState.lastScale;
          selectedState.manual = true;
        }
      }
      const scale = observeScale(selectedState);
      const previousScale = selectedState.layoutScale;
      const zoomChanged =
        previousScale != null &&
        Number.isFinite(scale) &&
        scale > 0 &&
        scale !== previousScale;
      if (
        selectedState.fixedChatWidth != null ||
        (selectedState.layoutScale != null &&
          scale !== selectedState.layoutScale)
      ) {
        // Zoom and its redraws must not resize a column the user is reading.
        const width = currentChatWidth ?? selectedState.chatWidth;
        if (width != null && Number.isFinite(width) && width >= 320)
          selectedState.fixedChatWidth = width;
      }
      selectedState.layoutScale = scale;
      selectedState.layoutGeometry = geometry;
      const pdfWidth =
        (selected.contentWidthAtScaleOne * scale + 20 + selected.scrollbar) *
        selected.cssToHost;
      const maxChatWidth = Math.max(
        760,
        host.innerWidth - selected.left - noteWidth - splitterWidth,
      );
      const result = adaptiveChatWidth({
        windowWidth: host.innerWidth,
        readerLeft: selected.left,
        pdfWidth,
        noteWidth,
        splitterWidth,
        minChatWidth: selectedState.fixedChatWidth ?? 320,
        maxChatWidth: selectedState.fixedChatWidth ?? maxChatWidth,
      });
      if (result && Number.isFinite(result.chatWidth)) {
        const key = JSON.stringify([
          scale,
          host.innerWidth,
          selected.left,
          result.chatWidth,
        ]);
        if (layoutKeys.get(selected.view) !== key) {
          layoutKeys.set(selected.view, key);
          try {
            const container = selected.view.document.getElementById(
              "viewerContainer",
            ) as HTMLElement | null;
            if (container) container.scrollLeft = 0;
          } catch {
            // The reader may close while a layout update is running.
          }
        }
        selectedState.chatWidth = result.chatWidth;
        applyWidth(result.chatWidth);
        if (zoomChanged && !fitPdfToSidebar)
          resizeReadingWindow(
            host,
            selected.left +
              (fitWidthAtScaleOne * scale + 20 + selected.scrollbar) *
                selected.cssToHost +
              noteWidth +
              splitterWidth +
              result.chatWidth,
            scale > previousScale!,
          );
      }
    },

    destroy() {
      destroyed = true;
      if (pendingFrame !== null) {
        host.cancelAnimationFrame(pendingFrame);
        pendingFrame = null;
      }
      for (const [view, state] of [...readers]) release(view, state);
      cachedMetrics.clear();
      layoutKeys.clear();
    },
  };
}
