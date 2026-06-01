import { describe, expect, it } from "vitest";
import { detectOutline } from "../../src/context/pdf-outline";

const POLICY = {
  outlinePreviewChars: 80,
  maxOutlineEntries: 40,
  outlineFallbackWindows: 6,
};

describe("detectOutline", () => {
  it("detects numbered headings and assigns char ranges", () => {
    const text =
      "Abstract\nWe study X.\n\n1 Introduction\nMotivation here.\n\n2 Method\nWe propose Y.\n\n3 Conclusion\nDone.";
    const out = detectOutline(text, POLICY);
    expect(out.map((e) => e.title)).toEqual([
      "Abstract",
      "Introduction",
      "Method",
      "Conclusion",
    ]);
    expect(out[1].no).toBe("1");
    expect(out[1].charStart).toBeLessThan(out[2].charStart);
    expect(out[1].preview.length).toBeLessThanOrEqual(80);
    expect(text.slice(out[1].charStart, out[1].charEnd)).toContain("Motivation");
  });

  it("detects dotted subsection levels", () => {
    const text = "3 Method\nintro\n\n3.1 Encoder\ndetails\n\n3.2 Loss\nmore";
    const out = detectOutline(text, POLICY);
    const enc = out.find((e) => e.title === "Encoder")!;
    expect(enc.no).toBe("3.1");
    expect(enc.level).toBe(2);
  });

  it("detects all-caps section names", () => {
    const text =
      "INTRODUCTION\nbody\n\nRELATED WORK\nbody2\n\nREFERENCES\n[1] ...";
    const out = detectOutline(text, POLICY);
    expect(out.map((e) => e.title)).toEqual([
      "INTRODUCTION",
      "RELATED WORK",
      "REFERENCES",
    ]);
  });

  it("falls back to even windows when too few headings are found", () => {
    const text = "x".repeat(6000); // no headings
    const out = detectOutline(text, POLICY);
    expect(out.length).toBe(6);
    expect(out[0].no.startsWith("~")).toBe(true);
    expect(out[0].charStart).toBe(0);
    expect(out[5].charEnd).toBe(6000);
  });
});
