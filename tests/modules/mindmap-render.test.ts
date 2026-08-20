import { describe, expect, it, vi } from "vitest";
import {
  parseMermaidMindmap,
  renderMindmapBlock,
  renderMindmapSvg,
} from "../../src/modules/mindmap-render";
import { detailedNetworkGraphToMindmap } from "../../src/context/network-diagram-types";

function ctrlWheel(init: WheelEventInit): WheelEvent {
  const event = new WheelEvent("wheel", { ...init, ctrlKey: true });
  // happy-dom does not currently initialize MouseEvent modifier fields on
  // WheelEvent, while Zotero/Gecko does.
  if (!event.ctrlKey) Object.defineProperty(event, "ctrlKey", { value: true });
  return event;
}

describe("parseMermaidMindmap", () => {
  it("returns null for non-mindmap diagrams", () => {
    expect(parseMermaidMindmap("graph TD\n  A-->B")).toBeNull();
    expect(parseMermaidMindmap("flowchart LR\n  A-->B")).toBeNull();
    expect(parseMermaidMindmap("")).toBeNull();
  });

  it("parses root((label)) as root type", () => {
    const result = parseMermaidMindmap("mindmap\n  root((SAMURAI))");
    expect(result).not.toBeNull();
    expect(result!.nodes[0]).toMatchObject({ label: "SAMURAI", type: "root" });
  });

  it("parses (label) as section type", () => {
    const result = parseMermaidMindmap("mindmap\n  root\n    (Section A)");
    expect(result!.nodes[1]).toMatchObject({
      label: "Section A",
      type: "section",
    });
  });

  it("parses plain text as point type", () => {
    const result = parseMermaidMindmap(
      "mindmap\n  root\n    section\n      detail",
    );
    expect(result!.nodes[2]).toMatchObject({ label: "detail", type: "point" });
  });

  it("builds correct parent→child edges", () => {
    const src = `mindmap
  root((Root))
    Child A
      Grandchild
    Child B`;
    const result = parseMermaidMindmap(src)!;
    expect(result.nodes.map((n) => n.label)).toEqual([
      "Root",
      "Child A",
      "Grandchild",
      "Child B",
    ]);
    // Root→Child A, Child A→Grandchild, Root→Child B
    expect(result.edges).toHaveLength(3);
    expect(result.edges[0]).toMatchObject({
      source: result.nodes[0].id,
      target: result.nodes[1].id,
    });
    expect(result.edges[1]).toMatchObject({
      source: result.nodes[1].id,
      target: result.nodes[2].id,
    });
    expect(result.edges[2]).toMatchObject({
      source: result.nodes[0].id,
      target: result.nodes[3].id,
    });
  });

  it("handles the SAMURAI mindmap structure", () => {
    const src = `mindmap
  root((SAMURAI))
    论文定位
      基于 SAM 2 的视觉目标跟踪方法
      Zero-shot visual tracking
    核心问题
      SAM 2 分割能力强
        但直接用于跟踪不够稳`;
    const result = parseMermaidMindmap(src)!;
    expect(result.nodes[0]).toMatchObject({ label: "SAMURAI", type: "root" });
    // root → 论文定位, root → 核心问题
    const rootId = result.nodes[0].id;
    const rootEdges = result.edges.filter((e) => e.source === rootId);
    expect(rootEdges).toHaveLength(2);
    expect(result.nodes.length).toBe(7);
    expect(result.edges.length).toBe(6);
  });

  it("treats first plain-text node as root when no ((root)) syntax", () => {
    const result = parseMermaidMindmap("mindmap\n  MyRoot\n    Child");
    expect(result!.nodes[0]).toMatchObject({ label: "MyRoot", type: "root" });
    expect(result!.nodes[1]).toMatchObject({ type: "point" });
  });
});

