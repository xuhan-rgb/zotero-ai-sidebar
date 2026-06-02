import { describe, it, expect } from "vitest";
import {
  charOffsetsForReaderText,
  clonePlainForScope,
  normalizedReaderTextWithMap,
  pdfRectCenterInside,
  pdfRectDistance,
  pdfRectUnion,
  pdfRects,
  selectionSortIndex,
} from "../../src/modules/pdf-geometry";

describe("pdfRects", () => {
  it("keeps well-formed 4-number rects, drops the rest", () => {
    expect(pdfRects([[1, 2, 3, 4]])).toEqual([[1, 2, 3, 4]]);
    expect(pdfRects([[1, 2, 3]])).toEqual([]); // too short
    expect(pdfRects([[1, 2, 3, "x"]])).toEqual([]); // non-finite
    expect(pdfRects("nope")).toEqual([]);
  });
});

describe("pdfRectUnion", () => {
  it("returns the bounding box of two rects", () => {
    expect(pdfRectUnion([0, 0, 2, 2], [1, 1, 3, 3])).toEqual([0, 0, 3, 3]);
  });
});

describe("pdfRectCenterInside", () => {
  it("checks whether the first rect's center falls inside the target", () => {
    expect(pdfRectCenterInside([0, 0, 2, 2], [0, 0, 10, 10])).toBe(true);
    expect(pdfRectCenterInside([20, 20, 22, 22], [0, 0, 10, 10])).toBe(false);
  });
});

describe("pdfRectDistance", () => {
  it("is 0 for overlapping rects and positive for separated ones", () => {
    expect(pdfRectDistance([0, 0, 2, 2], [1, 1, 3, 3])).toBe(0);
    expect(pdfRectDistance([0, 0, 2, 2], [5, 0, 7, 2])).toBe(3); // horizontal gap
  });
});

describe("normalizedReaderTextWithMap", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizedReaderTextWithMap("Hello   World").text).toBe(
      "hello world",
    );
  });

  it("maps each output char back to a source index", () => {
    const { text, map } = normalizedReaderTextWithMap("Ab");
    expect(text).toBe("ab");
    expect(map).toEqual([0, 1]);
  });
});

describe("charOffsetsForReaderText", () => {
  it("finds the [start,end) offsets of a needle in reader chars", () => {
    const chars = [{ c: "h" }, { c: "i" }, { c: "!" }];
    expect(charOffsetsForReaderText(chars, "hi")).toEqual([0, 2]);
    expect(charOffsetsForReaderText(chars, "zz")).toBeNull();
  });
});

describe("selectionSortIndex", () => {
  it("produces a zero-padded, lexically sortable key", () => {
    const key = selectionSortIndex(2, 5, [[0, 0, 10, 90]], [0, 0, 100, 100]);
    expect(key.startsWith("00002|000005|")).toBe(true);
    const earlier = selectionSortIndex(2, 3, [[0, 0, 10, 90]], [0, 0, 100, 100]);
    expect(earlier < key).toBe(true);
  });
});

describe("clonePlainForScope", () => {
  it("deep-clones JSON-serializable values", () => {
    const src = { a: 1, b: [2, 3] };
    const out = clonePlainForScope(src);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
    expect(out.b).not.toBe(src.b);
  });
});
