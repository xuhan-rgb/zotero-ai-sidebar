import { describe, expect, it } from "vitest";
import {
  resolveArxivId,
  resolveArxivIdForItemID,
  resolveArxivIdForLibraryItem,
} from "../../src/context/arxiv-id";

describe("resolveArxivId", () => {
  it("reads a new-style id from the Extra field", () => {
    expect(resolveArxivId({ extra: "arXiv: 2504.16054\nfoo: bar" })).toBe("2504.16054");
  });
  it("reads an id with a version suffix", () => {
    expect(resolveArxivId({ extra: "tex.eprint: 2504.16054v1" })).toBe("2504.16054v1");
  });
  it("reads an id from an arxiv abs/pdf url", () => {
    expect(resolveArxivId({ url: "https://arxiv.org/abs/2504.16054" })).toBe("2504.16054");
  });
  it("reads an id from a 10.48550 arXiv DOI", () => {
    expect(resolveArxivId({ doi: "10.48550/arXiv.2504.16054" })).toBe("2504.16054");
  });
  it("reads a legacy-style id", () => {
    expect(resolveArxivId({ url: "https://arxiv.org/abs/hep-th/9901001" })).toBe("hep-th/9901001");
  });
  it("returns null for non-arxiv metadata", () => {
    expect(resolveArxivId({ doi: "10.1145/3534678.3539043", url: "https://example.com" })).toBeNull();
  });

  it("resolves the same shared arXiv id for different Zotero item keys", () => {
    const items = new Map([
      ["ITEM0001", zoteroItem("ITEM0001", "2504.16054")],
      ["ITEM0002", zoteroItem("ITEM0002", "2504.16054")],
    ]);
    Object.defineProperty(globalThis, "Zotero", {
      configurable: true,
      value: {
        Items: {
          getByLibraryAndKey: (_libraryID: number, key: string) =>
            items.get(key) ?? null,
          get: (id: number) => items.get(`ITEM000${id}`) ?? null,
        },
      },
    });

    expect(resolveArxivIdForLibraryItem(1, "ITEM0001")).toBe("2504.16054");
    expect(resolveArxivIdForLibraryItem(1, "ITEM0002")).toBe("2504.16054");
    expect(resolveArxivIdForItemID(1)).toBe("2504.16054");
    expect(resolveArxivIdForItemID(2)).toBe("2504.16054");
  });

  it("finds an arXiv id stored on a Zotero attachment", () => {
    const attachment = zoteroItem("PDF00001", "2303.05367");
    const parent = {
      ...zoteroItem("ITEM0001", null),
      getAttachments: () => [2],
    };
    Object.defineProperty(globalThis, "Zotero", {
      configurable: true,
      value: {
        Items: {
          getByLibraryAndKey: () => parent,
          get: (id: number) => (id === 2 ? attachment : null),
        },
      },
    });

    expect(resolveArxivIdForLibraryItem(1, "ITEM0001")).toBe("2303.05367");
  });
});

function zoteroItem(key: string, arxivId: string | null) {
  return {
    key,
    libraryID: 1,
    getField: (field: string) =>
      field === "archiveID" && arxivId ? `arXiv:${arxivId}` : "",
    getAttachments: () => [] as number[],
  };
}
