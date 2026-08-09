import { arxivFolderPath } from "../context/arxiv-store";
import type { FullTranslationDocument } from "../translate/full-document";
import { appendLocalPath } from "../utils/local-path";

export type FullTranslationBlockStatus =
  | "pending"
  | "translating"
  | "done"
  | "error"
  | "skipped";

export interface FullTranslationBlockState {
  status: FullTranslationBlockStatus;
  translation?: string;
  error?: string;
}

export interface FullTranslationUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheReadIncludedInInput?: boolean;
}

export interface FullTranslationUsageEvent {
  blockId: string;
  usage: FullTranslationUsage;
  recordedAt: string;
}

export interface FullTranslationState {
  schemaVersion: 1;
  arxivId: string;
  sourceHash: string;
  targetLanguage: "zh-CN";
  presetId: string;
  model: string;
  usage?: FullTranslationUsage;
  usageEvents?: FullTranslationUsageEvent[];
  blocks: Record<string, FullTranslationBlockState>;
  createdAt: string;
  updatedAt: string;
}

interface IOUtilsLike {
  makeDirectory(
    path: string,
    options?: { ignoreExisting?: boolean },
  ): Promise<void>;
  writeUTF8(path: string, data: string): Promise<unknown>;
  readUTF8(path: string): Promise<string>;
}

let writeQueue: Promise<void> = Promise.resolve();

export function fullTranslationPath(arxivId: string): string {
  return appendLocalPath(
    arxivFolderPath(arxivId),
    "translations",
    "zh-CN.json",
  );
}

export function createFullTranslationState(
  document: FullTranslationDocument,
  presetId: string,
  model: string,
): FullTranslationState {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    arxivId: document.arxivId,
    sourceHash: document.sourceHash,
    targetLanguage: "zh-CN",
    presetId,
    model,
    blocks: Object.fromEntries(
      document.blocks.map((block) => [
        block.id,
        { status: block.translatable ? "pending" : "skipped" },
      ]),
    ),
    createdAt: now,
    updatedAt: now,
  };
}

export function reconcileFullTranslationState(
  state: FullTranslationState,
  document: FullTranslationDocument,
): FullTranslationState {
  const previousFigureIds = Object.keys(state.blocks).filter((id) =>
    /^figure-.+-caption$/.test(id),
  );
  const nextFigureIds = document.blocks
    .filter((block) => block.kind === "figure-caption")
    .map((block) => block.id);
  const figureStructureChanged = !sameStringSet(
    previousFigureIds,
    nextFigureIds,
  );
  return {
    ...state,
    blocks: Object.fromEntries(
      document.blocks.map((block) => [
        block.id,
        figureStructureChanged && block.kind === "figure-caption"
          ? { status: block.translatable ? "pending" : "skipped" }
          : (state.blocks[block.id] ?? {
              status: block.translatable ? "pending" : "skipped",
            }),
      ]),
    ),
  };
}

function sameStringSet(first: string[], second: string[]): boolean {
  if (first.length !== second.length) return false;
  const values = new Set(first);
  return second.every((value) => values.has(value));
}

export function updateFullTranslationBlock(
  state: FullTranslationState,
  blockID: string,
  update: FullTranslationBlockState,
): FullTranslationState {
  if (!(blockID in state.blocks)) return state;
  return {
    ...state,
    blocks: {
      ...state.blocks,
      [blockID]: normalizeBlockState(update),
    },
    updatedAt: new Date().toISOString(),
  };
}

export function addFullTranslationUsage(
  state: FullTranslationState,
  usage?: FullTranslationUsage,
  blockId?: string,
): FullTranslationState {
  if (!usage) return state;
  const previous = state.usage;
  const now = new Date().toISOString();
  const cacheMode = !previous
    ? usage.cacheReadIncludedInInput
    : previous.cacheReadIncludedInInput === usage.cacheReadIncludedInInput
      ? previous.cacheReadIncludedInInput
      : undefined;
  return {
    ...state,
    usage: {
      input: (previous?.input ?? 0) + usage.input,
      output: (previous?.output ?? 0) + usage.output,
      ...((previous?.cacheRead != null || usage.cacheRead != null) && {
        cacheRead: (previous?.cacheRead ?? 0) + (usage.cacheRead ?? 0),
      }),
      ...(cacheMode != null && { cacheReadIncludedInInput: cacheMode }),
    },
    ...(blockId
      ? {
          usageEvents: [
            ...(state.usageEvents ?? []),
            { blockId, usage: { ...usage }, recordedAt: now },
          ],
        }
      : {}),
    updatedAt: now,
  };
}

