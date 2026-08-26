import { describe, expect, it } from "vitest";

import {
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
