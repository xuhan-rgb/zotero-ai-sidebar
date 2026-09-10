import { expect, it } from "vitest";
import { webPdfOutline } from "../../src/modules/web-pdf-outline";
import { detectOutline } from "../../src/context/pdf-outline";
import { DEFAULT_CONTEXT_POLICY } from "../../src/context/policy";
const text =
  "Paper title\nAbstract— Abstract body.\nI. INTRODUCTION\nIntroduction body.\nII. RELATED WORK\nRelated body.\nIII. 2-D AOA ESTIMATION\nMethod body.\n\fA. Phase Error Model\nErrors Fig. 3.\nB. Phase Calibration Method\nCalibration.\nIV. EXPERIMENTS\nResults.\nA. Phase calibration\nExperimental calibration.\nREFERENCES\n[1] Reference.";
it("extracts IEEE titles and repeated letter subsections with original text offsets", () => {
  const entries = webPdfOutline(text)!;
  expect(entries.map((s) => s.no)).toEqual([
    "abstract",
    "I",
    "II",
    "III",
    "III.A",
    "III.B",
    "IV",
    "IV.A",
    "references",
  ]);
  expect(entries.find((s) => s.no === "III.A")).toMatchObject({
    title: "Phase Error Model",
    level: 2,
    anchors: ["Fig.3"],
  });
  for (const s of entries)
    expect(text.slice(s.charStart, s.charEnd)).not.toBe("");
  const sub = entries.find((s) => s.no === "III.A")!;
  expect(text.slice(sub.charStart, sub.charEnd)).toBe(
    "A. Phase Error Model\nErrors Fig. 3.\n",
  );
  expect(entries[0].preview).toBe("Abstract body.");
});
it("leaves the existing API outline behavior unchanged", () => {
  expect(detectOutline(text, DEFAULT_CONTEXT_POLICY)[0].no).toBe("~1");
});
it("does not turn isolated figure text or a lettered list into an IEEE outline", () => {
  expect(
    webPdfOutline("A. First choice\nB. Second choice\nC. Third choice"),
  ).toBeUndefined();
});

it("uses the IEEE outline when preparing WEB overviews from a fallback PDF", async () => {
  const { prepareWebOverview } =
    await import("../../src/modules/web-paper-actions");
  const outline = await prepareWebOverview({
    itemID: 1,
    source: { getItem: async () => null, getFullText: async () => text },
  });
  expect(outline.coverage).toBe("headings");
  expect(
    outline.sections.some(
      (s) => s.title === "Phase Error Model" && s.level === 2,
    ),
  ).toBe(true);
});
