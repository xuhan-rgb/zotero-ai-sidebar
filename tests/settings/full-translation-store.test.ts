import { beforeEach, describe, expect, it } from "vitest";

import {
  addFullTranslationUsage,
  createFullTranslationState,
  fullTranslationPath,
  loadFullTranslationState,
  reconcileFullTranslationState,
  saveFullTranslationState,
  updateFullTranslationBlock,
} from "../../src/settings/full-translation-store";
import type { FullTranslationDocument } from "../../src/translate/full-document";

let files: Map<string, string>;

const document: FullTranslationDocument = {
  schemaVersion: 1,
  arxivId: "2504.16054",
  sourceHash: "0123456789abcdef",
  blocks: [
    {
      id: "section-1",
      kind: "heading",
      source: "Method",
      translatable: true,
      level: 1,
    },
    {
      id: "equation-1",
      kind: "formula",
      source: "L = x",
      translatable: false,
    },
  ],
};

beforeEach(() => {
  files = new Map();
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: { DataDirectory: { dir: "/data" }, Profile: { dir: "/prof" } },
  });
  Object.defineProperty(globalThis, "IOUtils", {
    configurable: true,
    value: {
      makeDirectory: async () => undefined,
      writeUTF8: async (path: string, data: string) =>
        void files.set(path, data),
      readUTF8: async (path: string) => {
        const value = files.get(path);
        if (value == null) throw new Error("missing");
        return value;
      },
    },
  });
});

