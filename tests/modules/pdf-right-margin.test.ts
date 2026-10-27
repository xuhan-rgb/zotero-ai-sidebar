import { createAdaptiveChatLayout } from "../../src/modules/adaptive-chat-layout";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  blankRightColumns,
  blankLeftColumns,
  createPdfRightMargin,
} from "../../src/modules/pdf-right-margin";
const controllers: ReturnType<typeof createPdfRightMargin>[] = [];
afterEach(() => {
  for (const item of controllers.splice(0)) item.destroy();
  document.body.replaceChildren();
  delete (window as any).PDFViewerApplication;
});
function pixels(width: number, height: number, ink: [number, number] | null) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  if (ink) {
    const i = (ink[1] * width + ink[0]) * 4;
    data[i] = data[i + 1] = data[i + 2] = 0;
  }
  return data;
}
function setup() {
  document.body.innerHTML =
    '<div class="pdfViewer"><div class="page" style="margin-right:3px"><canvas width="1000" height="50"></canvas></div></div>';
  const page = document.querySelector<HTMLElement>(".page")!;
  const canvas = document.querySelector("canvas")!;
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 50);
  const getImageData = vi.fn(
    (_x: number, _y: number, width: number, height: number) => ({
      data: pixels(width, height, [width - 101, height - 1]),
    }),
  );
  Object.defineProperty(canvas, "getContext", {
    configurable: true,
    value: () => ({ getImageData }),
  });
  const controller = createPdfRightMargin();
  controllers.push(controller);
  return { page, canvas, controller, getImageData };
}
function nativeViewer(state: ReturnType<typeof setup>) {
  const container = document.createElement("div");
  container.id = "viewerContainer";
  Object.defineProperty(container, "clientWidth", {
    configurable: true,
    value: 1000,
  });
  container.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 600);
  document.body.append(container);
  const writes = vi.fn();
  const viewer = {
    currentPageNumber: 1,
    currentScale: 1,
    value: "page-width" as string | number,
    get currentScaleValue() {
      return this.value;
    },
    set currentScaleValue(value: string | number) {
      writes(value);
      this.value = value;
      this.currentScale = typeof value === "number" ? value : 1;
    },
  };
  (window as any).PDFViewerApplication = { pdfViewer: viewer };
  state.canvas.getBoundingClientRect = () =>
    new DOMRect(0, 0, 1000 * viewer.currentScale, 50 * viewer.currentScale);
  return { container, viewer, writes };
}

