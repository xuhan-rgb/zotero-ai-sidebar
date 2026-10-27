import { describe, expect, it } from "vitest";
import {
  findFloatingReaderSpace,
  type ReaderRect,
} from "../../src/modules/floating-reader-space";

const viewport: ReaderRect = { left: 0, top: 0, width: 1000, height: 800 };

function overlaps(a: ReaderRect, b: ReaderRect, gap = 0) {
  return (
    a.left < b.left + b.width + gap &&
    a.left + a.width > b.left - gap &&
    a.top < b.top + b.height + gap &&
    a.top + a.height > b.top - gap
  );
}

describe("findFloatingReaderSpace", () => {
  it("places the PDF upper-left when the answer is on the right and composer is below", () => {
    const result = findFloatingReaderSpace(
      viewport,
      { left: 680, top: 40, width: 300, height: 500 },
      { left: 300, top: 620, width: 500, height: 150 },
      "left",
    );
    expect(result).not.toBeNull();
    expect(result!.left + result!.width).toBeLessThanOrEqual(672);
    expect(result!.top).toBe(0);
    expect(result!.height).toBeGreaterThanOrEqual(160);
    expect(
      overlaps(result!, { left: 300, top: 620, width: 500, height: 150 }, 8),
    ).toBe(false);
  });

  it("places the PDF upper-right when the answer is on the left and composer is below", () => {
    const answer = { left: 20, top: 40, width: 300, height: 500 };
    const composer = { left: 200, top: 620, width: 500, height: 150 };
    const result = findFloatingReaderSpace(viewport, answer, composer, "right");
    expect(result).not.toBeNull();
    expect(result!.left).toBeGreaterThanOrEqual(328);
    expect(result!.top).toBe(0);
    expect(overlaps(result!, answer, 8)).toBe(false);
    expect(overlaps(result!, composer, 8)).toBe(false);
  });

  it("avoids a bottom composer when no answer obstacle is present", () => {
    const composer = { left: 0, top: 650, width: 1000, height: 150 };
    const result = findFloatingReaderSpace(viewport, null, composer, "left");
    expect(result).not.toBeNull();
    expect(result!.top + result!.height).toBeLessThanOrEqual(642);
    expect(overlaps(result!, composer, 8)).toBe(false);
  });

  it("ignores hidden, zero-area, and offscreen obstacles", () => {
    const visible = { left: 700, top: 100, width: 250, height: 400 };
    const result = findFloatingReaderSpace(
      viewport,
      visible,
      { left: 20, top: 20, width: 0, height: 500 },
      "left",
    );
    expect(result).not.toBeNull();
    expect(result!.left + result!.width).toBeLessThanOrEqual(692);
    expect(findFloatingReaderSpace(viewport, null, null, "left")).toEqual({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
    });
    const offscreen = findFloatingReaderSpace(
      viewport,
      { left: 1200, top: 50, width: 300, height: 300 },
      null,
      "left",
    );
    expect(offscreen).toEqual({ left: 0, top: 0, width: 1000, height: 800 });
  });

  it("falls back to the largest available space when the preferred side is too narrow", () => {
    const result = findFloatingReaderSpace(
      viewport,
      { left: 30, top: -20, width: 1100, height: 400 },
      { left: 350, top: 500, width: 500, height: 200 },
      "right",
    );
    expect(result).not.toBeNull();
    expect(result!.width).toBeGreaterThanOrEqual(240);
    expect(result!.height).toBeGreaterThanOrEqual(160);
    expect(
      overlaps(result!, { left: 30, top: -20, width: 1100, height: 400 }, 8),
    ).toBe(false);
    expect(
      overlaps(result!, { left: 350, top: 500, width: 500, height: 200 }, 8),
    ).toBe(false);
  });

  it("prefers a usable fallback rectangle over a larger narrow strip", () => {
    const localViewport = { left: 0, top: 0, width: 1000, height: 800 };
    const result = findFloatingReaderSpace(
      localViewport,
      { left: 239, top: 0, width: 361, height: 800 },
      { left: 608, top: 0, width: 392, height: 600 },
      "left",
    );
    expect(result).not.toBeNull();
    expect(result!.width).toBeGreaterThanOrEqual(240);
    expect(result!.height).toBeGreaterThanOrEqual(160);
    expect(
      overlaps(result!, { left: 239, top: 0, width: 361, height: 800 }, 8),
    ).toBe(false);
    expect(
      overlaps(result!, { left: 608, top: 0, width: 392, height: 600 }, 8),
    ).toBe(false);
  });

  it("returns null when obstacles cover the viewport and for an invalid viewport", () => {
    expect(
      findFloatingReaderSpace(
        { left: 0, top: 0, width: 100, height: 80 },
        { left: 0, top: 0, width: 100, height: 80 },
        null,
        "left",
      ),
    ).toBeNull();
    expect(
      findFloatingReaderSpace({ ...viewport, width: 0 }, null, null, "left"),
    ).toBeNull();
  });

  it("returns an in-viewport rectangle with positive free area without mutating inputs", () => {
    const answer = { left: 610, top: 50, width: 280, height: 500 };
    const composer = { left: 300, top: 600, width: 500, height: 180 };
    const before = structuredClone({ viewport, answer, composer });
    const result = findFloatingReaderSpace(viewport, answer, composer, "left");
    expect(result).not.toBeNull();
    expect(result!.left).toBeGreaterThanOrEqual(viewport.left);
    expect(result!.top).toBeGreaterThanOrEqual(viewport.top);
    expect(result!.left + result!.width).toBeLessThanOrEqual(
      viewport.left + viewport.width,
    );
    expect(result!.top + result!.height).toBeLessThanOrEqual(
      viewport.top + viewport.height,
    );
    expect(result!.width).toBeGreaterThan(0);
    expect(result!.height).toBeGreaterThan(0);
    expect(overlaps(result!, answer, 8)).toBe(false);
    expect(overlaps(result!, composer, 8)).toBe(false);
    expect({ viewport, answer, composer }).toEqual(before);
  });
});
