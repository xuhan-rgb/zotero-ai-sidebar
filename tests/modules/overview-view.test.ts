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
    // §3 Method has a subsection → the caret expands it (without jumping)…
    const caret = innov!.querySelector(".overview-caret") as HTMLElement;
    caret.click();
    expect(innov!.classList.contains("open")).toBe(true);
    expect(jumped).not.toContain("3");
    // …but clicking the title row jumps to the PDF (parents jump too)
    (innov!.querySelector(".overview-sec-title") as HTMLElement).click();
    expect(jumped).toContain("3");
    // §1 Introduction is a leaf → clicking it jumps to the PDF
    const intro = block.querySelectorAll(".overview-sec")[0];
    (intro.querySelector(".overview-sec-title") as HTMLElement).click();
    expect(jumped).toContain("1");
  });

  it("marks nav.readingNo as 在读; a jump moves the anchor + pushes history", () => {
    const nav = { history: [] as string[], locked: false, readingNo: "1" };
    const jumped: string[] = [];
    const block = renderOverviewBlock(document, data, {
      onJumpToSection: (s) => jumped.push(s.no),
      nav,
    });
    const intro = block.querySelectorAll(".overview-sec")[0];
    expect(intro.querySelector(".overview-sec-main.is-reading")).toBeTruthy();
    expect(block.querySelectorAll(".is-reading").length).toBe(1);
    // clicking subsection 3.1 moves the anchor there; §1 goes onto the stack
    const kid = block.querySelector(".overview-kid") as HTMLElement;
    kid.click();
    expect(kid.classList.contains("is-reading")).toBe(true);
    expect(intro.querySelector(".is-reading")).toBeNull();
    expect(nav.readingNo).toBe("3.1");
    expect(nav.history).toEqual(["1"]);
    expect(jumped).toEqual(["3.1"]);
  });

  it("shows the count when nothing is 在读; ↩在读 control re-jumps", () => {
    const empty = renderOverviewBlock(document, data, {});
    const meta0 = empty.querySelector(".overview-meta") as HTMLElement;
    expect(meta0.textContent).toContain("4 章");
    expect(meta0.style.display).not.toBe("none");
    expect(
      (empty.querySelector(".overview-reading") as HTMLElement).style.display,
    ).toBe("none");

    const jumped: string[] = [];
    const nav = { history: [] as string[], locked: false, readingNo: "3.1" };
    const block = renderOverviewBlock(document, data, {
      onJumpToSection: (s) => jumped.push(s.no),
      nav,
    });
    expect((block.querySelector(".overview-meta") as HTMLElement).style.display).toBe(
      "none",
    );
    const label = block.querySelector(".overview-reading-label") as HTMLElement;
    expect(label.textContent).toContain("3.1");
    label.click();
    expect(jumped).toEqual(["3.1"]);
  });

  it("lock pins the anchor: a click marks a dashed browse cursor, 在读 stays", () => {
    const jumped: string[] = [];
    const nav = { history: [] as string[], locked: false, readingNo: "1" };
    const block = renderOverviewBlock(document, data, {
      onJumpToSection: (s) => jumped.push(s.no),
      nav,
    });
    (block.querySelector(".overview-lock") as HTMLElement).click();
    expect(nav.locked).toBe(true);
    // §9 is a leaf (top-level [1,3,9] → index 2)
    const exp = block.querySelectorAll(".overview-sec")[2];
    (exp.querySelector(".overview-sec-main") as HTMLElement).click();
    expect(nav.readingNo).toBe("1");
    expect(nav.browseNo).toBe("9");
    expect(exp.querySelector(".overview-sec-main.is-browsing")).toBeTruthy();
    expect(
      block.querySelectorAll(".overview-sec")[0].querySelector(".is-reading"),
    ).toBeTruthy();
    expect(jumped).toEqual(["9"]);
    // unlocking clears the browse cursor
    (block.querySelector(".overview-lock") as HTMLElement).click();
    expect(nav.locked).toBe(false);
    expect(nav.browseNo).toBeUndefined();
    expect(block.querySelector(".is-browsing")).toBeNull();
  });

  it("↶返回 walks the back stack one step at a time", () => {
    const jumped: string[] = [];
    const nav = { history: [] as string[], locked: false, readingNo: "1" };
    const block = renderOverviewBlock(document, data, {
      onJumpToSection: (s) => jumped.push(s.no),
      nav,
    });
    const back = block.querySelector(".overview-back") as HTMLElement;
    expect(back.style.display).toBe("none");
    (block.querySelectorAll(".overview-sec")[2].querySelector(
      ".overview-sec-main",
    ) as HTMLElement).click(); // → 9, history [1]
    (block.querySelector(".overview-kid") as HTMLElement).click(); // → 3.1, history [1,9]
    expect(nav.history).toEqual(["1", "9"]);
    expect(back.style.display).not.toBe("none");
    expect(back.textContent).toContain("9");
    back.click(); // → 9
    expect(nav.readingNo).toBe("9");
    expect(nav.history).toEqual(["1"]);
    back.click(); // → 1
    expect(nav.readingNo).toBe("1");
    expect(nav.history).toEqual([]);
    expect(jumped).toEqual(["9", "3.1", "9", "1"]);
  });

  it("nests dotted subsections under the parent even when level is wrong (=1)", () => {
    const d: OverviewData = {
      title: "T",
      source: "pdf",
      coverage: "headings",
      sections: [
        { no: "4", level: 1, title: "Methods", charStart: 0, charEnd: 1, phase: "method" },
        // model returned level:1 for these dotted subsections — number wins
        { no: "4.1", level: 1, title: "Sub A", charStart: 1, charEnd: 2, phase: "method" },
        { no: "4.2", level: 1, title: "Sub B", charStart: 2, charEnd: 3, phase: "method" },
        { no: "5", level: 1, title: "Exp", charStart: 3, charEnd: 4, phase: "validation" },
      ],
    };
    const block = renderOverviewBlock(document, d, {});
    // top-level = §4 and §5; 4.1/4.2 nest under §4
    expect(block.querySelectorAll(".overview-sec").length).toBe(2);
    expect(block.querySelectorAll(".overview-kid").length).toBe(2);
    const methods = block.querySelectorAll(".overview-sec")[0];
    expect(methods.querySelectorAll(".overview-kid").length).toBe(2);
  });

  it("a parent with an innovation subsection inherits the 创新 marker", () => {
    const d: OverviewData = {
      title: "T",
      source: "pdf",
      coverage: "headings",
      sections: [
        // §4 itself is NOT marked innovation, but its subsections are
        { no: "4", level: 1, title: "Recipe", charStart: 0, charEnd: 1, phase: "method" },
        { no: "4.1", level: 2, title: "Arch", charStart: 1, charEnd: 2, phase: "method", emphasis: "innovation" },
        { no: "4.2", level: 2, title: "Misc", charStart: 2, charEnd: 3, phase: "method" },
        // a plain leaf with no innovation children stays neutral
        { no: "2", level: 1, title: "Related", charStart: 3, charEnd: 4, phase: "motivation", emphasis: "background" },
      ],
    };
    const block = renderOverviewBlock(document, d, {});
    const recipe = block.querySelectorAll(".overview-sec")[0];
    expect(recipe.classList.contains("is-innovation")).toBe(true);
    expect(recipe.querySelector(".overview-sec-head")?.textContent).toContain("创新");
    // §2 (background, no innovation kids) must NOT become innovation
    const related = block.querySelectorAll(".overview-sec")[1];
    expect(related.classList.contains("is-innovation")).toBe(false);
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
