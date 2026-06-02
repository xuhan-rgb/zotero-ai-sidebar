import { describe, expect, it } from "vitest";
import { renderOverviewBlock } from "../../src/modules/overview-view";
import type { OverviewData } from "../../src/context/overview-types";

const data: OverviewData = {
  title: "T",
  source: "pdf",
  coverage: "headings",
  narrative: "一句话核心讲述，结尾点出贡献。",
  sections: [
    { no: "1", level: 1, title: "Intro", gist: "动机", charStart: 0, charEnd: 5, phase: "motivation", emphasis: "background" },
    { no: "3", level: 1, title: "Method", gist: "新方法", charStart: 5, charEnd: 9, phase: "method", emphasis: "innovation", anchors: ["Fig.1"] },
    { no: "3.1", level: 2, title: "Sub", gist: "子节", charStart: 5, charEnd: 7, phase: "method" },
    { no: "9", level: 1, title: "Exp", gist: "结果", charStart: 9, charEnd: 12, phase: "validation", emphasis: "result" },
  ],
  flowchart: {
    rankdir: "TB",
    nodes: [{ id: "a", label: "A", type: "innovation", sectionNo: "3" }],
    edges: [],
  },
};

describe("renderOverviewBlock (lean redesign)", () => {
  it("renders narrative, phased emphasis skeleton, subsections, folded flowchart", () => {
    const jumped: string[] = [];
    const block = renderOverviewBlock(document, data, {
      onJumpToSection: (s) => jumped.push(s.no),
    });
    expect(block.querySelector(".overview-narrative")?.textContent).toContain(
      "贡献",
    );
    // top-level sections = 3 (1, 3, 9); 3.1 nests as a child
    expect(block.querySelectorAll(".overview-sec").length).toBe(3);
    expect(block.querySelectorAll(".overview-phase").length).toBe(3);
    const innov = block.querySelector(".overview-sec.is-innovation");
    expect(innov).toBeTruthy();
    expect(innov!.textContent).toContain("创新");
    expect(block.querySelectorAll(".overview-kid").length).toBe(1);
    expect(block.querySelector(".overview-fig .mindmap-block")).toBeTruthy();
    // §3 Method has a subsection → clicking it expands (does not jump)
    const methodHead = innov!.querySelector(".overview-sec-head") as HTMLElement;
    methodHead.click();
    expect(innov!.classList.contains("open")).toBe(true);
    // §1 Introduction is a leaf → clicking it jumps to the PDF
    const intro = block.querySelectorAll(".overview-sec")[0];
    (intro.querySelector(".overview-sec-head") as HTMLElement).click();
    expect(jumped).toContain("1");
  });

  it("marks activeNo as 在读 and moves the marker on click", () => {
    const block = renderOverviewBlock(document, data, {
      onJumpToSection: () => {},
      activeNo: "1",
    });
    // §1 is a leaf → its main row carries the marker on render
    const intro = block.querySelectorAll(".overview-sec")[0];
    expect(intro.querySelector(".overview-sec-main.is-reading")).toBeTruthy();
    expect(block.querySelectorAll(".is-reading").length).toBe(1);
    // clicking subsection 3.1 moves the marker there, clearing §1
    const kid = block.querySelector(".overview-kid") as HTMLElement;
    kid.click();
    expect(kid.classList.contains("is-reading")).toBe(true);
    expect(intro.querySelector(".is-reading")).toBeNull();
    expect(block.querySelectorAll(".is-reading").length).toBe(1);
  });

  it("renders without narrative/flowchart when absent", () => {
    const block = renderOverviewBlock(document, {
      ...data,
      narrative: undefined,
      flowchart: undefined,
    });
    expect(block.querySelector(".overview-narrative")).toBeNull();
    expect(block.querySelector(".overview-fig")).toBeNull();
    expect(block.querySelectorAll(".overview-sec").length).toBe(3);
  });
});
