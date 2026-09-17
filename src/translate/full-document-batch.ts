import {
  protectLatexForTranslation,
  restoreLatexAfterTranslation,
} from "./full-document";
import { updateFullTranslationBlock } from "../settings/full-translation-store";
import { isTranslationPlaceholderReply, translationNeedsRetry } from "./translator";
import type { FullDocumentTranslationRunOptions } from "./full-document-runner";

export interface TranslationBatchEntry {
  id: string;
  text: string;
}
export type TranslateBatch = (
  entries: TranslationBatchEntry[],
) => Promise<TranslationBatchEntry[] & { rawResponse?: string }>;

export async function runFullDocumentBatchTranslation(
  options: FullDocumentTranslationRunOptions,
) {
  let state: typeof options.state = { ...options.state, lastError: undefined };
  const pending = options.document.blocks.filter((block) => {
    const previous = state.blocks[block.id];
    return (
      previous &&
      previous.status !== "skipped" &&
      (!options.targetBlockId || options.targetBlockId === block.id) &&
      (previous.status !== "done" ||
        options.targetBlockId === block.id ||
        isTranslationPlaceholderReply(previous.translation ?? ""))
    );
  });
  for (let start = 0; start < pending.length; ) {
    if (options.signal.aborted) break;
    const batch = [];
    let length = 0;
    while (start < pending.length && batch.length < 20) {
      const block = pending[start];
      const protectedText = protectLatexForTranslation(block.source);
      if (batch.length && length + protectedText.text.length > 10_000) break;
      batch.push({ block, protectedText, previous: state.blocks[block.id] });
      length += protectedText.text.length;
      start++;
    }
    for (const item of batch)
      state = updateFullTranslationBlock(state, item.block.id, {
        status: "translating",
      });
    await options.onState?.(state);
    let batchError: Error | undefined;
    let rawResponse: string | undefined;
    try {
      const result = await options.translateBatch!(
        batch.map((item) => ({
          id: item.block.id,
          text: item.protectedText.text,
        })),
      );
      if (options.signal.aborted) throw new Error("翻译已取消");
      rawResponse = result.rawResponse;
      const byId = new Map(result.map((entry) => [entry.id, entry.text]));
      if (byId.size !== batch.length || result.length !== batch.length || batch.some((item) => !byId.has(item.block.id)))
        throw new Error("WEB 批次返回的段落编号不完整或重复，请重试本批。");
      // Validate IDs first, then preserve each independently valid translation.
      for (const item of batch) {
        try {
          const text = byId.get(item.block.id)!;
          if (!text.trim() || translationNeedsRetry(item.protectedText.text, text))
            throw new Error(`WEB 未返回段落 ${item.block.id} 的有效中文译文，已暂停。`);
          const value = restoreLatexAfterTranslation(text, item.protectedText.placeholders);
          if (value == null)
            throw new Error(`WEB 改写了段落 ${item.block.id} 的公式占位符。`);
          state = updateFullTranslationBlock(state, item.block.id, { status: "done", translation: value });
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error));
          batchError ??= failure;
          state = updateFullTranslationBlock(state, item.block.id,
            item.previous.status === "done" ? item.previous : { status: "error", error: failure.message });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error && typeof error === "object" && "rawResponse" in error && typeof error.rawResponse === "string")
        rawResponse = error.rawResponse;
      if (!options.signal.aborted) state = { ...state, lastError: { message, rawResponse } };
      for (const item of batch) {
        state = updateFullTranslationBlock(
          state,
          item.block.id,
          item.previous.status === "done"
            ? item.previous
            : options.signal.aborted
              ? { status: "pending" }
              : {
                  status: "error",
                  error: error instanceof Error ? error.message : String(error),
                },
        );
      }
      await options.onState?.(state);
      if (options.signal.aborted) return state;
      throw error;
    }
    if (batchError) state = { ...state, lastError: { message: batchError.message, rawResponse } };
    await options.onState?.(state);
    if (batchError) throw batchError;
  }
  return state;
}
