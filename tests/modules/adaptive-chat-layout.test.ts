import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAdaptiveChatLayout,
  type AdaptivePdfMetrics,
} from "../../src/modules/adaptive-chat-layout";

const originalHostGeometry = Object.getOwnPropertyDescriptors(window);
const layouts: ReturnType<typeof createAdaptiveChatLayout>[] = [];
afterEach(() => {
  for (const layout of layouts.splice(0)) layout.destroy();
  delete (window as any).PDFViewerApplication;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  for (const key of [
    "outerWidth",
    "outerHeight",
    "screenX",
    "screen",
    "windowState",
  ]) {
    const original = originalHostGeometry[key];
    if (original) Object.defineProperty(window, key, original);
    else delete (window as any)[key];
  }
});

function setup() {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1400,
  });
  let scale = 1;
  let scaleValue: string | number = "page-width";
  const viewer = {
    get currentScale() {
      return scale;
    },
    get currentScaleValue() {
      return scaleValue;
    },
    set currentScaleValue(value: string | number) {
      scaleValue = value;
      if (typeof value === "number") scale = value;
    },
    setUserScale(value: number) {
      scale = value;
      scaleValue = value;
    },
  };
  (window as any).PDFViewerApplication = { pdfViewer: viewer };
  const applyWidth = vi.fn();
  const focus = vi.fn();
  Object.defineProperty(window, "focus", {
    configurable: true,
    value: focus,
  });
  const container = document.createElement("div");
  container.id = "viewerContainer";
  document.body.append(container);
  const layout = createAdaptiveChatLayout(window, applyWidth);
  layouts.push(layout);
  const metric: AdaptivePdfMetrics = {
    view: window,
    left: 100,
    contentWidthAtScaleOne: 700,
    cssToHost: 1,
    scrollbar: 0,
  };
  return { viewer, layout, applyWidth, metric, focus, container };
}

