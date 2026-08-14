import { afterEach, describe, expect, it, vi } from "vitest";
import type { OverviewData } from "../../src/context/overview-types";
import { buildOverviewExportHtml } from "../../src/modules/overview-export";

const data: OverviewData = {
  title: "Paper",
  source: "pdf",
  coverage: "headings",
  sections: [
    {
      no: "1",
      level: 1,
      title: "Method",
      gist: "方法概览",
      charStart: 0,
      charEnd: 5,
    },
    {
      no: "1.1",
      level: 2,
      title: "Detail",
      gist: "方法细节",
      charStart: 1,
      charEnd: 4,
    },
  ],
  flowchart: {
    rankdir: "LR",
    nodes: [
      { id: "a", label: "Method", type: "section", sectionNo: "1" },
      { id: "b", label: "Detail", type: "point", sectionNo: "1.1" },
    ],
    edges: [{ source: "a", target: "b" }],
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function exportedPage(): Document {
  const html = buildOverviewExportHtml(document, data, "");
  const page = new DOMParser().parseFromString(html, "text/html");
  const runtime = page.querySelector<HTMLScriptElement>(
    "script[data-zai-overview-export-runtime]",
  );
  expect(runtime).not.toBeNull();
  Function("document", runtime!.textContent ?? "")(page);
  return page;
}

describe("buildOverviewExportHtml", () => {
  it("keeps the header views switchable and collapsible in the standalone page", () => {
    const page = exportedPage();
    const tabs = page.querySelectorAll<HTMLElement>(".overview-view-tab");
    const panes = page.querySelectorAll<HTMLElement>(".overview-view-pane");

    expect(tabs[0].classList.contains("active")).toBe(true);
    expect(panes[0].classList.contains("active")).toBe(true);
    tabs[1].click();
    expect(panes[0].classList.contains("active")).toBe(false);
    expect(panes[1].classList.contains("active")).toBe(true);
    tabs[1].click();
    expect(page.querySelector(".overview-view-pane.active")).toBeNull();
  });

  it("keeps the structure diagram collapsible in the standalone page", () => {
    const page = exportedPage();
    const card = page.querySelector(".overview-fig")!;
    const header = page.querySelector<HTMLElement>(".overview-fig-head")!;

    expect(card.classList.contains("open")).toBe(true);
    header.click();
    expect(card.classList.contains("open")).toBe(false);
    header.click();
    expect(card.classList.contains("open")).toBe(true);
  });

  it("keeps section folding and diagram tabs interactive", () => {
    const page = exportedPage();
    const section = page.querySelector(".overview-sec")!;
    const sectionMain = section.querySelector<HTMLElement>(
      ":scope > .overview-sec-main",
    )!;
    const tabs = page.querySelectorAll<HTMLElement>(".mindmap-tab");
    const svgWrap = page.querySelector<HTMLElement>(".mindmap-svg-wrap")!;
    const source = page.querySelector<HTMLElement>(".mindmap-source")!;
    const copyButton = page.querySelector<HTMLElement>(".mindmap-copy-btn")!;

    expect(section.classList.contains("open")).toBe(true);
    sectionMain.click();
    expect(section.classList.contains("open")).toBe(false);

    tabs[1].click();
    expect(svgWrap.style.display).toBe("none");
    expect(source.style.display).toBe("");
    expect(tabs[1].classList.contains("mindmap-tab-active")).toBe(true);
    expect(copyButton.textContent).toBe("复制代码");

    tabs[0].click();
    expect(svgWrap.style.display).toBe("");
    expect(source.style.display).toBe("none");
    expect(tabs[0].classList.contains("mindmap-tab-active")).toBe(true);
    expect(copyButton.textContent).toBe("复制图片");
  });

  it("copies source code and shows section details from diagram nodes", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const page = exportedPage();
    const tabs = page.querySelectorAll<HTMLElement>(".mindmap-tab");
    const copyButton = page.querySelector<HTMLElement>(".mindmap-copy-btn")!;
    const source = page.querySelector<HTMLElement>(".mindmap-source")!;

    tabs[1].click();
    copyButton.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(source.textContent);
    expect(copyButton.textContent).toBe("已复制");

    const node = page.querySelector<HTMLElement>(
      '.zai-mm-node[data-section-no="1"]',
    )!;
    node.dispatchEvent(new Event("click", { bubbles: true }));
    expect(node.classList.contains("zai-mm-sel")).toBe(true);
    expect(page.querySelector(".overview-nd-title")?.textContent).toContain(
      "§1  Method",
    );
    expect(page.querySelector(".overview-nd-gist")?.textContent).toBe(
      "方法概览",
    );
  });

  it("copies the rendered diagram as a PNG", async () => {
    const write = vi.fn(async () => undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { write, writeText: vi.fn() },
    });
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(readonly data: Record<string, Blob>) {}
      },
    );
    vi.stubGlobal(
      "Image",
      class {
        private load?: () => void;
        addEventListener(type: string, listener: () => void): void {
          if (type === "load") this.load = listener;
        }
        set src(_value: string) {
          this.load?.();
        }
      },
    );
    vi.spyOn(globalThis.URL, "createObjectURL").mockReturnValue("blob:test");
    vi.spyOn(globalThis.URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      scale: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => callback(new Blob(["png"], { type: "image/png" })),
    );

    const page = exportedPage();
    const copyButton = page.querySelector<HTMLElement>(".mindmap-copy-btn")!;
    copyButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(write).toHaveBeenCalledOnce();
    expect(copyButton.textContent).toBe("已复制");
  });

  it("keeps wheel zoom active in the standalone page", () => {
    const page = exportedPage();
    const svg = page.querySelector<SVGSVGElement>(".zai-mm-svg")!;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 300,
      width: 600,
      height: 300,
      toJSON: () => ({}),
    });
    const initialViewBox = svg.getAttribute("viewBox");

    svg.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: 300,
        clientY: 150,
        deltaY: -1,
      }),
    );

    expect(svg.getAttribute("viewBox")).not.toBe(initialViewBox);
  });
});