describe("PDF right blank margin", () => {
  it("checks every row, including figure marks near the bottom", () => {
    expect(blankRightColumns(pixels(10, 100, [6, 99]), 10, 100)).toBe(3);
    expect(blankRightColumns(pixels(10, 100, [9, 0]), 10, 100)).toBe(0);
    expect(blankRightColumns(pixels(10, 100, null), 10, 100)).toBe(10);
  });
  it("detects the left blank strip without skipping small marks at the page bottom", () => {
    expect(blankLeftColumns(pixels(10, 100, [4, 99]), 10, 100)).toBe(4);
    expect(blankLeftColumns(pixels(10, 100, [0, 0]), 10, 100)).toBe(0);
  });
  it("moves only the measured white strip while keeping an 8px safety margin", () => {
    const state = setup();
    state.controller.sync([window], true);
    expect(state.page.style.marginRight).toBe("-92px");
    expect(state.getImageData).toHaveBeenCalledWith(850, 0, 150, 50);
    expect(state.page.style.width).toBe("");
    expect(state.canvas.width).toBe(1000);
    state.controller.sync([window], false);
    expect(state.page.style.marginRight).toBe("3px");
  });
  it("caches rendered canvases and remeasures after zoom changes their dimensions", () => {
    const state = setup();
    state.controller.sync([window], true);
    state.controller.sync([window], true);
    expect(state.getImageData).toHaveBeenCalledTimes(2);
    state.canvas.width = 1100;
    state.controller.sync([window], true);
    expect(state.getImageData).toHaveBeenCalledTimes(4);
  });
  it("preserves margins on loading, protected and horizontal layouts", () => {
    const state = setup();
    state.page.classList.add("loading");
    state.controller.sync([window], true);
    expect(state.page.style.marginRight).toBe("3px");
    expect(state.getImageData).not.toHaveBeenCalled();
    state.page.classList.remove("loading");
    state.getImageData.mockImplementation(() => {
      throw new Error("protected canvas");
    });
    state.controller.sync([window], true);
    expect(state.page.style.marginRight).toBe("3px");
    document.querySelector(".pdfViewer")!.classList.add("scrollHorizontal");
    state.controller.sync([window], true);
    expect(state.page.style.marginRight).toBe("3px");
  });
  it("cleans up page margins and reader padding on tab changes and teardown", () => {
    const state = setup();
    const styleCount = document.querySelectorAll("style").length;
    state.controller.sync([window], true);
    expect(document.querySelectorAll("style").length).toBe(styleCount + 1);
    state.controller.sync([], true);
    expect(state.page.style.marginRight).toBe("3px");
    expect(document.querySelectorAll("style").length).toBe(styleCount);
    state.controller.sync([window], true);
    state.controller.destroy();
    expect(state.page.style.marginRight).toBe("3px");
    expect(document.querySelectorAll("style").length).toBe(styleCount);
  });
  it("fits the complete page safely, then restores the original native zoom", () => {
    const state = setup();
    const container = document.createElement("div");
    container.id = "viewerContainer";
    Object.defineProperty(container, "clientWidth", { value: 1000 });
    document.body.append(container);
    state.page.style.marginLeft = "auto";
    state.getImageData.mockImplementation((x, _y, width, height) => ({
      data: pixels(width, height, [x === 0 ? 100 : width - 101, height - 1]),
    }));
    let scale = 1,
      value: string | number = "page-width";
    const setScale = vi.fn((next: string | number) => {
      value = next;
      scale = typeof next === "number" ? next : 1;
    });
    const viewer = {
      currentPageNumber: 1,
      get currentScale() {
        return scale;
      },
      get currentScaleValue() {
        return value;
      },
      set currentScaleValue(next) {
        setScale(next);
      },
    };
    (window as any).PDFViewerApplication = { pdfViewer: viewer };
    state.canvas.getBoundingClientRect = () =>
      new DOMRect(0, 0, 1000 * scale, 50 * scale);
    state.controller.sync([window], true);
    expect(viewer.currentScale).toBeCloseTo(0.98);
    state.controller.sync([window], true);
    state.controller.sync([window], true);
    expect(setScale).toHaveBeenCalledOnce();
    expect(state.page.style.marginLeft).toBe("-90px");
    expect(state.page.style.marginRight).toBe("-90px");
    state.controller.sync([], false);
    expect(viewer.currentScaleValue).toBe("page-width");
    expect(state.page.style.marginLeft).toBe("auto");
    expect(state.page.style.marginRight).toBe("3px");
  });

  it("keeps zoom stable while scrolling between pages with different margins", () => {
    const state = setup();
    state.page.dataset.pageNumber = "1";
    const second = document.createElement("div");
    second.className = "page";
    second.dataset.pageNumber = "2";
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 50;
    second.append(canvas);
    document.querySelector(".pdfViewer")!.append(second);
    Object.defineProperty(canvas, "getContext", {
      value: () => ({
        getImageData: (
          _x: number,
          _y: number,
          width: number,
          height: number,
        ) => ({
          data: new Uint8ClampedArray(width * height * 4)
            .fill(0)
            .map((v, i) => (i % 4 === 3 ? 255 : v)),
        }),
      }),
    });
    const container = document.createElement("div");
    container.id = "viewerContainer";
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 1000,
    });
    document.body.append(container);
    let scale = 1,
      value: string | number = "page-width";
    const setScale = vi.fn((next: string | number) => {
      value = next;
      scale = typeof next === "number" ? next : 1;
    });
    const viewer = {
      currentPageNumber: 1,
      get currentScale() {
        return scale;
      },
      get currentScaleValue() {
        return value;
      },
      set currentScaleValue(next) {
        setScale(next);
      },
    };
    (window as any).PDFViewerApplication = { pdfViewer: viewer };
    for (const item of [state.canvas, canvas])
      item.getBoundingClientRect = () =>
        new DOMRect(0, 0, 1000 * scale, 50 * scale);
    state.controller.sync([window], true);
    const fitted = scale;
    expect(setScale).toHaveBeenCalledOnce();
    viewer.currentPageNumber = 2;
    container.scrollTop = 500;
    state.controller.sync([window], true);
    viewer.currentPageNumber = 1;
    container.scrollTop = 0;
    state.controller.sync([window], true);
    expect(scale).toBe(fitted);
    expect(setScale).toHaveBeenCalledOnce();
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 800,
    });
    viewer.currentPageNumber = 2;
    state.controller.sync([window], true);
    expect(scale).toBeCloseTo((fitted * 780) / 980);
    expect(setScale).toHaveBeenCalledTimes(2);
  });

  it("respects a subsequent manual zoom instead of overriding or undoing it", () => {
    const state = setup();
    const container = document.createElement("div");
    container.id = "viewerContainer";
    Object.defineProperty(container, "clientWidth", { value: 1000 });
    document.body.append(container);
    const viewer = {
      currentPageNumber: 1,
      currentScale: 1,
      _value: "page-width" as string | number,
      get currentScaleValue() {
        return this._value;
      },
      set currentScaleValue(next: string | number) {
        this._value = next;
        this.currentScale = typeof next === "number" ? next : 1;
      },
    };
    (window as any).PDFViewerApplication = { pdfViewer: viewer };
    state.canvas.getBoundingClientRect = () =>
      new DOMRect(0, 0, 1000 * viewer.currentScale, 50 * viewer.currentScale);
    state.controller.sync([window], true);
    viewer.currentScaleValue = 1.5;
    state.controller.sync([window], true);
    state.controller.sync([], false);
    expect(viewer.currentScaleValue).toBe(1.5);
  });
  it("fits inside the truly visible PDF width before the AI column, including long text and figures", () => {
    const state = setup();
    const { container, viewer, writes } = nativeViewer(state);
    container.scrollLeft = 150;
    state.controller.sync([window], true, { hostWindow: window, right: 700 });
    expect(viewer.currentScale).toBeCloseTo(0.68);
    expect(1000 * viewer.currentScale).toBeLessThanOrEqual(680);
    expect(window.getComputedStyle(container).maxWidth).toBe("700px");
    expect(container.scrollLeft).toBe(0);
    state.controller.sync([window], true, { hostWindow: window, right: 700 });
    expect(writes).toHaveBeenCalledOnce();
    state.controller.sync([window], true, { hostWindow: window, right: 800 });
    expect(viewer.currentScale).toBeCloseTo(0.78);
    expect(window.getComputedStyle(container).maxWidth).toBe("800px");
    state.controller.destroy();
    expect(viewer.currentScaleValue).toBe("page-width");
    expect(window.getComputedStyle(container).maxWidth).not.toBe("800px");
  });

  it("uses the widest known paper size so a wider page is not cut off at the fixed zoom", () => {
    const state = setup();
    const { viewer } = nativeViewer(state);
    Object.assign(viewer, {
      pagesCount: 2,
      getPageView: (i: number) => ({
        viewport: { width: (i === 1 ? 1200 : 1000) * viewer.currentScale },
      }),
    });
    state.controller.sync([window], true, { hostWindow: window, right: 700 });
    expect(viewer.currentScale).toBeCloseTo(680 / 1200);
    expect(1200 * viewer.currentScale).toBeLessThanOrEqual(680);
    viewer.currentPageNumber = 2;
    state.controller.sync([window], true, { hostWindow: window, right: 700 });
    expect(viewer.currentScale).toBeCloseTo(680 / 1200);
  });
  it("shrinks to a changed viewport while the page canvas is still redrawing", () => {
    const state = setup();
    const { viewer, writes } = nativeViewer(state);
    state.controller.sync([window], true, { hostWindow: window, right: 900 });
    state.page.classList.add("loading");
    state.controller.sync([window], true, { hostWindow: window, right: 700 });
    expect(viewer.currentScale).toBeCloseTo(0.68);
    expect(writes).toHaveBeenCalledTimes(2);
    state.controller.sync([window], true, { hostWindow: window, right: 700 });
    expect(writes).toHaveBeenCalledTimes(2);
  });
  it("preserves both PDF zoom and sidebar width during PDF zoom changes", () => {
    const state = setup();
    state.controller.destroy();
    state.controller = createPdfRightMargin({ preserveZoom: true });
    controllers.push(state.controller);
    const { container, viewer } = nativeViewer(state);
    container.getBoundingClientRect = () => new DOMRect(200, 0, 1000, 600);
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1600,
    });
    let chatWidth = 600;
    const adaptive = createAdaptiveChatLayout(window, (width) => {
      chatWidth = width;
    });
    const sync = () => {
      adaptive.prepare([window]);
      const metrics = state.controller.sync([window], true, {
        hostWindow: window,
        right: 1600 - chatWidth,
      });
      adaptive.update(metrics, 0, 4);
    };
    try {
      sync();
      const initial = chatWidth;
      expect(viewer.currentScale).toBe(1);
      expect(initial).toBe(525);
      viewer.currentScaleValue = 1.1;
      sync();
      expect(viewer.currentScale).toBe(1.1);
      expect(chatWidth).toBe(initial);
      const enlargedWidth = chatWidth;
      sync();
      expect(chatWidth).toBe(enlargedWidth);
      viewer.currentScaleValue = 0.9;
      sync();
      expect(viewer.currentScale).toBe(0.9);
      expect(chatWidth).toBe(initial);
      state.page.classList.add("loading");
      viewer.currentScaleValue = 1.1;
      sync();
      expect(viewer.currentScale).toBe(1.1);
      expect(chatWidth).toBe(enlargedWidth);
      expect(parseFloat(state.page.style.marginLeft)).toBeCloseTo(
        -(49 * 1.1 - 8),
      );
    } finally {
      adaptive.destroy();
    }
  });
  it("uses a shared page envelope so scrolling does not shift aligned page edges", () => {
    const state = setup();
    state.controller = createPdfRightMargin({ preserveZoom: true });
    controllers.push(state.controller);
    const { viewer } = nativeViewer(state);
    state.page.dataset.pageNumber = "1";
    const second = document.createElement("div");
    second.className = "page";
    second.dataset.pageNumber = "2";
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 50;
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 50);
    Object.defineProperty(canvas, "getContext", {
      value: () => ({
        getImageData: (
          x: number,
          _y: number,
          width: number,
          height: number,
        ) => ({
          data: pixels(width, height, [x === 0 ? 100 : width - 121, 0]),
        }),
      }),
    });
    second.append(canvas);
    document.querySelector(".pdfViewer")!.append(second);
    expect(
      state.controller.sync([window], true, {
        hostWindow: window,
        right: 1000,
      })[0].contentWidthAtScaleOne,
    ).toBe(851);
    viewer.currentPageNumber = 2;
    expect(
      state.controller.sync([window], true, {
        hostWindow: window,
        right: 1000,
      })[0].contentWidthAtScaleOne,
    ).toBe(851);
    state.page.getBoundingClientRect = () => new DOMRect(0, -600, 1000, 500);
    second.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 500);
    viewer.currentPageNumber = 1; // Geometry wins if PDF.js page-number reporting lags.
    expect(
      state.controller.sync([window], true, {
        hostWindow: window,
        right: 1000,
      })[0].contentWidthAtScaleOne,
    ).toBe(851);
    state.page.getBoundingClientRect = () => new DOMRect(0, -100, 1000, 500);
    expect(
      state.controller.sync([window], true, {
        hostWindow: window,
        right: 1000,
      })[0].contentWidthAtScaleOne,
    ).toBe(851);
    expect(viewer.currentScale).toBe(1);
  });
  it("reports the widest complete page even while a narrower body is visible", () => {
    const state = setup();
    state.controller = createPdfRightMargin({ preserveZoom: true });
    controllers.push(state.controller);
    const { viewer } = nativeViewer(state);
    Object.assign(viewer, {
      pagesCount: 2,
      getPageView: (index: number) => ({
        viewport: { width: index === 0 ? 1200 : 1000 },
      }),
    });
    const metrics = state.controller.sync([window], true, {
      hostWindow: window,
      right: 1000,
    });
    expect(metrics[0].contentWidthAtScaleOne).toBe(1051);
    expect(metrics[0].pageWidthAtScaleOne).toBe(1200);
  });

  it("keeps equal-size page edges aligned despite different content margins", () => {
    const state = setup();
    state.controller = createPdfRightMargin({ preserveZoom: true });
    controllers.push(state.controller);
    const { viewer } = nativeViewer(state);
    state.page.dataset.pageNumber = "1";
    const second = state.page.cloneNode(true) as HTMLElement;
    second.dataset.pageNumber = "2";
    const canvas = second.querySelector("canvas")!;
    canvas.getBoundingClientRect = state.canvas.getBoundingClientRect;
    Object.defineProperty(canvas, "getContext", {
      value: () => ({
        getImageData: (
          x: number,
          _y: number,
          width: number,
          height: number,
        ) => ({
          data: pixels(width, height, [x === 0 ? 100 : width - 121, 0]),
        }),
      }),
    });
    state.page.parentElement!.append(second);
    state.controller.sync([window], true, { hostWindow: window, right: 1000 });
    expect(second.style.marginLeft).toBe(state.page.style.marginLeft);
    expect(second.style.marginRight).toBe(state.page.style.marginRight);
    state.canvas.setAttribute("zooming", "true");
    state.controller.sync([window], true, { hostWindow: window, right: 1000 });
    expect(second.style.marginLeft).toBe(state.page.style.marginLeft);
    expect(second.style.marginRight).toBe(state.page.style.marginRight);
    state.canvas.removeAttribute("zooming");
    second.classList.add("loading");
    viewer.currentScaleValue = 1.2;
    state.controller.sync([window], true, { hostWindow: window, right: 1000 });
    expect(second.style.marginLeft).toBe(state.page.style.marginLeft);
    expect(second.style.marginRight).toBe(state.page.style.marginRight);
    state.controller.destroy();
    expect(second.style.marginRight).toBe("3px");
  });

  it("keeps the original reader identity when its document exposes a different Window wrapper", () => {
    const state = setup();
    state.controller = createPdfRightMargin({ preserveZoom: true });
    controllers.push(state.controller);
    const { viewer } = nativeViewer(state);
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1400,
    });
    const reader = {
      document,
      innerWidth: 1400,
      wrappedJSObject: window,
    } as unknown as Window;
    const applyWidth = vi.fn();
    const adaptive = createAdaptiveChatLayout(window, applyWidth);
    try {
      adaptive.prepare([reader]);
      const metrics = state.controller.sync([reader], true, {
        hostWindow: window,
        right: 1000,
      });
      expect(metrics[0].view).toBe(reader);
      adaptive.update(metrics, 0, 4);
      expect(applyWidth).toHaveBeenCalledWith(525);
      expect(viewer.currentScale).toBe(1);
    } finally {
      adaptive.destroy();
    }
  });
});