describe("full translation store", () => {
  it("stores translations beside the shared arXiv source cache", () => {
    expect(fullTranslationPath("2504.16054")).toBe(
      "/data/zotero-ai-sidebar/arxiv/2504.16054/translations/zh-CN.json",
    );
  });

  it("persists completed blocks and resumes pending blocks", async () => {
    let state = createFullTranslationState(document, "preset-1", "gpt-test");
    state.usage = {
      input: 1200,
      output: 300,
      cacheRead: 200,
      cacheReadIncludedInInput: true,
    };
    state = updateFullTranslationBlock(state, "section-1", {
      status: "done",
      translation: "方法",
    });
    await saveFullTranslationState(state);

    await expect(
      loadFullTranslationState("2504.16054", document.sourceHash),
    ).resolves.toMatchObject({
      model: "gpt-test",
      usage: {
        input: 1200,
        output: 300,
        cacheRead: 200,
        cacheReadIncludedInInput: true,
      },
      blocks: {
        "section-1": { status: "done", translation: "方法" },
        "equation-1": { status: "skipped" },
      },
    });
  });

  it("persists usage history for the block that incurred each model call", async () => {
    let state = createFullTranslationState(document, "preset-1", "gpt-test");
    state = addFullTranslationUsage(
      state,
      { input: 120, output: 30, cacheRead: 20 },
      "section-1",
    );
    await saveFullTranslationState(state);

    await expect(
      loadFullTranslationState("2504.16054", document.sourceHash),
    ).resolves.toMatchObject({
      usage: { input: 120, output: 30, cacheRead: 20 },
      usageEvents: [
        {
          blockId: "section-1",
          usage: { input: 120, output: 30, cacheRead: 20 },
          recordedAt: expect.any(String),
        },
      ],
    });
  });

  it("loads legacy state without history and filters malformed events", async () => {
    const legacy = createFullTranslationState(document, "preset-1", "gpt-test");
    files.set(fullTranslationPath(document.arxivId), JSON.stringify(legacy));

    await expect(
      loadFullTranslationState(document.arxivId, document.sourceHash),
    ).resolves.not.toHaveProperty("usageEvents");

    files.set(
      fullTranslationPath(document.arxivId),
      JSON.stringify({
        ...legacy,
        usageEvents: [
          {
            blockId: "section-1",
            usage: { input: 10, output: 3 },
            recordedAt: "2026-08-09T03:30:00.000Z",
          },
          {
            blockId: "old-paragraph",
            usage: { input: 8, output: 2 },
            recordedAt: "2026-08-09T03:30:30.000Z",
          },
          {
            blockId: "",
            usage: { input: 20, output: 5 },
            recordedAt: "2026-08-09T03:31:00.000Z",
          },
          {
            blockId: "section-1",
            usage: { input: -1, output: 5 },
            recordedAt: "2026-08-09T03:32:00.000Z",
          },
          null,
        ],
      }),
    );

    await expect(
      loadFullTranslationState(document.arxivId, document.sourceHash),
    ).resolves.toMatchObject({
      usageEvents: [
        {
          blockId: "section-1",
          usage: { input: 10, output: 3 },
          recordedAt: "2026-08-09T03:30:00.000Z",
        },
        {
          blockId: "old-paragraph",
          usage: { input: 8, output: 2 },
          recordedAt: "2026-08-09T03:30:30.000Z",
        },
      ],
    });
  });

  it("invalidates translations when the LaTeX source changes", async () => {
    await saveFullTranslationState(
      createFullTranslationState(document, "preset-1", "gpt-test"),
    );

    await expect(
      loadFullTranslationState("2504.16054", "different-source"),
    ).resolves.toBeNull();
  });

  it("reconciles changed block IDs without discarding usage history", () => {
    let state = createFullTranslationState(document, "preset-1", "gpt-test");
    state = updateFullTranslationBlock(state, "section-1", {
      status: "done",
      translation: "方法",
    });
    state = addFullTranslationUsage(
      state,
      { input: 120, output: 30 },
      "section-1",
    );
    const changedDocument: FullTranslationDocument = {
      ...document,
      blocks: [
        document.blocks[0],
        {
          id: "section-1-p1-s2",
          kind: "paragraph",
          source: "A newly split sentence.",
          translatable: true,
        },
        {
          id: "equation-2",
          kind: "formula",
          source: "y = 2x",
          translatable: false,
        },
      ],
    };

    const reconciled = reconcileFullTranslationState(state, changedDocument);

    expect(reconciled.blocks).toEqual({
      "section-1": { status: "done", translation: "方法" },
      "section-1-p1-s2": { status: "pending" },
      "equation-2": { status: "skipped" },
    });
    expect(reconciled.usage).toBe(state.usage);
    expect(reconciled.usageEvents).toBe(state.usageEvents);
  });

  it("does not reuse shifted figure-caption translations after figure recovery", () => {
    const oldDocument: FullTranslationDocument = {
      ...document,
      blocks: [
        document.blocks[0],
        {
          id: "figure-1-caption",
          kind: "figure-caption",
          source: "Framework.",
          translatable: true,
        },
        {
          id: "figure-2-caption",
          kind: "figure-caption",
          source: "Results.",
          translatable: true,
        },
      ],
    };
    let state = createFullTranslationState(oldDocument, "preset-1", "gpt-test");
    state = updateFullTranslationBlock(state, "section-1", {
      status: "done",
      translation: "方法",
    });
    state = updateFullTranslationBlock(state, "figure-1-caption", {
      status: "done",
      translation: "旧图一",
    });
    state = updateFullTranslationBlock(state, "figure-2-caption", {
      status: "done",
      translation: "旧图二",
    });
    const recoveredDocument: FullTranslationDocument = {
      ...oldDocument,
      blocks: [
        oldDocument.blocks[0],
        {
          id: "figure-1-caption",
          kind: "figure-caption",
          source: "Recovered teaser.",
          translatable: true,
        },
        oldDocument.blocks[1],
        oldDocument.blocks[2],
        {
          id: "figure-3-caption",
          kind: "figure-caption",
          source: "Additional recovered figure.",
          translatable: true,
        },
      ],
    };

    const reconciled = reconcileFullTranslationState(state, recoveredDocument);

    expect(reconciled.blocks["section-1"]).toEqual({
      status: "done",
      translation: "方法",
    });
    expect(reconciled.blocks["figure-1-caption"]).toEqual({
      status: "pending",
    });
    expect(reconciled.blocks["figure-2-caption"]).toEqual({
      status: "pending",
    });
    expect(reconciled.blocks["figure-3-caption"]).toEqual({
      status: "pending",
    });
  });

  it("creates a clean state for a confirmed complete retranslation", () => {
    const previous = createFullTranslationState(
      document,
      "preset-1",
      "gpt-test",
    );
    previous.usage = { input: 1200, output: 300 };
    previous.blocks["section-1"] = {
      status: "done",
      translation: "方法",
    };

    const restarted = createFullTranslationState(
      document,
      previous.presetId,
      previous.model,
    );

    expect(restarted.usage).toBeUndefined();
    expect(restarted.blocks["section-1"]).toEqual({ status: "pending" });
    expect(restarted.blocks["equation-1"]).toEqual({ status: "skipped" });
  });
});
