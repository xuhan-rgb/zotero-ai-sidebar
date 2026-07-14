import { describe, expect, it } from "vitest";
import {
  ARXIV_SOURCE_CLEANER_VERSION,
  isFreshArxivSourceMeta,
} from "../../src/context/arxiv-source";
import type { ArxivMeta } from "../../src/context/arxiv-store";

const baseMeta: ArxivMeta = {
  arxivId: "2504.16054",
  fetchedAt: "2026-05-23T00:00:00.000Z",
  mainTexRelPath: "main.tex",
  status: "ok",
};

describe("isFreshArxivSourceMeta", () => {
  it("accepts ok caches produced by the current cleaner", () => {
    expect(
      isFreshArxivSourceMeta({
        ...baseMeta,
        cleanerVersion: ARXIV_SOURCE_CLEANER_VERSION,
      }),
    ).toBe(true);
  });

  it("rejects older ok caches without a cleaner version", () => {
    expect(isFreshArxivSourceMeta(baseMeta)).toBe(false);
  });

  it("rejects no-source cache markers", () => {
    expect(
      isFreshArxivSourceMeta({
        ...baseMeta,
        status: "no-source",
        mainTexRelPath: "",
        cleanerVersion: ARXIV_SOURCE_CLEANER_VERSION,
      }),
    ).toBe(false);
  });
});