export async function loadFullTranslationState(
  arxivId: string,
  sourceHash: string,
): Promise<FullTranslationState | null> {
  await writeQueue.catch(() => undefined);
  try {
    const parsed: unknown = JSON.parse(
      await io().readUTF8(fullTranslationPath(arxivId)),
    );
    const state = normalizeState(parsed);
    return state?.arxivId === arxivId && state.sourceHash === sourceHash
      ? state
      : null;
  } catch {
    return null;
  }
}

export function saveFullTranslationState(
  state: FullTranslationState,
): Promise<void> {
  const snapshot = normalizeState(state);
  if (!snapshot) return Promise.reject(new Error("Invalid translation state."));
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      const folder = appendLocalPath(
        arxivFolderPath(snapshot.arxivId),
        "translations",
      );
      await io().makeDirectory(folder, { ignoreExisting: true });
      await io().writeUTF8(
        fullTranslationPath(snapshot.arxivId),
        JSON.stringify(snapshot, null, 2),
      );
    });
  return writeQueue;
}

function normalizeState(value: unknown): FullTranslationState | null {
  if (!isRecord(value)) return null;
  if (
    value.schemaVersion !== 1 ||
    typeof value.arxivId !== "string" ||
    typeof value.sourceHash !== "string" ||
    value.targetLanguage !== "zh-CN" ||
    typeof value.presetId !== "string" ||
    typeof value.model !== "string" ||
    !isRecord(value.blocks)
  ) {
    return null;
  }
  const blocks: Record<string, FullTranslationBlockState> = {};
  for (const [id, block] of Object.entries(value.blocks)) {
    const normalized = normalizeBlockState(block);
    blocks[id] = normalized;
  }
  const usage = normalizeUsage(value.usage);
  const usageEvents = normalizeUsageEvents(value.usageEvents);
  return {
    schemaVersion: 1,
    arxivId: value.arxivId,
    sourceHash: value.sourceHash,
    targetLanguage: "zh-CN",
    presetId: value.presetId,
    model: value.model,
    ...(usage ? { usage } : {}),
    ...(usageEvents ? { usageEvents } : {}),
    blocks,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

function normalizeUsageEvents(
  value: unknown,
): FullTranslationUsageEvent[] | null {
  if (!Array.isArray(value)) return null;
  const events: FullTranslationUsageEvent[] = [];
  for (const event of value) {
    if (!isRecord(event)) continue;
    const usage = normalizeUsage(event.usage);
    if (
      typeof event.blockId !== "string" ||
      event.blockId.length === 0 ||
      typeof event.recordedAt !== "string" ||
      event.recordedAt.length === 0 ||
      !usage
    ) {
      continue;
    }
    events.push({
      blockId: event.blockId,
      usage,
      recordedAt: event.recordedAt,
    });
  }
  return events;
}

function normalizeUsage(value: unknown): FullTranslationUsage | null {
  if (
    !isRecord(value) ||
    !isNonNegativeNumber(value.input) ||
    !isNonNegativeNumber(value.output)
  ) {
    return null;
  }
  return {
    input: value.input,
    output: value.output,
    ...(isNonNegativeNumber(value.cacheRead)
      ? { cacheRead: value.cacheRead }
      : {}),
    ...(typeof value.cacheReadIncludedInInput === "boolean"
      ? { cacheReadIncludedInInput: value.cacheReadIncludedInInput }
      : {}),
  };
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function normalizeBlockState(value: unknown): FullTranslationBlockState {
  if (!isRecord(value)) return { status: "pending" };
  const status = isBlockStatus(value.status) ? value.status : "pending";
  return {
    status,
    ...(typeof value.translation === "string"
      ? { translation: value.translation }
      : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  };
}

function isBlockStatus(value: unknown): value is FullTranslationBlockStatus {
  return (
    value === "pending" ||
    value === "translating" ||
    value === "done" ||
    value === "error" ||
    value === "skipped"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function io(): IOUtilsLike {
  return (globalThis as unknown as { IOUtils: IOUtilsLike }).IOUtils;
}
