import { afterEach, describe, expect, it, vi } from "vitest";

import {
  sectionLocateNeedles,
  selectionRangesFromLocator,
  setReaderTextLayerSelection,
} from "../../src/modules/pdf-navigation";

describe("PDF selection restoration", () => {
  it("recomputes stale processed offsets instead of selecting the wrong text", () => {
    const chars = Array.from("wrongtarget").map((c, index) => ({
      c,
      inlineRect: [index * 10, 0, index * 10 + 8, 10],
      ...(index === 4 ? { spaceAfter: true } : {}),
    }));
    const view = {
      _pdfPages: [{ chars, viewBox: [0, 0, 200, 200] }],
    };

    const ranges = selectionRangesFromLocator(view, {
      attachmentID: 7,
      selectedText: "target",
      pageIndex: 0,
      pageLabel: "1",
      position: {
        pageIndex: 0,
        rects: [[50, 0, 108, 10]],
        zaiAnchorOffset: 0,
        zaiHeadOffset: 5,
      },
    });

    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({
      anchorOffset: 5,
      headOffset: 11,
    });
  });

  it("selects the complete expected text when DOM offsets point elsewhere", () => {
    document.body.innerHTML =
      '<div data-page-number="1"><div class="textLayer">prefix target suffix</div></div>';
    const view = {
      _iframeWindow: window,
      focus() {},
    };

    const restored = setReaderTextLayerSelection(
      view,
      [
        {
          pageIndex: 0,
          anchorOffset: 0,
          headOffset: 6,
        },
      ],
      "target",
    );

    expect(restored).toBe(true);
    expect(window.getSelection()?.toString()).toBe("target");
  });
});

describe("overview section heading location", () => {
  afterEach(() => vi.restoreAllMocks());

  it("tries the numbered heading before the cached LaTeX body sentence", async () => {
    const arxivID = await import("../../src/context/arxiv-id");
    const arxivTools = await import("../../src/context/arxiv-tools");
    vi.spyOn(arxivID, "resolveArxivIdForItemID").mockReturnValue("2110.06864");
    vi.spyOn(arxivTools, "loadArxivSectionsForArxivId").mockResolvedValue([
      {
        number: "3",
        title: "BYTE",
        level: 1,
        start: 0,
        end: 200,
        body: "We propose a simple, effective and generic data association method, BYTE.",
      },
    ]);
    const needles = await sectionLocateNeedles(1560, {
      no: "3",
      title: "BYTE",
      level: 1,
      charStart: 0,
      charEnd: 200,
    });
    expect(needles.slice(0, 3)).toEqual(["3 BYTE", "3. BYTE", "BYTE"]);
    expect(needles[3]).toContain("We propose a simple");
  });
});

it("uses the original WEB heading instead of a title also found in figure text", async () => {
  const needles = await sectionLocateNeedles(null, {
    no: "V.A", title: "Phase calibration", level: 2, charStart: 100, charEnd: 200,
    headingText: "A. Phase calibration",
  });
  expect(needles).toEqual(["A. Phase calibration"]);
});
