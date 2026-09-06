import {
  addFullTranslationUsage,
  updateFullTranslationBlock,
  type FullTranslationState,
  type FullTranslationUsage,
} from "../settings/full-translation-store";
import {
  protectLatexForTranslation,
  restoreLatexAfterTranslation,
  type FullTranslationDocument,
} from "./full-document";
import { isTranslationPlaceholderReply } from "./translator";
import { mergeUsage } from "./full-document-usage";

export interface FullDocumentTranslationRunOptions {
  document: FullTranslationDocument;
  state: FullTranslationState;
  signal: AbortSignal;
  targetBlockId?: string;
  translate(source: string): Promise<string | FullDocumentTranslationChunk>;
  onState?(state: FullTranslationState): void | Promise<void>;
}

export interface FullDocumentTranslationChunk {
  text: string;
  usage?: FullTranslationUsage;
}

export async function runFullDocumentTranslation(
  options: FullDocumentTranslationRunOptions,
): Promise<FullTranslationState> {
  let state = options.state;

  for (const block of options.document.blocks) {
    if (options.signal.aborted) break;
    const explicitlyTargeted = options.targetBlockId === block.id;
    if (options.targetBlockId && !explicitlyTargeted) continue;
    const blockState = state.blocks[block.id];
    const needsRepair =
      blockState?.status === "done" &&
      isTranslationPlaceholderReply(blockState.translation ?? "");
    if (
      !blockState ||
      (blockState.status === "done" && !needsRepair && !explicitlyTargeted) ||
      blockState.status === "skipped"
    ) {
      continue;
    }
    const previousBlockState =
      explicitlyTargeted && blockState.status === "done"
        ? blockState
        : undefined;

    state = updateFullTranslationBlock(state, block.id, {
      status: "translating",
    });
    await options.onState?.(state);

    try {
      const translated = await translateProtectedBlockWithUsage(
        block.source,
        options.translate,
      );
      state = addFullTranslationUsage(state, translated.usage, block.id);
      if (options.signal.aborted) {
        if (previousBlockState) {
          state = updateFullTranslationBlock(
            state,
            block.id,
            previousBlockState,
          );
        }
        break;
      }
      state = updateFullTranslationBlock(state, block.id, {
        status: "done",
        translation: translated.text,
      });
    } catch (error) {
      if (options.signal.aborted) {
        if (previousBlockState) {
          state = updateFullTranslationBlock(
            state,
            block.id,
            previousBlockState,
          );
        }
        break;
      }
      state = addFullTranslationUsage(
        state,
        error instanceof TranslationValidationError ? error.usage : undefined,
        block.id,
      );
      state = updateFullTranslationBlock(
        state,
        block.id,
        previousBlockState ?? {
          status: "error",
          error: errorMessage(error),
        },
      );
    }
    await options.onState?.(state);
  }

  return state;
}

export async function translateProtectedBlock(
  source: string,
  translateChunk: (source: string) => Promise<string>,
  maxChunkChars = 1200,
): Promise<string> {
  const result = await translateProtectedBlockWithUsage(
    source,
    async (chunk) => ({ text: await translateChunk(chunk) }),
    maxChunkChars,
  );
  return result.text;
}

async function translateProtectedBlockWithUsage(
  source: string,
  translateChunk: (
    source: string,
  ) => Promise<string | FullDocumentTranslationChunk>,
  maxChunkChars = 1200,
): Promise<FullDocumentTranslationChunk> {
  const protectedText = protectLatexForTranslation(source);
  const chunks = splitProtectedText(protectedText.text, maxChunkChars);
  const translatedChunks: string[] = [];
  let usage: FullTranslationUsage | undefined;
  for (const chunk of chunks) {
    const result = await translateChunk(chunk);
    const translated = typeof result === "string" ? { text: result } : result;
    translatedChunks.push(translated.text);
    usage = mergeUsage(usage, translated.usage);
  }
  const translated = translatedChunks.join(" ");
  if (isTranslationPlaceholderReply(translated)) {
    throw new TranslationValidationError("模型未返回有效译文。", usage);
  }
  const restored = restoreLatexAfterTranslation(
    translated,
    protectedText.placeholders,
  );
  if (restored == null) {
    throw new TranslationValidationError(
      "Translation changed a protected LaTeX expression.",
      usage,
    );
  }
  return { text: restored, usage };
}

class TranslationValidationError extends Error {
  constructor(
    message: string,
    readonly usage?: FullTranslationUsage,
  ) {
    super(message);
    this.name = "TranslationValidationError";
  }
}

function splitProtectedText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const tokens = Array.from(text.matchAll(/ZAILATEXTOKEN\d+X/g)).map(
    (match) => ({ start: match.index, end: match.index + match[0].length }),
  );
  const chunks: string[] = [];
  let start = 0;

  while (text.length - start > maxChars) {
    const limit = start + maxChars;
    let end = preferredSplit(text, start, limit);
    const containingToken = tokens.find(
      (token) => token.start < end && token.end > end,
    );
    if (containingToken) {
      end =
        containingToken.start > start
          ? containingToken.start
          : containingToken.end;
    }
    if (end <= start) end = Math.min(text.length, limit);
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    start = end;
    while (/\s/.test(text[start] ?? "")) start += 1;
  }

  const tail = text.slice(start).trim();
  if (tail) chunks.push(tail);
  return chunks;
}

function preferredSplit(text: string, start: number, limit: number): number {
  for (
    let index = limit;
    index > start + Math.floor((limit - start) / 2);
    index--
  ) {
    if (/\s/.test(text[index] ?? "")) return index;
  }
  const nextSpace = text.slice(limit).search(/\s/);
  return nextSpace >= 0 ? limit + nextSpace : Math.min(text.length, limit);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
