import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendReferencedPaperFrontBlock,
  listPaperReferences,
  paperReferenceDescription,
  preparePaperReference,
  referencedPaper,
  resolvePaperReference,
  resolvePaperReferences,
} from "../../src/modules/paper-reference";

describe("Zotero paper references", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists sibling papers first and searches all library items on request", async () => {
    const makeItem = (id: number, title: string) => ({
      id,
      libraryID: 1,
      isRegularItem: () => true,
      getField: (field: string) => (field === "title" ? title : "2024"),
      getCreators: () => [{ lastName: "Li" }],
      getAttachments: () => [],
    });
    const current = { ...makeItem(1, "Current"), getCollections: () => [9] };
    const sibling = makeItem(2, "Sibling Paper");
    const other = makeItem(3, "Other Paper");
    const items = new Map([
      [1, current],
      [2, sibling],
      [3, other],
    ]);
    vi.stubGlobal("Zotero", {
      Items: {
        get: (id: number) => items.get(id),
        getAll: async () => [current, sibling, other],
      },
      Collections: {
        get: () => ({
          id: 9,
          name: "工程类",
          getChildItems: () => [current, sibling],
        }),
      },
      getActiveZoteroPane: () => null,
    });
    expect(
      (await listPaperReferences(1, "collection", "")).items.map(
        (item) => item.itemID,
      ),
    ).toEqual([2]);
    expect(
      (await listPaperReferences(1, "library", "Other")).items.map(
        (item) => item.itemID,
      ),
    ).toEqual([3]);
  });

  it("keeps a reference only while its marker remains and labels missing full text", () => {
    const draft = { itemID: 2, title: "Other Paper", marker: "@[Other Paper]" };
    expect(referencedPaper("比较 @[Other Paper]", draft)).toEqual(draft);
    expect(referencedPaper("比较", draft)).toBeNull();
    expect(
      paperReferenceDescription(
        "Other Paper",
        { title: "Other Paper", authors: [], tags: [] },
        "",
      ),
    ).toContain("没有可读正文");
  });

  it("restores an existing @ reference after the draft selection was cleared", async () => {
    const item = {
      id: 3,
      libraryID: 1,
      isRegularItem: () => true,
      getField: () => "SAMURAI",
    };
    vi.stubGlobal("Zotero", {
      Items: { get: (id: number) => (id === 3 ? item : null) },
    });
    const history = [
      { context: { referencedItems: [{ itemID: 3, title: "SAMURAI" }] } },
    ];
    await expect(
      resolvePaperReference("@[SAMURAI] 再比较一次", null, 1560, history),
    ).resolves.toEqual({ itemID: 3, title: "SAMURAI", marker: "@[SAMURAI]" });
  });

  it("resolves a pasted @ marker to a unique paper in the current library", async () => {
    const current = { id: 1, libraryID: 1 };
    const paper = {
      id: 3,
      libraryID: 1,
      isRegularItem: () => true,
      getField: () => "SAMURAI",
    };
    vi.stubGlobal("Zotero", {
      Items: {
        get: (id: number) => (id === 1 ? current : paper),
        getAll: async () => [current, paper],
      },
    });
    await expect(
      resolvePaperReference("@[SAMURAI] 再比较一次", null, 1, []),
    ).resolves.toMatchObject({ itemID: 3, title: "SAMURAI" });
  });

  it("resolves every distinct @ paper in message order", async () => {
    const current = { id: 1, libraryID: 1 };
    const first = {
      id: 2,
      libraryID: 1,
      isRegularItem: () => true,
      getField: () => "First",
    };
    const second = {
      id: 3,
      libraryID: 1,
      isRegularItem: () => true,
      getField: () => "Second",
    };
    vi.stubGlobal("Zotero", {
      Items: {
        get: (id: number) =>
          [current, first, second].find((item) => item.id === id),
        getAll: async () => [current, first, second],
      },
    });
    await expect(
      resolvePaperReferences(
        "比较 @[First] 与 @[Second]，再看 @[First]",
        [],
        1,
        [],
      ),
    ).resolves.toEqual([
      { itemID: 2, title: "First", marker: "@[First]" },
      { itemID: 3, title: "Second", marker: "@[Second]" },
    ]);
  });

  it("keeps multiple menu selections and drops a deleted marker", async () => {
    const drafts = [
      { itemID: 2, title: "First", marker: "@[First]" },
      { itemID: 3, title: "Second", marker: "@[Second]" },
    ];
    await expect(
      resolvePaperReferences("@[First] @[Second]", drafts, null, []),
    ).resolves.toEqual(drafts);
    await expect(
      resolvePaperReferences("@[Second]", drafts, null, []),
    ).resolves.toEqual([drafts[1]]);
  });

  it("falls back to library results when the current item has no collection", async () => {
    const current = { id: 1, libraryID: 1, getCollections: () => [] };
    const other = {
      id: 2,
      libraryID: 1,
      isRegularItem: () => true,
      getField: (field: string) => (field === "title" ? "Other" : ""),
      getCreators: () => [],
      getAttachments: () => [],
    };
    vi.stubGlobal("Zotero", {
      Items: {
        get: (id: number) => (id === 1 ? current : other),
        getAll: async () => [other],
      },
      getActiveZoteroPane: () => null,
    });
    const result = await listPaperReferences(1, "collection", "");
    expect(result.collectionName).toBeNull();
    expect(result.items.map((item) => item.itemID)).toEqual([2]);
  });

  it("prepares complete original text for referenced papers", async () => {
    const fullText = "A".repeat(80_001) + "END";
    const prepared = await preparePaperReference(
      {
        getItem: async () => ({
          title: "Updated Title",
          authors: ["Author"],
          tags: [],
          abstract: "Abstract",
        }),
        getFullText: async () => fullText,
      },
      { itemID: 42, title: "Old Title" },
    );
    expect(prepared.sentChars).toBe(fullText.length);
    expect(prepared.totalChars).toBe(fullText.length);
    expect(prepared.description).toContain("Updated Title");
    expect(prepared.description).toContain(
      `${fullText.length}/${fullText.length} 字；完整`,
    );
    expect(prepared.description).toContain(fullText);
    expect(prepared.description).toContain("END");
  });

  it("keeps current-paper content as the stable prefix before a referenced paper", () => {
    const block = appendReferencedPaperFrontBlock(
      "CURRENT TOC",
      "REFERENCE BODY",
    );
    expect(block).toMatch(/^CURRENT TOC/);
    expect(block).toContain("[Referenced Zotero paper material]");
    expect(block).toContain("REFERENCE BODY");
    expect(appendReferencedPaperFrontBlock("CURRENT TOC", undefined)).toBe(
      "CURRENT TOC",
    );
  });
});
