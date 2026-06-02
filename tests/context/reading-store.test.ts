import { beforeEach, describe, expect, it } from "vitest";
import {
  exportReadingStore,
  importReadingStore,
  listRecentReading,
  loadReading,
  saveReading,
} from "../../src/context/reading-store";

let files: Map<string, string>;

beforeEach(() => {
  files = new Map();
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: {
      DataDirectory: { dir: "/tmp/zotero-data" },
      Profile: { dir: "/tmp/zotero-profile" },
      File: {
        getContentsAsync: async (path: string) => {
          const v = files.get(path);
          if (v == null) throw new Error(`missing file: ${path}`);
          return v;
        },
        putContentsAsync: async (path: string, contents: string) => {
          files.set(path, contents);
        },
      },
    },
  });
});

describe("reading-store", () => {
  it("round-trips a reading record (anchor + title)", async () => {
    await saveReading("K1", { readingNo: "5.2", title: "Paper One" }, 100);
    const got = await loadReading("K1");
    expect(got?.readingNo).toBe("5.2");
    expect(got?.title).toBe("Paper One");
    expect(got?.updatedAt).toBe(100);
  });

  it("listRecentReading sorts newest-first and respects the limit", async () => {
    await saveReading("A", { readingNo: "1", title: "A" }, 100);
    await saveReading("B", { readingNo: "2", title: "B" }, 300);
    await saveReading("C", { title: "C" }, 200); // no readingNo yet
    const recent = await listRecentReading(2);
    expect(recent.map((r) => r.itemKey)).toEqual(["B", "C"]);
    expect(recent[0].readingNo).toBe("2");
    expect(recent[1].readingNo).toBeUndefined();
  });

  it("merges last-write-wins by updatedAt on import", async () => {
    await saveReading("K", { readingNo: "1", title: "old" }, 100);
    const r1 = await importReadingStore({
      entries: { K: { readingNo: "9", title: "new", updatedAt: 200 } },
    });
    expect(r1.imported).toBe(1);
    expect((await loadReading("K"))?.readingNo).toBe("9");
    const r2 = await importReadingStore({
      entries: { K: { readingNo: "3", title: "older", updatedAt: 150 } },
    });
    expect(r2.unchanged).toBe(1);
    expect((await loadReading("K"))?.readingNo).toBe("9");
    const snap = await exportReadingStore();
    expect(snap.entries.K.updatedAt).toBe(200);
  });
});
