import { describe, expect, it, vi } from "vitest";

import {
  runFullDocumentTranslation,
  translateProtectedBlock,
} from "../../src/translate/full-document-runner";
import { createFullTranslationState } from "../../src/settings/full-translation-store";
import type { FullTranslationDocument } from "../../src/translate/full-document";

const document: FullTranslationDocument = {
  schemaVersion: 1,
  arxivId: "2504.16054",
  sourceHash: "0123456789abcdef",
  blocks: [
    {
      id: "section-1-p1",
      kind: "paragraph",
      source: "Already translated.",
      translatable: true,
    },
    {
      id: "equation-1",
      kind: "formula",
      source: "L = x",
      translatable: false,
    },
    {
      id: "section-1-p2",
      kind: "paragraph",
      source: "Translate $x$ now.",
      translatable: true,
    },
  ],
};

describe("runFullDocumentTranslation", () => {
  it("sends both one-word headings and paragraphs through the same translation path", async () => {
    const headingDocument: FullTranslationDocument = {
      ...document,
      blocks: [
        {
          id: "section-1",
          kind: "heading",
          source: "Introduction",
          translatable: true,
          number: 1,
        },
        {
          id: "section-1-p1",
          kind: "paragraph",
          source: "The original paragraph remains unchanged.",
          translatable: true,
        },
      ],
    };
    const state = createFullTranslationState(
      headingDocument,
      "preset-1",
      "model-1",
    );
    const translate = vi.fn(async (source: string) =>
      source === "Introduction" ? "引言" : "段落译文",
    );

    const result = await runFullDocumentTranslation({
      document: headingDocument,
      state,
      signal: new AbortController().signal,
      translate,
    });

    expect(result.blocks["section-1"]).toMatchObject({
      status: "done",
      translation: "引言",
    });
    expect(translate.mock.calls).toEqual([
      ["Introduction"],
      ["The original paragraph remains unchanged."],
    ]);
  });

  it("resumes pending blocks without redoing completed or skipped blocks", async () => {
    const initial = createFullTranslationState(document, "preset-1", "model-1");
    initial.blocks["section-1-p1"] = {
      status: "done",
      translation: "已经翻译。",
    };
    const translate = vi.fn(async (source: string) => `译:${source}`);
    const snapshots: string[] = [];

    const result = await runFullDocumentTranslation({
      document,
      state: initial,
      signal: new AbortController().signal,
      translate,
      onState: (state) => {
        snapshots.push(state.blocks["section-1-p2"].status);
      },
    });

    expect(translate).toHaveBeenCalledOnce();
    expect(translate).toHaveBeenCalledWith("Translate ZAILATEXTOKEN0X now.");
    expect(result.blocks["section-1-p1"].translation).toBe("已经翻译。");
    expect(result.blocks["equation-1"].status).toBe("skipped");
    expect(result.blocks["section-1-p2"]).toMatchObject({
      status: "done",
      translation: "译:Translate $x$ now.",
    });
    expect(snapshots).toEqual(["translating", "done"]);
  });

  it("retranslates only the explicitly targeted block", async () => {
    const initial = createFullTranslationState(document, "preset-1", "model-1");
    initial.blocks["section-1-p1"] = {
      status: "done",
      translation: "旧译文。",
    };
    const translate = vi.fn(async () => ({
      text: "新译文。",
      usage: { input: 24, output: 6, cacheRead: 8 },
    }));

    const result = await runFullDocumentTranslation({
      document,
      state: initial,
      signal: new AbortController().signal,
      targetBlockId: "section-1-p1",
      translate,
    });

    expect(translate).toHaveBeenCalledOnce();
    expect(translate).toHaveBeenCalledWith("Already translated.");
    expect(result.blocks["section-1-p1"]).toMatchObject({
      status: "done",
      translation: "新译文。",
    });
    expect(result.blocks["section-1-p2"].status).toBe("pending");
    expect(result.usageEvents).toMatchObject([
      {
        blockId: "section-1-p1",
        usage: { input: 24, output: 6, cacheRead: 8 },
      },
    ]);
  });

  it("keeps the previous translation when targeted retranslation fails", async () => {
    const initial = createFullTranslationState(document, "preset-1", "model-1");
    initial.blocks["section-1-p1"] = {
      status: "done",
      translation: "旧译文。",
    };

    const result = await runFullDocumentTranslation({
      document,
      state: initial,
      signal: new AbortController().signal,
      targetBlockId: "section-1-p1",
      translate: async () => ({
        text: "好的，请提供需要翻译的英文内容。",
        usage: { input: 35, output: 12, cacheRead: 20 },
      }),
    });

    expect(result.blocks["section-1-p1"]).toEqual({
      status: "done",
      translation: "旧译文。",
    });
    expect(result.usage).toEqual({ input: 35, output: 12, cacheRead: 20 });
    expect(result.usageEvents).toMatchObject([
      {
        blockId: "section-1-p1",
        usage: { input: 35, output: 12, cacheRead: 20 },
      },
    ]);
  });

  it("keeps the previous translation when targeted retranslation is cancelled", async () => {
    const initial = createFullTranslationState(document, "preset-1", "model-1");
    initial.blocks["section-1-p1"] = {
      status: "done",
      translation: "旧译文。",
    };
    const controller = new AbortController();

    const result = await runFullDocumentTranslation({
      document,
      state: initial,
      signal: controller.signal,
      targetBlockId: "section-1-p1",
      translate: async () => {
        controller.abort();
        return {
          text: "新译文。",
          usage: { input: 24, output: 6, cacheRead: 8 },
        };
      },
    });

    expect(result.blocks["section-1-p1"]).toEqual({
      status: "done",
      translation: "旧译文。",
    });
    expect(result.usage).toEqual({ input: 24, output: 6, cacheRead: 8 });
    expect(result.usageEvents).toMatchObject([
      {
        blockId: "section-1-p1",
        usage: { input: 24, output: 6, cacheRead: 8 },
      },
    ]);
  });

  it("marks a failed block and continues with later blocks", async () => {
    const state = createFullTranslationState(document, "preset-1", "model-1");
    const translate = vi
      .fn<(source: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockResolvedValueOnce("第二段 ZAILATEXTOKEN0X");

    const result = await runFullDocumentTranslation({
      document,
      state,
      signal: new AbortController().signal,
      translate,
    });

    expect(result.blocks["section-1-p1"]).toMatchObject({
      status: "error",
      error: "rate limited",
    });
    expect(result.blocks["section-1-p2"]).toMatchObject({
      status: "done",
      translation: "第二段 $x$",
    });
  });

  it("leaves an interrupted block resumable after cancellation", async () => {
    const state = createFullTranslationState(document, "preset-1", "model-1");
    const controller = new AbortController();
    const interrupted = await runFullDocumentTranslation({
      document,
      state,
      signal: controller.signal,
      translate: async (source) => {
        controller.abort();
        return { text: source, usage: { input: 12, output: 4 } };
      },
    });

    expect(interrupted.blocks["section-1-p1"].status).toBe("translating");
    expect(interrupted.blocks["section-1-p2"].status).toBe("pending");
    expect(interrupted.usage).toEqual({ input: 12, output: 4 });
    expect(interrupted.usageEvents).toMatchObject([
      {
        blockId: "section-1-p1",
        usage: { input: 12, output: 4 },
        recordedAt: expect.any(String),
      },
    ]);

    const resumed = await runFullDocumentTranslation({
      document,
      state: interrupted,
      signal: new AbortController().signal,
      translate: async (source) => source,
    });
    expect(resumed.blocks["section-1-p1"].status).toBe("done");
    expect(resumed.blocks["section-1-p2"].status).toBe("done");
  });

  it("accumulates real token usage returned by every model call", async () => {
    const state = createFullTranslationState(document, "preset-1", "model-1");
    state.usage = { input: 100, output: 20, cacheRead: 10 };

    const result = await runFullDocumentTranslation({
      document,
      state,
      signal: new AbortController().signal,
      translate: async (source) => ({
        text: source,
        usage: { input: 30, output: 8, cacheRead: 5 },
      }),
    });

    expect(result.usage).toEqual({ input: 160, output: 36, cacheRead: 20 });
    expect(result.usageEvents).toMatchObject([
      {
        blockId: "section-1-p1",
        usage: { input: 30, output: 8, cacheRead: 5 },
        recordedAt: expect.any(String),
      },
      {
        blockId: "section-1-p2",
        usage: { input: 30, output: 8, cacheRead: 5 },
        recordedAt: expect.any(String),
      },
    ]);
  });

  it("counts usage when LaTeX validation rejects a paid model response", async () => {
    const state = createFullTranslationState(document, "preset-1", "model-1");
    state.blocks["section-1-p1"] = {
      status: "done",
      translation: "已经翻译。",
    };

    const result = await runFullDocumentTranslation({
      document,
      state,
      signal: new AbortController().signal,
      translate: async () => ({
        text: "模型删除了公式占位符。",
        usage: { input: 42, output: 9 },
      }),
    });

    expect(result.blocks["section-1-p2"].status).toBe("error");
    expect(result.usage).toEqual({ input: 42, output: 9 });
    expect(result.usageEvents).toMatchObject([
      {
        blockId: "section-1-p2",
        usage: { input: 42, output: 9 },
        recordedAt: expect.any(String),
      },
    ]);
  });

  it("repairs a cached request-for-content reply when translation continues", async () => {
    const state = createFullTranslationState(document, "preset-1", "model-1");
    state.blocks["section-1-p1"] = {
      status: "done",
      translation: "好的，请提供需要翻译的英文内容。",
    };
    state.blocks["section-1-p2"] = {
      status: "done",
      translation: "已翻译 $x$。",
    };
    const translate = vi.fn(async () => "已经翻译。");

    const result = await runFullDocumentTranslation({
      document,
      state,
      signal: new AbortController().signal,
      translate,
    });

    expect(translate).toHaveBeenCalledOnce();
    expect(result.blocks["section-1-p1"]).toMatchObject({
      status: "done",
      translation: "已经翻译。",
    });
  });

  it("rejects a repeated request-for-content reply while retaining its usage", async () => {
    const state = createFullTranslationState(document, "preset-1", "model-1");
    state.blocks["section-1-p2"] = {
      status: "done",
      translation: "已翻译 $x$。",
    };

    const result = await runFullDocumentTranslation({
      document,
      state,
      signal: new AbortController().signal,
      translate: async () => ({
        text: "好的，请提供需要翻译的英文内容。",
        usage: { input: 35, output: 12 },
      }),
    });

    expect(result.blocks["section-1-p1"]).toMatchObject({
      status: "error",
      error: "模型未返回有效译文。",
    });
    expect(result.usage).toEqual({ input: 35, output: 12 });
  });

  it("appends another event when an errored block is retried", async () => {
    const initial = createFullTranslationState(document, "preset-1", "model-1");
    initial.blocks["section-1-p2"] = {
      status: "done",
      translation: "已翻译 $x$。",
    };

    const failed = await runFullDocumentTranslation({
      document,
      state: initial,
      signal: new AbortController().signal,
      translate: async () => ({
        text: "好的，请提供需要翻译的英文内容。",
        usage: { input: 35, output: 12 },
      }),
    });
    const retried = await runFullDocumentTranslation({
      document,
      state: failed,
      signal: new AbortController().signal,
      translate: async () => ({
        text: "已经翻译。",
        usage: { input: 28, output: 7 },
      }),
    });

    expect(retried.blocks["section-1-p1"].status).toBe("done");
    expect(retried.usage).toEqual({ input: 63, output: 19 });
    expect(retried.usageEvents).toMatchObject([
      {
        blockId: "section-1-p1",
        usage: { input: 35, output: 12 },
      },
      {
        blockId: "section-1-p1",
        usage: { input: 28, output: 7 },
      },
    ]);
  });

  it("records chunked model usage as one block attempt", async () => {
    const longDocument: FullTranslationDocument = {
      ...document,
      blocks: [
        {
          id: "long-paragraph",
          kind: "paragraph",
          source: `${"word ".repeat(260)}end.`,
          translatable: true,
        },
      ],
    };
    const state = createFullTranslationState(
      longDocument,
      "preset-1",
      "model-1",
    );

    const result = await runFullDocumentTranslation({
      document: longDocument,
      state,
      signal: new AbortController().signal,
      translate: async (source) => ({
        text: source,
        usage: { input: 20, output: 5 },
      }),
    });

    expect(result.usage).toEqual({ input: 40, output: 10 });
    expect(result.usageEvents).toMatchObject([
      {
        blockId: "long-paragraph",
        usage: { input: 40, output: 10 },
      },
    ]);
  });
});

describe("translateProtectedBlock", () => {
  it("protects inline LaTeX across model calls", async () => {
    const translate = vi.fn(async (text: string) =>
      text.replace("Loss", "损失").replace("is minimized", "被最小化"),
    );

    await expect(
      translateProtectedBlock(
        "Loss $L = L_{task} + \\lambda L_{aux}$ is minimized.",
        translate,
      ),
    ).resolves.toBe("损失 $L = L_{task} + \\lambda L_{aux}$ 被最小化.");
    expect(translate).toHaveBeenCalledWith(
      "Loss ZAILATEXTOKEN0X is minimized.",
    );
  });

  it("splits long text without splitting protected placeholders", async () => {
    const translate = vi.fn(async (text: string) => text);
    const source =
      "A deliberately long sentence before $L_{task} + \\lambda L_{aux}$ " +
      "and another deliberately long sentence after the formula.";

    const result = await translateProtectedBlock(source, translate, 48);

    expect(translate.mock.calls.length).toBeGreaterThan(1);
    expect(
      translate.mock.calls.some(([chunk]) => chunk.includes("ZAILATEXTOKEN0X")),
    ).toBe(true);
    expect(
      translate.mock.calls.every(
        ([chunk]) =>
          !chunk.includes("ZAILATEXTOKEN") || chunk.includes("ZAILATEXTOKEN0X"),
      ),
    ).toBe(true);
    expect(result).toContain("$L_{task} + \\lambda L_{aux}$");
  });
});
