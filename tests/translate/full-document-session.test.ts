import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadFullTranslationSession } from "../../src/translate/full-document-session";
import { ARXIV_SOURCE_CLEANER_VERSION } from "../../src/context/arxiv-source";

const sourceMocks = vi.hoisted(() => ({
  ensureArxivSource: vi.fn(),
}));

vi.mock("../../src/context/arxiv-source", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/context/arxiv-source")>()),
  ensureArxivSource: sourceMocks.ensureArxivSource,
}));

beforeEach(() => {
  sourceMocks.ensureArxivSource.mockReset();
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: { DataDirectory: { dir: "/data" }, Profile: { dir: "/profile" } },
  });
});

describe("loadFullTranslationSession", () => {
  it("rejects cached metadata that does not contain usable LaTeX source", async () => {
    Object.defineProperty(globalThis, "IOUtils", {
      configurable: true,
      value: {
        readUTF8: async () => JSON.stringify({ status: "no-source" }),
      },
    });

    await expect(loadFullTranslationSession("2504.16054")).resolves.toBeNull();
    expect(sourceMocks.ensureArxivSource).not.toHaveBeenCalled();
  });

  it("builds a resumable session only from status-ok LaTeX", async () => {
    Object.defineProperty(globalThis, "IOUtils", {
      configurable: true,
      value: {
        readUTF8: async (path: string) => {
          if (path.endsWith("meta.json")) {
            return JSON.stringify({
              arxivId: "2504.16054",
              fetchedAt: "2026-08-09T00:00:00.000Z",
              status: "ok",
              mainTexRelPath: "main.tex",
              cleanerVersion: ARXIV_SOURCE_CLEANER_VERSION,
            });
          }
          if (path.endsWith("main.tex")) {
            return String.raw`\title{Test}\begin{document}\section{Intro}Text.\end{document}`;
          }
          throw new Error("missing");
        },
      },
    });

    const session = await loadFullTranslationSession("2504.16054");

    expect(session).toMatchObject({
      document: { arxivId: "2504.16054" },
      state: { presetId: "", model: "" },
    });
    expect(session).not.toHaveProperty("preflight");
    expect(sourceMocks.ensureArxivSource).not.toHaveBeenCalled();
  });

  it("refreshes stale status-ok metadata before reading the source", async () => {
    let metaReads = 0;
    let sourceReads = 0;
    sourceMocks.ensureArxivSource.mockResolvedValue(true);
    Object.defineProperty(globalThis, "IOUtils", {
      configurable: true,
      value: {
        readUTF8: async (path: string) => {
          if (path.endsWith("meta.json")) {
            metaReads += 1;
            return JSON.stringify({
              arxivId: "2504.16054",
              fetchedAt: "2026-08-09T00:00:00.000Z",
              status: "ok",
              mainTexRelPath: "main.tex",
              cleanerVersion:
                metaReads === 1
                  ? ARXIV_SOURCE_CLEANER_VERSION - 1
                  : ARXIV_SOURCE_CLEANER_VERSION,
            });
          }
          if (path.endsWith("main.tex")) {
            sourceReads += 1;
            return String.raw`\title{Test}\begin{document}\section{Intro}Text.\end{document}`;
          }
          throw new Error("missing");
        },
      },
    });

    await expect(
      loadFullTranslationSession("2504.16054"),
    ).resolves.toMatchObject({
      document: { arxivId: "2504.16054" },
    });
    expect(sourceMocks.ensureArxivSource).toHaveBeenCalledOnce();
    expect(sourceMocks.ensureArxivSource).toHaveBeenCalledWith({
      arxivId: "2504.16054",
    });
    expect(metaReads).toBeGreaterThanOrEqual(2);
    expect(sourceReads).toBe(1);
  });
});