describe("createAdaptiveChatLayout", () => {
  it("keeps sidebar width unchanged on both PDF zoom-in and zoom-out", () => {
    const { viewer, layout, applyWidth, metric, focus } = setup();
    layout.prepare([window]);
    expect(viewer.currentScale).toBe(1);
    layout.update([metric], 0, 4);
    expect(focus).not.toHaveBeenCalled();
    const initial = applyWidth.mock.lastCall![0];

    viewer.setUserScale(1.4);
    layout.update([], 0, 4);
    const zoomedIn = applyWidth.mock.lastCall![0];
    expect(viewer.currentScale).toBe(1.4);
    expect(zoomedIn).toBe(initial);

    viewer.setUserScale(0.8);
    layout.update([], 0, 4);
    expect(viewer.currentScale).toBe(0.8);
    expect(applyWidth.mock.lastCall![0]).toBe(initial);
  });

  it("preserves manual width across zoom, redraws, polling, and later manual resizing", () => {
    const { viewer, layout, applyWidth, metric } = setup();
    layout.prepare([window]);
    layout.update([metric], 0, 4, 480);
    viewer.setUserScale(0.8);
    layout.prepare([window]);
    layout.update([], 0, 4, 480);
    expect(applyWidth).toHaveBeenLastCalledWith(480);

    layout.update([{ ...metric, contentWidthAtScaleOne: 690 }], 0, 4, 480);
    layout.update([], 0, 4, 480);
    expect(applyWidth).toHaveBeenLastCalledWith(480);
    expect(viewer.currentScale).toBe(0.8);
    viewer.setUserScale(1.4);
    layout.update([metric], 0, 4, 480);
    expect(applyWidth).toHaveBeenLastCalledWith(480);
    expect(viewer.currentScale).toBe(1.4);
    layout.update([metric], 0, 4, 600);
    expect(applyWidth).toHaveBeenLastCalledWith(600);
  });

  it("expands then contracts the host with PDF zoom while preserving sidebar width", () => {
    const { viewer, layout, applyWidth, metric } = setup();
    Object.defineProperties(window, {
      outerWidth: { configurable: true, value: 1420 },
      outerHeight: { configurable: true, value: 900 },
      screenX: { configurable: true, value: 100 },
      screen: { configurable: true, value: { availLeft: 0, availWidth: 2400 } },
    });
    const resize = vi.spyOn(window, "resizeTo").mockImplementation((width) => {
      Object.defineProperty(window, "outerWidth", { value: width });
      Object.defineProperty(window, "innerWidth", { value: width - 20 });
    });
    layout.prepare([window]);
    layout.update([metric], 100, 8, 480);
    expect(resize).not.toHaveBeenCalled();
    viewer.setUserScale(1.4);
    layout.update([metric], 100, 8, 480);
    expect(resize).toHaveBeenCalledExactlyOnceWith(1708, 900);
    expect(window.innerWidth).toBe(1688);
    layout.update([], 100, 8, 480);
    expect(applyWidth).toHaveBeenLastCalledWith(480);
    expect(1688 - 480 - 100 - 8 - 100).toBeCloseTo(700 * 1.4 + 20);
    expect(viewer.currentScale).toBe(1.4);
    viewer.setUserScale(0.8);
    layout.update([metric], 100, 8, 480);
    expect(resize).toHaveBeenCalledTimes(2);
    expect(resize).toHaveBeenLastCalledWith(1288, 900);
    expect(window.innerWidth).toBe(1268);
    expect(1268 - 480 - 100 - 8 - 100).toBeCloseTo(700 * 0.8 + 20);
    layout.update([], 100, 8, 480);
    layout.update([metric], 100, 8, 480);
    expect(resize).toHaveBeenCalledTimes(2);
    expect(applyWidth).toHaveBeenLastCalledWith(480);
    expect(viewer.currentScale).toBe(0.8);
    expect(window.screenX).toBe(100);
  });

  it.each([
    [0, 1920, 100, 1820],
    [-1920, 1920, -1800, 1800],
  ])(
    "limits rightward expansion to the current screen (%s)",
    (availLeft, availWidth, screenX, maximum) => {
      const { viewer, layout, applyWidth, metric } = setup();
      Object.defineProperties(window, {
        outerWidth: { configurable: true, value: 1420 },
        outerHeight: { configurable: true, value: 900 },
        screenX: { configurable: true, value: screenX },
        screen: { configurable: true, value: { availLeft, availWidth } },
      });
      const resize = vi.spyOn(window, "resizeTo").mockImplementation(() => {});
      layout.prepare([window]);
      layout.update([metric], 0, 4, 480);
      viewer.setUserScale(3);
      layout.update([metric], 0, 4, 480);
      expect(resize).toHaveBeenCalledExactlyOnceWith(maximum, 900);
      layout.update([metric], 0, 4, 480);
      expect(resize).toHaveBeenCalledTimes(1);
      expect(applyWidth).toHaveBeenLastCalledWith(480);
      expect(viewer.currentScale).toBe(3);
    },
  );

  it.each(["maximized", "refused"])(
    "keeps zoom and sidebar width when window expansion is %s",
    (mode) => {
      const { viewer, layout, applyWidth, metric } = setup();
      Object.defineProperties(window, {
        outerWidth: { configurable: true, value: 1420 },
        outerHeight: { configurable: true, value: 900 },
        screenX: { configurable: true, value: 100 },
        screen: {
          configurable: true,
          value: { availLeft: 0, availWidth: 2400 },
        },
        windowState: {
          configurable: true,
          value: mode === "maximized" ? 1 : 3,
        },
      });
      const resize = vi.spyOn(window, "resizeTo").mockImplementation(() => {
        throw new Error("Window manager refused resize");
      });
      layout.prepare([window]);
      layout.update([metric], 0, 4, 480);
      viewer.setUserScale(1.4);
      expect(() => layout.update([metric], 0, 4, 480)).not.toThrow();
      layout.update([metric], 0, 4, 480);
      expect(resize).toHaveBeenCalledTimes(mode === "maximized" ? 0 : 1);
      expect(applyWidth).toHaveBeenLastCalledWith(480);
      expect(viewer.currentScale).toBe(1.4);
    },
  );

  it("fits PDF zoom to a dragged sidebar width without resizing the window", () => {
    const { viewer, layout, applyWidth, metric } = setup();
    const resize = vi.spyOn(window, "resizeTo").mockImplementation(() => {});
    layout.prepare([window]);
    layout.update([metric], 100, 8, 480);
    layout.update([metric], 100, 8, 600, true);
    const smaller = (1400 - 100 - 100 - 8 - 600 - 20) / 700;
    expect(viewer.currentScale).toBeCloseTo(smaller);
    expect(applyWidth).toHaveBeenLastCalledWith(600);
    layout.prepare([window]);
    layout.update([], 100, 8, 600);
    expect(viewer.currentScale).toBeCloseTo(smaller);
    expect(applyWidth).toHaveBeenLastCalledWith(600);

    layout.update([], 100, 8, 400, true);
    const larger = (1400 - 100 - 100 - 8 - 400 - 20) / 700;
    expect(viewer.currentScale).toBeCloseTo(larger);
    expect(larger).toBeGreaterThan(smaller);
    expect(applyWidth).toHaveBeenLastCalledWith(400);
    expect(resize).not.toHaveBeenCalled();
    layout.destroy();
    expect(viewer.currentScale).toBeCloseTo(larger);
  });

  it("fits the complete widest page instead of a narrower page's text body", () => {
    const { viewer, layout, applyWidth, metric } = setup();
    const pageMetric = {
      ...metric,
      contentWidthAtScaleOne: 600,
      pageWidthAtScaleOne: 1000,
    };
    layout.prepare([window]);
    layout.update([pageMetric], 0, 4, 600);
    layout.update([pageMetric], 0, 4, 600, true);
    const available = 1400 - 100 - 526 - 4;
    expect(viewer.currentScale).toBe(0.75);
    expect(1000 * viewer.currentScale + 20).toBeLessThanOrEqual(available);
    layout.update([{ ...pageMetric, contentWidthAtScaleOne: 900 }], 0, 4, 526);
    expect(1000 * viewer.currentScale + 20).toBeLessThanOrEqual(available);
    expect(applyWidth).toHaveBeenLastCalledWith(526);
  });

  it("stops automatic PDF shrinking at 75% and limits sidebar expansion", () => {
    const { viewer, layout, applyWidth, metric } = setup();
    const pageMetric = { ...metric, pageWidthAtScaleOne: 1000 };
    layout.prepare([window]);
    layout.update([pageMetric], 0, 4, 600);
    layout.update([pageMetric], 0, 4, 900, true);
    expect(viewer.currentScale).toBe(0.75);
    expect(applyWidth).toHaveBeenLastCalledWith(526);
    expect(100 + 1000 * 0.75 + 20 + 4 + 526).toBe(1400);
    layout.update([pageMetric], 0, 4, 320, true);
    expect(viewer.currentScale).toBeGreaterThan(0.75);
    expect(applyWidth).toHaveBeenLastCalledWith(320);
  });

  it("uses the current page metric and reuses it during redraw", () => {
    const { layout, applyWidth, metric } = setup();
    layout.prepare([window]);
    layout.update([metric], 0, 4);
    const initial = applyWidth.mock.lastCall![0];

    layout.update([{ ...metric, contentWidthAtScaleOne: 400 }], 0, 4);
    const narrowerPage = applyWidth.mock.lastCall![0];
    expect(narrowerPage).toBeGreaterThan(initial);
    layout.update([], 0, 4);
    expect(applyWidth.mock.lastCall![0]).toBe(narrowerPage);

    layout.update([{ ...metric, contentWidthAtScaleOne: 800 }], 0, 4);
    expect(applyWidth.mock.lastCall![0]).toBeLessThan(narrowerPage);
  });

  it("restores automatic zoom on destroy unless the user changed scale", () => {
    const automatic = setup();
    automatic.layout.prepare([window]);
    expect(automatic.viewer.currentScaleValue).toBe(1);
    automatic.layout.destroy();
    expect(automatic.viewer.currentScaleValue).toBe("page-width");

    const manual = setup();
    manual.layout.prepare([window]);
    manual.viewer.setUserScale(1.25);
    manual.layout.destroy();
    expect(manual.viewer.currentScaleValue).toBe(1.25);
  });

  it("freezes a later automatic zoom selection at its current numeric scale", () => {
    const { viewer, layout } = setup();
    layout.prepare([window]);
    viewer.setUserScale(1.2);
    viewer.currentScaleValue = "page-width";
    layout.prepare([window]);

    expect(viewer.currentScale).toBe(1.2);
    expect(viewer.currentScaleValue).toBe(1.2);
  });

  it("resets horizontal scroll when layout changes, but leaves it during polling", () => {
    const { viewer, layout, metric, container } = setup();
    layout.prepare([window]);
    layout.update([metric], 0, 4);
    container.scrollLeft = 80;
    layout.update([], 0, 4);
    expect(container.scrollLeft).toBe(80);

    viewer.setUserScale(1.2);
    layout.update([], 0, 4);
    expect(container.scrollLeft).toBe(0);
    container.scrollLeft = 60;
    layout.update([], 0, 4);
    expect(container.scrollLeft).toBe(60);
  });

  it("coalesces PDF events per frame, removes listeners, and cancels on destroy", () => {
    const { layout, metric } = setup();
    const onChange = vi.fn();
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        const id = nextFrame++;
        frames.set(id, callback);
        return id;
      });
    const cancelFrame = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((id) => {
        frames.delete(id);
      });
    const listeners = new Map<string, Set<() => void>>();
    const eventBus = {
      on: (event: string, listener: () => void) => {
        const set = listeners.get(event) ?? new Set();
        set.add(listener);
        listeners.set(event, set);
      },
      off: (event: string, listener: () => void) => {
        listeners.get(event)?.delete(listener);
      },
    };
    (window as any).PDFViewerApplication.eventBus = eventBus;
    const eventLayout = createAdaptiveChatLayout(window, vi.fn(), onChange);
    layouts.push(eventLayout);
    eventLayout.prepare([window]);
    eventLayout.update([metric], 0, 4);

    for (const listener of listeners.get("scalechanging")!) listener();
    for (const listener of listeners.get("pagerendered")!) listener();
    for (const listener of listeners.get("pagechanging")!) listener();
    expect(requestFrame).toHaveBeenCalledOnce();
    const [frameId, callback] = [...frames.entries()][0];
    frames.delete(frameId);
    callback(0);
    expect(onChange).toHaveBeenCalledOnce();

    listeners.get("scalechanging")!.forEach((listener) => listener());
    const pending = [...frames.keys()][0];
    const delayedCallback = frames.get(pending)!;
    eventLayout.destroy();
    expect(cancelFrame).toHaveBeenCalledWith(pending);
    expect(listeners.get("scalechanging")?.size).toBe(0);
    expect(listeners.get("pagerendered")?.size).toBe(0);
    expect(listeners.get("pagechanging")?.size).toBe(0);
    delayedCallback(1);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("applies the minimum chat width when the PDF consumes the available area", () => {
    const { layout, applyWidth, metric } = setup();
    layout.prepare([window]);
    layout.update([{ ...metric, contentWidthAtScaleOne: 2000 }], 0, 4);
    expect(applyWidth).toHaveBeenLastCalledWith(320);
  });

  it("uses extra host width to absorb the full gap beside the PDF", () => {
    const { layout, applyWidth, metric } = setup();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 2000,
    });
    layout.prepare([window]);
    layout.update([{ ...metric, contentWidthAtScaleOne: 500 }], 0, 4);

    expect(applyWidth).toHaveBeenLastCalledWith(1376);
  });
});
