import { describe, expect, it, vi } from "vitest";

import { locateWebSelectionAnnotationDraft } from "../../src/modules/web-selection-annotation";

describe("WEB selection annotation snapshot", () => {
  it("rebuilds a saveable annotation snapshot from locally located selected text", async () => {
    const locate = vi.fn(async () => ({
      pageIndex: 2,
      pageLabel: "3",
      rects: [[10, 20, 110, 32] as [number, number, number, number]],
      sortIndex: "00002|000120|00700",
      matchedText: "Selected PDF passage.",
      confidence: 1,
      anchorOffset: 120,
      headOffset: 142,
    }));

    const draft = await locateWebSelectionAnnotationDraft(
      { attachmentID: 77, locate },
      "Selected PDF passage.",
      0.85,
    );

    expect(draft).toEqual({
      text: "Selected PDF passage.",
      attachmentID: 77,
      annotation: {
        type: "highlight",
        text: "Selected PDF passage.",
        pageLabel: "3",
        sortIndex: "00002|000120|00700",
        position: {
          pageIndex: 2,
          rects: [[10, 20, 110, 32]],
          zaiAnchorOffset: 120,
          zaiHeadOffset: 142,
        },
      },
    });
  });

  it("returns null instead of creating an unanchored annotation", async () => {
    const locate = vi.fn(async () => null);

    await expect(
      locateWebSelectionAnnotationDraft(
        { attachmentID: 77, locate },
        "Passage not present in the PDF.",
        0.85,
      ),
    ).resolves.toBeNull();
  });
});
