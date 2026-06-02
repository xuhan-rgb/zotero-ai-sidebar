import { beforeEach, describe, expect, it } from "vitest";
import {
  exportOverviews,
  importOverviews,
  loadOverview,
  saveOverview,
} from "../../src/context/overview-store";
import type { OverviewData } from "../../src/context/overview-types";

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

const data = (title: string): OverviewData => ({
  title,
  source: "pdf",
  coverage: "headings",
  sections: [{ no: "1", level: 1, title: "Intro", charStart: 0, charEnd: 1 }],
});

describe("overview-store", () => {
  it("round-trips a saved overview", async () => {
    await saveOverview("ITEMKEY", data("T"), 100);
    const got = await loadOverview("ITEMKEY");
    expect(got?.data.title).toBe("T");
    expect(got?.updatedAt).toBe(100);
  });

  it("preserves narrative + per-section phase/emphasis on load", async () => {
    await saveOverview(
      "K2",
      {
        title: "T",
        source: "pdf",
        coverage: "headings",
        narrative: "核心讲述",
        sections: [
          {
            no: "5",
            level: 1,
            title: "Method",
            charStart: 0,
            charEnd: 1,
            phase: "method",
            emphasis: "innovation",
          },
        ],
        flowchart: {
          rankdir: "TB",
          nodes: [{ id: "a", label: "A", type: "innovation", sectionNo: "5" }],
          edges: [],
        },
      },
      100,
    );
    const got = await loadOverview("K2");
    expect(got?.data.narrative).toBe("核心讲述");
    expect(got?.data.sections[0].phase).toBe("method");
    expect(got?.data.sections[0].emphasis).toBe("innovation");
    expect(got?.data.flowchart?.nodes[0].type).toBe("innovation");
    expect(got?.data.flowchart?.nodes[0].sectionNo).toBe("5");
  });

  it("merges last-write-wins by updatedAt", async () => {
    await saveOverview("K", data("old"), 100);

    const r1 = await importOverviews({
      entries: { K: { data: data("new"), updatedAt: 200 } },
    });
    expect(r1.imported).toBe(1);
    expect((await loadOverview("K"))?.data.title).toBe("new");

    const r2 = await importOverviews({
      entries: { K: { data: data("older"), updatedAt: 150 } },
    });
    expect(r2.unchanged).toBe(1);
    expect((await loadOverview("K"))?.data.title).toBe("new");

    const snap = await exportOverviews();
    expect(snap.entries.K.updatedAt).toBe(200);
  });
});
