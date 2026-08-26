import { describe, expect, it, vi } from "vitest";

import { saveWebAnnotationEntry } from "../../src/modules/web-annotation-save";
import type { WebAnnotationBatchEntry } from "../../src/providers/types";

function snapshot(text: string, pageIndex: number) {
  return {
    text,
    attachmentID: 7,
    annotation: {
      pageLabel: String(pageIndex + 1),
      position: { pageIndex, rects: [[1, 2, 3, 4]] },
    },
  };
}

describe("WEB annotation entry save", () => {
  it("retries only the missing segment after a partial cross-page save", async () => {
    const first = snapshot("first page fragment", 0);
    const second = snapshot("second page fragment", 1);
    const entry: WebAnnotationBatchEntry = {
      quote: "full cross-page sentence",
      comment: "关键限制",
      color: "#ff6666",
      locateState: "located",
      confidence: 1,
      pageLabel: "1–2",
      snapshot: first,
      segments: [
        { snapshot: first, state: { kind: "idle" } },
        { snapshot: second, state: { kind: "idle" } },
      ],
      state: { kind: "idle" },
    };
    let secondAttempts = 0;
    const save = vi.fn(async (candidate: typeof first) => {
      if (candidate === second && secondAttempts++ === 0) {
        throw new Error("second page failed");
      }
      return { id: candidate === first ? 11 : 22 };
    });

    await saveWebAnnotationEntry(entry, save);

    expect(entry.state).toEqual({
      kind: "failed",
      error: "second page failed",
    });
    expect(entry.segments?.[0]?.state).toMatchObject({
      kind: "saved",
      annotationID: 11,
    });
    expect(entry.segments?.[1]?.state).toEqual({
      kind: "failed",
      error: "second page failed",
    });

    await saveWebAnnotationEntry(entry, save);

    expect(save.mock.calls.map(([candidate]) => candidate.text)).toEqual([
      "first page fragment",
      "second page fragment",
      "second page fragment",
    ]);
    expect(entry.segments?.[1]?.state).toMatchObject({
      kind: "saved",
      annotationID: 22,
    });
    expect(entry.state).toMatchObject({ kind: "saved", annotationID: 11 });
  });
});
