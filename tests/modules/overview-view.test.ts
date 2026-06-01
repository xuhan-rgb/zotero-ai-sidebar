import { describe, expect, it } from "vitest";
import { renderOverviewBlock } from "../../src/modules/overview-view";
import type { OverviewData } from "../../src/context/overview-types";

const data: OverviewData = {
  title: "T",
  source: "pdf",
  coverage: "headings",
  sections: [
    {
      no: "1",
      level: 1,
      title: "Intro",
      gist: "动机",
      charStart: 0,
      charEnd: 5,
      anchors: ["Fig.1"],
    },
    { no: "3", level: 1, title: "Method", gist: "方法", charStart: 5, charEnd: 9 },
  ],
  flowchart: {
    rankdir: "TB",
    nodes: [{ id: "a", label: "A", type: "root" }],
    edges: [],
  },
};

describe("renderOverviewBlock", () => {
  it("renders a clickable skeleton with gists + a flowchart block", () => {
    const jumped: string[] = [];
    const block = renderOverviewBlock(document, data, {
      onJumpToSection: (s) => jumped.push(s.no),
    });
    const items = block.querySelectorAll(".overview-skeleton > li");
    expect(items.length).toBe(2);
    expect(block.textContent).toContain("动机");
    expect(block.textContent).toContain("Fig.1");
    expect(block.querySelector(".mindmap-block")).toBeTruthy();
    (items[1] as HTMLElement).click();
    expect(jumped).toEqual(["3"]);
  });

  it("renders without a flowchart when none is provided", () => {
    const block = renderOverviewBlock(document, { ...data, flowchart: undefined });
    expect(block.querySelector(".mindmap-block")).toBeNull();
    expect(block.querySelectorAll(".overview-skeleton > li").length).toBe(2);
  });
});