describe("renderMindmapSvg", () => {
  it("lays a cached network model out from top input to bottom output", () => {
    const svg = renderMindmapSvg(
      document,
      detailedNetworkGraphToMindmap({
        rankdir: "LR",
        nodes: [
          {
            id: "input",
            label: "输入",
            type: "root",
            stage: "inputs-preprocess",
            description: "输入张量",
            evidenceIDs: [],
          },
          {
            id: "encoder",
            label: "编码器",
            type: "innovation",
            stage: "core-innovations",
            description: "编码特征",
            evidenceIDs: [],
          },
          {
            id: "output",
            label: "模型预测 + metrics",
            type: "result",
            stage: "outputs",
            description: "模型预测",
            evidenceIDs: [],
          },
          {
            id: "state",
            label: "Inference state manager",
            type: "point",
            stage: "inference-path",
            description: "运行时缓存",
            evidenceIDs: [],
          },
        ],
        edges: [
          { source: "input", target: "encoder" },
          { source: "encoder", target: "output" },
        ],
      }),
    );
    const centerY = (id: string) => {
      const rect = svg.querySelector<SVGRectElement>(
        `[data-node-id="${id}"] rect`,
      )!;
      return (
        Number(rect.getAttribute("y")) + Number(rect.getAttribute("height")) / 2
      );
    };

    expect(svg.querySelector('[data-node-id="state"]')).toBeNull();
    expect(centerY("encoder")).toBeGreaterThan(centerY("input"));
    expect(centerY("output")).toBeGreaterThan(centerY("encoder"));
  });

  it("keeps its natural size so a wide diagram is not squeezed unreadably", () => {
    const svg = renderMindmapSvg(document, {
      rankdir: "LR",
      nodes: [
        { id: "a", label: "Start", type: "root" },
        { id: "b", label: "A wide intermediate node", type: "section" },
        { id: "c", label: "Result", type: "result" },
      ],
      edges: [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
      ],
    });

    expect(svg.getAttribute("width")).toBe(svg.dataset.naturalW);
    expect(svg.getAttribute("height")).toBe(svg.dataset.naturalH);
  });

  it("offers fit, zoom, and focus controls for a diagram workspace", () => {
    const block = renderMindmapBlock(
      document,
      {
        nodes: [
          { id: "input", label: "Input", type: "root" },
          { id: "output", label: "Output", type: "result" },
        ],
        edges: [{ source: "input", target: "output" }],
      },
      { viewportControls: true },
    );
    const zoom = block.querySelector<HTMLElement>(".mindmap-zoom-value")!;
    expect(zoom.textContent).toBe("100%");
    block.querySelector<HTMLButtonElement>(".mindmap-zoom-in")!.click();
    expect(zoom.textContent).toBe("118%");
    block.querySelector<HTMLButtonElement>(".mindmap-fit")!.click();
    expect(zoom.textContent).toBe("100%");
  });

  it("allows a diagram to opt into a 25% minimum wheel zoom", () => {
    const block = renderMindmapBlock(
      document,
      {
        nodes: [
          { id: "input", label: "Input", type: "root" },
          { id: "output", label: "Output", type: "result" },
        ],
        edges: [{ source: "input", target: "output" }],
      },
      { viewportControls: true, minimumZoom: 0.25 },
    );
    const svg = block.querySelector<SVGSVGElement>(".zai-mm-svg")!;
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

    for (let index = 0; index < 20; index += 1) {
      svg.dispatchEvent(
        ctrlWheel({
          cancelable: true,
          clientX: 300,
          clientY: 150,
          deltaY: 120,
        }),
      );
    }

    expect(block.querySelector(".mindmap-zoom-value")?.textContent).toBe("25%");
  });

  it("does not shrink an inline diagram below its complete fitted view", () => {
    const block = renderMindmapBlock(document, {
      nodes: [
        { id: "input", label: "Input", type: "root" },
        { id: "output", label: "Output", type: "result" },
      ],
      edges: [{ source: "input", target: "output" }],
    });
    const svg = block.querySelector<SVGSVGElement>(".zai-mm-svg")!;
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

    for (let index = 0; index < 10; index += 1) {
      svg.dispatchEvent(
        ctrlWheel({
          cancelable: true,
          clientX: 300,
          clientY: 150,
          deltaY: 120,
        }),
      );
    }

    expect(svg.getAttribute("viewBox")).toBe(
      `0 0 ${svg.dataset.naturalW} ${svg.dataset.naturalH}`,
    );
  });

  it("keeps a zoomed diagram inside its natural canvas while panning", () => {
    const block = renderMindmapBlock(document, {
      nodes: [
        { id: "input", label: "Input", type: "root" },
        { id: "output", label: "Output", type: "result" },
      ],
      edges: [{ source: "input", target: "output" }],
    });
    const svg = block.querySelector<SVGSVGElement>(".zai-mm-svg")!;
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
    svg.dispatchEvent(
      ctrlWheel({
        cancelable: true,
        clientX: 300,
        clientY: 150,
        deltaY: -120,
      }),
    );
    svg.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 300, clientY: 150 }),
    );
    svg.dispatchEvent(
      new PointerEvent("pointermove", { clientX: -10_000, clientY: -10_000 }),
    );

    const [x, y, width, height] = svg
      .getAttribute("viewBox")!
      .split(/\s+/)
      .map(Number);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + width).toBeLessThanOrEqual(Number(svg.dataset.naturalW));
    expect(y + height).toBeLessThanOrEqual(Number(svg.dataset.naturalH));
  });

  it("leaves ordinary wheel events to the surrounding Zotero conversation", () => {
    const block = renderMindmapBlock(document, {
      nodes: [
        { id: "input", label: "Input", type: "root" },
        { id: "output", label: "Output", type: "result" },
      ],
      edges: [{ source: "input", target: "output" }],
    });
    const svg = block.querySelector<SVGSVGElement>(".zai-mm-svg")!;
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
    const event = new WheelEvent("wheel", {
      cancelable: true,
      clientX: 300,
      clientY: 150,
      deltaY: -120,
    });

    svg.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(svg.getAttribute("viewBox")).toBe(initialViewBox);
  });

  it("normalizes Gecko line-based wheel deltas to a useful zoom step", () => {
    const block = renderMindmapBlock(document, {
      nodes: [
        { id: "input", label: "Input", type: "root" },
        { id: "output", label: "Output", type: "result" },
      ],
      edges: [{ source: "input", target: "output" }],
    });
    const svg = block.querySelector<SVGSVGElement>(".zai-mm-svg")!;
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
    const event = ctrlWheel({
      cancelable: true,
      clientX: 300,
      clientY: 150,
      deltaMode: WheelEvent.DOM_DELTA_LINE,
      deltaY: -3,
    });

    svg.dispatchEvent(event);

    const naturalWidth = Number(svg.dataset.naturalW);
    const zoomedWidth = Number(svg.getAttribute("viewBox")!.split(/\s+/)[2]);
    expect(zoomedWidth).toBeLessThan(naturalWidth * 0.9);
  });

  it("zooms in Zotero chrome documents without a global WheelEvent constructor", () => {
    const block = renderMindmapBlock(document, {
      nodes: [
        { id: "input", label: "Input", type: "root" },
        { id: "output", label: "Output", type: "result" },
      ],
      edges: [{ source: "input", target: "output" }],
    });
    const svg = block.querySelector<SVGSVGElement>(".zai-mm-svg")!;
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
    const event = ctrlWheel({
      bubbles: true,
      cancelable: true,
      clientX: 300,
      clientY: 150,
      deltaMode: 1,
      deltaY: -3,
    });
    vi.stubGlobal("WheelEvent", undefined);

    expect(() => svg.dispatchEvent(event)).not.toThrow();
    expect(svg.getAttribute("viewBox")).not.toBe(
      `0 0 ${svg.dataset.naturalW} ${svg.dataset.naturalH}`,
    );
    vi.unstubAllGlobals();
  });

  it("moves image copying into a context menu for a compact graph toolbar", () => {
    const block = renderMindmapBlock(
      document,
      {
        nodes: [{ id: "input", label: "Input", type: "root" }],
        edges: [],
      },
      {
        viewportControls: true,
        sourceTab: false,
        copyButton: false,
        contextMenuCopy: true,
      },
    );

    expect(block.querySelector(".mindmap-source-tab")).toBeNull();
    expect(block.querySelector(".mindmap-copy-btn")).toBeNull();
    const svgWrap = block.querySelector<HTMLElement>(".mindmap-svg-wrap")!;
    svgWrap.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 24,
        clientY: 32,
      }),
    );
    const menu = block.querySelector<HTMLElement>(".mindmap-context-menu")!;
    expect(menu.hidden).toBe(false);
    expect(menu.textContent).toContain("复制图片");
  });
});
