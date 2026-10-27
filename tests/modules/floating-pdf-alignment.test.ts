import { afterEach, describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { createFloatingPdfAlignment } from "../../src/modules/floating-pdf-alignment";

const alignments: ReturnType<typeof createFloatingPdfAlignment>[] = [];
afterEach(() => {
  for (const alignment of alignments.splice(0)) alignment.destroy();
});
function setup(className = "") {
  const reader = new Window();
  reader.document.head.innerHTML =
    "<style>.pdfViewer { display:flex; flex-direction:column; align-items:center; } .pdfViewer > .page { margin-left:auto; margin-right:auto; width:600px; height:800px; }</style>";
  reader.document.body.innerHTML = `<div id="viewerContainer"><div class="pdfViewer ${className}"><div class="page">Paper</div></div></div>`;
  const alignment = createFloatingPdfAlignment();
  alignments.push(alignment);
  return {
    reader,
    alignment,
    sync: () => alignment.sync([reader as unknown as globalThis.Window]),
  };
}

describe("PDF alignment in floating mode", () => {
  it("left aligns vertical pages and restores the native style on exit", () => {
    const { reader, alignment, sync } = setup();
    const viewer = reader.document.querySelector(".pdfViewer")!;
    const page = reader.document.querySelector(".page")!;
    const container = reader.document.getElementById("viewerContainer")!;
    container.scrollTop = 470;
    container.scrollLeft = 30;
    const scale = { currentScale: 1.5 };
    (reader as any).PDFViewerApplication = { pdfViewer: scale };
    expect(reader.getComputedStyle(viewer).alignItems).toBe("center");
    sync();
    expect(reader.getComputedStyle(viewer).alignItems).toBe("flex-start");
    expect(reader.getComputedStyle(page).marginLeft).toBe("0px");
    expect(reader.getComputedStyle(page).width).toBe("600px");
    expect(reader.getComputedStyle(page).height).toBe("800px");
    expect(container.scrollTop).toBe(470);
    expect(container.scrollLeft).toBe(30);
    expect(scale.currentScale).toBe(1.5);
    sync();
    expect(
      reader.document.querySelectorAll("#zai-floating-pdf-align"),
    ).toHaveLength(1);
    alignment.destroy();
    expect(reader.getComputedStyle(viewer).alignItems).toBe("center");
    expect(reader.getComputedStyle(page).marginLeft).toBe("auto");
    expect(reader.document.querySelectorAll("style")).toHaveLength(1);
  });

  it("switches to right alignment without recreating the style or changing scroll", () => {
    const { reader, alignment, sync } = setup();
    sync();
    const style = reader.document.getElementById("zai-floating-pdf-align");
    const viewer = reader.document.querySelector(".pdfViewer")!;
    const page = reader.document.querySelector(".page")!;
    const container = reader.document.getElementById("viewerContainer")!;
    container.scrollTop = 800;
    alignment.sync([reader as unknown as globalThis.Window], "right");
    expect(reader.document.getElementById("zai-floating-pdf-align")).toBe(
      style,
    );
    expect(reader.getComputedStyle(viewer).alignItems).toBe("safe flex-end");
    expect(reader.getComputedStyle(page).marginLeft).toBe("auto");
    expect(reader.getComputedStyle(page).marginRight).toBe("0px");
    expect(reader.getComputedStyle(page).width).toBe("600px");
    expect(container.scrollTop).toBe(800);
    alignment.destroy();
    expect(reader.getComputedStyle(viewer).alignItems).toBe("center");
  });

  it.each(["scrollHorizontal", "scrollWrapped"])(
    "preserves the native %s layout",
    (className) => {
      const { reader, sync } = setup(className);
      sync();
      expect(
        reader.getComputedStyle(reader.document.querySelector(".pdfViewer")!)
          .alignItems,
      ).toBe("center");
      expect(
        reader.getComputedStyle(reader.document.querySelector(".page")!)
          .marginLeft,
      ).toBe("auto");
    },
  );

  it("handles reader switching and creates styles in the destination document", () => {
    const { reader, alignment, sync } = setup();
    sync();
    const second = setup().reader;
    const append = second.document.head.append.bind(second.document.head);
    second.document.head.append = (...nodes) => {
      for (const node of nodes)
        if (typeof node !== "string")
          expect(node.ownerDocument).toBe(second.document);
      append(...nodes);
    };
    alignment.sync([second as unknown as globalThis.Window]);
    expect(reader.document.getElementById("zai-floating-pdf-align")).toBeNull();
    expect(
      second.document.getElementById("zai-floating-pdf-align"),
    ).not.toBeNull();
    alignment.destroy();
    expect(second.document.getElementById("zai-floating-pdf-align")).toBeNull();
  });

  it("ignores non-PDF documents and supports a reader that loads later", () => {
    const host = new Window();
    const alignment = createFloatingPdfAlignment();
    alignments.push(alignment);
    alignment.sync([host as unknown as globalThis.Window]);
    expect(host.document.getElementById("zai-floating-pdf-align")).toBeNull();
    host.document.body.innerHTML = '<div class="pdfViewer"></div>';
    alignment.sync([host as unknown as globalThis.Window]);
    expect(
      host.document.getElementById("zai-floating-pdf-align"),
    ).not.toBeNull();
    alignment.sync([]);
    expect(host.document.getElementById("zai-floating-pdf-align")).toBeNull();
  });
});

describe("automatic reading space around both panels", () => {
  function setupSpace(scale = 1) {
    const host = new Window({ width: 1200, height: 1000 });
    const iframe = host.document.createElement("iframe");
    host.document.body.append(iframe);
    Object.defineProperties(iframe, {
      offsetWidth: { value: 1200 / scale },
      offsetHeight: { value: 800 / scale },
    });
    iframe.getBoundingClientRect = () => new host.DOMRect(0, 80, 1200, 800);
    const reader = iframe.contentWindow!;
    reader.document.body.innerHTML =
      '<div id="reader-ui"><div class="split-view"><div class="primary-view">Popup layer</div></div></div><div id="split-view"><div class="primary-view"><iframe></iframe></div></div>';
    const split = reader.document.getElementById("split-view")!;
    split.getBoundingClientRect = () =>
      new reader.DOMRect(100 / scale, 40 / scale, 1000 / scale, 760 / scale);
    const alignment = createFloatingPdfAlignment();
    alignments.push(alignment);
    const windows = [reader as unknown as globalThis.Window];
    const options = {
      hostWindow: host as unknown as globalThis.Window,
      answer: { left: 850, top: 100, width: 340, height: 700 },
      composer: { left: 200, top: 650, width: 800, height: 200 },
    };
    return { host, reader, split, alignment, windows, options };
  }

  it("uses the upper-left area for a right answer and bottom composer", () => {
    const { reader, split, alignment, windows, options } = setupSpace();
    // DOMRect coordinates are inherited accessors, not spreadable own fields.
    expect(Object.keys(split.getBoundingClientRect())).toHaveLength(0);
    expect(alignment.sync(windows, "left", options)).toBe(false);
    const style = reader.getComputedStyle(split);
    expect(style.paddingTop).toBe("0px");
    expect(style.paddingLeft).toBe("0px");
    expect(style.paddingRight).toBe("258px");
    expect(style.paddingBottom).toBe("238px");
    const popupLayer = reader.document.querySelector("#reader-ui .split-view")!;
    expect(reader.getComputedStyle(popupLayer).paddingRight).toBe("258px");
    expect(reader.getComputedStyle(popupLayer).paddingBottom).toBe("238px");
    alignment.destroy();
    expect(popupLayer.classList.contains("zai-floating-reader-space")).toBe(
      false,
    );
    expect(split.classList.contains("zai-floating-reader-space")).toBe(false);
    expect(reader.document.querySelectorAll("style")).toHaveLength(0);
  });

  it("updates both axes as the answer and composer move", () => {
    const { reader, split, alignment, windows, options } = setupSpace();
    alignment.sync(windows, "left", options);
    options.answer = { left: 90, top: 100, width: 300, height: 700 };
    alignment.sync(windows, "right", options);
    expect(reader.getComputedStyle(split).paddingLeft).toBe("298px");
    expect(reader.getComputedStyle(split).paddingRight).toBe("0px");
    expect(reader.getComputedStyle(split).paddingBottom).toBe("238px");
    options.composer = { left: 200, top: 130, width: 800, height: 200 };
    alignment.sync(windows, "right", options);
    expect(reader.getComputedStyle(split).paddingTop).toBe("218px");
    expect(reader.getComputedStyle(split).paddingBottom).toBe("0px");
    alignment.sync(windows, "native", {
      ...options,
      answer: null,
      composer: null,
    });
    expect(split.classList.contains("zai-floating-reader-space")).toBe(false);
  });

  it("maps host panel positions back through a scaled reader iframe", () => {
    const { reader, split, alignment, windows, options } = setupSpace(2);
    alignment.sync(windows, "left", options);
    expect(reader.getComputedStyle(split).paddingRight).toBe("129px");
    expect(reader.getComputedStyle(split).paddingBottom).toBe("119px");
  });

  it("finds a chrome frame through the owning document when frameElement is unavailable", () => {
    const { reader, split, alignment, windows, options } = setupSpace();
    Object.defineProperty(reader, "frameElement", {
      configurable: true,
      value: null,
    });
    alignment.sync(windows, "left", options);
    expect(split.classList.contains("zai-floating-reader-space")).toBe(true);
  });

  it("restores the native reading area if geometry becomes invalid", () => {
    const { reader, split, alignment, windows, options } = setupSpace();
    alignment.sync(windows, "left", options);
    expect(split.classList.contains("zai-floating-reader-space")).toBe(true);
    split.getBoundingClientRect = () => new reader.DOMRect(NaN, 40, 1000, 760);
    expect(alignment.sync(windows, "left", options)).toBe(false);
    expect(split.classList.contains("zai-floating-reader-space")).toBe(false);
    expect(reader.getComputedStyle(split).visibility).not.toBe("hidden");
  });

  it("never hides the PDF when the panels leave no free reading space", () => {
    const { reader, split, alignment, windows, options } = setupSpace();
    options.answer = { left: 0, top: 0, width: 2000, height: 2000 };
    expect(alignment.sync(windows, "left", options)).toBe(true);
    expect(reader.getComputedStyle(split).visibility).not.toBe("hidden");
    expect(
      reader.getComputedStyle(split.querySelector("iframe")!).visibility,
    ).not.toBe("hidden");
    expect(split.classList.contains("zai-floating-reader-space")).toBe(false);
    options.answer = { left: 850, top: 100, width: 340, height: 700 };
    expect(alignment.sync(windows, "left", options)).toBe(false);
    expect(reader.getComputedStyle(split).visibility).not.toBe("hidden");
  });
});
