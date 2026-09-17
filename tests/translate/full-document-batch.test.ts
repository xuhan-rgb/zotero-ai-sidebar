import { it, expect, vi } from "vitest";
import { runFullDocumentTranslation } from "../../src/translate/full-document-runner";
import { createFullTranslationState } from "../../src/settings/full-translation-store";
import type { TranslationBatchEntry } from "../../src/translate/full-document-batch";
function fixture(n = 25) {
  const document = {
    schemaVersion: 1 as const,
    arxivId: "2110.06864",
    sourceHash: "x",
    blocks: Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      kind: "paragraph" as const,
      source: `Track $x_${i}$ with [6].`,
      translatable: true,
    })),
  };
  return {
    document,
    state: createFullTranslationState(document, "web:deepseek", "deepseek"),
    signal: new AbortController().signal,
    translate: vi.fn(),
  };
}
it("sends 25 paragraphs in two batches, maps reordered replies by id and restores each formula", async () => {
  const options = fixture();
  const batches = vi.fn(async (entries: TranslationBatchEntry[]) =>
    entries
      .map((e) => ({ id: e.id, text: "跟踪 ZAILATEXTOKEN0X [6]。" }))
      .reverse(),
  );
  const state = await runFullDocumentTranslation({
    ...options,
    translateBatch: batches,
  });
  expect(options.translate).not.toHaveBeenCalled();
  expect(batches.mock.calls.map((call) => call[0].length)).toEqual([20, 5]);
  expect(state.blocks.p0.translation).toBe("跟踪 $x_0$ [6]。");
  expect(state.blocks.p24.translation).toBe("跟踪 $x_24$ [6]。");
});
it("rejects missing/duplicate ids without saving partial or shifted translations", async () => {
  const options = fixture(2);
  let latest = options.state;
  await expect(
    runFullDocumentTranslation({
      ...options,
      translateBatch: async () => [
        { id: "p0", text: "中文" },
        { id: "p0", text: "中文" },
      ],
      onState: (s) => {
        latest = s;
      },
    }),
  ).rejects.toThrow("编号");
  expect(latest.blocks.p0.status).toBe("error");
  expect(latest.blocks.p1.status).toBe("error");
});
it("resumes only unfinished paragraphs and preserves cached translations", async () => {
  const options = fixture(2);
  options.state.blocks.p0 = { status: "done", translation: "保留" };
  const batches = vi.fn(async (entries: TranslationBatchEntry[]) =>
    entries.map((e) => ({ id: e.id, text: "译文 ZAILATEXTOKEN0X" })),
  );
  const state = await runFullDocumentTranslation({
    ...options,
    translateBatch: batches,
  });
  expect(batches.mock.calls[0][0].map((e) => e.id)).toEqual(["p1"]);
  expect(state.blocks.p0.translation).toBe("保留");
});
it("saves valid paragraphs and resumes only a failed English-only paragraph", async () => {
  const options = fixture(2);
  options.document.blocks.forEach((b) => { b.source = "This is a source paragraph with $x$."; });
  let latest = options.state;
  await expect(runFullDocumentTranslation({
    ...options,
    translateBatch: async () => [
      { id: "p0", text: "这是译文 ZAILATEXTOKEN0X。" },
      { id: "p1", text: "This is a source paragraph with ZAILATEXTOKEN0X." },
    ],
    onState: (s) => { latest = s; },
  })).rejects.toThrow("p1");
  expect(latest.blocks.p0).toMatchObject({ status: "done", translation: "这是译文 $x$。" });
  expect(latest.blocks.p1.status).toBe("error");
  const retry = vi.fn(async (entries: TranslationBatchEntry[]) => entries.map((e) => ({ id: e.id, text: "重试译文 ZAILATEXTOKEN0X" })));
  await runFullDocumentTranslation({ ...options, state: latest, translateBatch: retry });
  expect(retry.mock.calls[0][0].map((e) => e.id)).toEqual(["p1"]);
});
it("cancellation restores pending state and ignores the returned batch", async () => {
  const options = fixture(2);
  const controller = new AbortController();
  const state = await runFullDocumentTranslation({
    ...options,
    signal: controller.signal,
    translateBatch: async () => {
      controller.abort();
      return [];
    },
  });
  expect(state.blocks.p0.status).toBe("pending");
  expect(state.blocks.p1.status).toBe("pending");
});
