import {
  exportAllAnnotations,
  importAllAnnotations,
  type ImportAnnotationsResult,
  type PortableAnnotation,
} from './annotations';
import {
  loadQuickPromptSettings,
  normalizeQuickPromptSettings,
  saveQuickPromptSettings,
  type QuickPromptSettings,
} from '../settings/quick-prompts';
import {
  loadPresets,
  normalizePresetList,
  savePresets,
  type PrefsStore,
} from '../settings/storage';
import {
  loadToolSettings,
  normalizeToolSettings,
  saveToolSettings,
  type ToolSettings,
} from '../settings/tool-settings';
import type { ModelPreset, TranslateSettings } from '../settings/types';
import {
  loadTranslateSettings,
  normalizeTranslateSettings,
  saveTranslateSettings,
} from '../translate/settings';
import {
  loadUiSettings,
  normalizeUiSettings,
  saveUiSettings,
  type UiSettings,
} from '../settings/ui-settings';
import {
  exportAllThreads,
  importAllThreads,
  type ImportThreadsResult,
  type PortableThread,
} from '../settings/chat-history';
import {
  exportTranslateCache,
  importTranslateCache,
  normalizeTranslateCache,
  type ImportTranslateCacheResult,
  type TranslateCacheSnapshot,
} from '../translate/cache';
import {
  exportOverviews,
  importOverviews,
  normalizeOverviewStore,
  type ImportOverviewsResult,
  type OverviewStoreSnapshot,
} from '../context/overview-store';
import {
  exportReadingStore,
  importReadingStore,
  normalizeReadingStore,
  type ImportReadingResult,
  type ReadingStoreSnapshot,
} from '../context/reading-store';

// Sync snapshot: the on-the-wire JSON we push to / pull from the cloud.
//
// `schema` is required so a future format break can be detected and rejected
// with a clear error instead of silently mis-merging.
//
// Chat history uses portable Zotero item keys on the wire because local
// numeric itemIDs differ across machines. Translation cache keys are already
// deterministic hashes of the sentence + translation settings.

export const SYNC_SCHEMA = 'zotero-ai-sidebar.sync.v1';

export interface SyncSnapshot {
  schema: typeof SYNC_SCHEMA;
  exportedAt: string;
  presets: ModelPreset[];
  uiSettings: UiSettings;
  quickPrompts: QuickPromptSettings;
  toolSettings: ToolSettings;
  // `annotations` was added after the initial v1 snapshot shipped, so it
  // stays optional on the wire — older payloads without it parse fine
  // and just yield zero imports.
  annotations: PortableAnnotation[];
  // Added v1.1 (still under SYNC_SCHEMA v1 — optional on the wire).
  translateSettings?: TranslateSettings;
  // Added later under the same v1 envelope; optional on the wire for old
  // payloads that were uploaded before chat/cache sync existed.
  threads?: PortableThread[];
  translateCache?: TranslateCacheSnapshot;
  // Per-item rendered paper overviews; optional on the wire for payloads
  // uploaded before overview sync existed.
  overviews?: OverviewStoreSnapshot;
  // Per-item reading positions ("在读" anchor); optional on the wire for
  // payloads uploaded before reading-position sync existed.
  readingPositions?: ReadingStoreSnapshot;
}

export interface ApplySnapshotResult {
  annotations: ImportAnnotationsResult;
  threads: ImportThreadsResult;
  translateCache: ImportTranslateCacheResult;
  overviews: ImportOverviewsResult;
  readingPositions: ImportReadingResult;
}

export async function buildSyncSnapshot(
  prefs: PrefsStore,
): Promise<SyncSnapshot> {
  const [annotations, threads, translateCache, overviews, readingPositions] =
    await Promise.all([
      exportAllAnnotations(),
      exportAllThreads(),
      exportTranslateCache(),
      exportOverviews(),
      exportReadingStore(),
    ]);
  return {
    schema: SYNC_SCHEMA,
    exportedAt: new Date().toISOString(),
    presets: loadPresets(prefs),
    uiSettings: loadUiSettings(prefs),
    quickPrompts: loadQuickPromptSettings(prefs),
    toolSettings: loadToolSettings(prefs),
    annotations,
    translateSettings: loadTranslateSettings(prefs),
    threads,
    translateCache,
    overviews,
    readingPositions,
  };
}

export function parseSyncSnapshot(raw: string): SyncSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('云端配置 JSON 解析失败');
  }
  if (!isRecord(parsed)) throw new Error('云端配置必须是 JSON 对象');
  if (parsed.schema !== SYNC_SCHEMA) {
    throw new Error(
      `云端 schema 版本不兼容：本地 ${SYNC_SCHEMA}，云端 ${String(parsed.schema)}`,
    );
  }
  return {
    schema: SYNC_SCHEMA,
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '',
    presets: Array.isArray(parsed.presets)
      ? normalizePresetList(parsed.presets)
      : [],
    uiSettings: normalizeUiSettings(parsed.uiSettings),
    quickPrompts: normalizeQuickPromptSettings(parsed.quickPrompts),
    toolSettings: normalizeToolSettings(parsed.toolSettings),
    annotations: normalizePortableAnnotations(parsed.annotations),
    translateSettings:
      parsed.translateSettings === undefined
        ? undefined
        : normalizeTranslateSettings(parsed.translateSettings),
    threads: normalizePortableThreads(parsed.threads),
    translateCache: normalizeTranslateCache(parsed.translateCache),
    overviews: normalizeOverviewStore(parsed.overviews),
    readingPositions: normalizeReadingStore(parsed.readingPositions),
  };
}

export async function applySyncSnapshot(
  prefs: PrefsStore,
  snapshot: SyncSnapshot,
): Promise<ApplySnapshotResult> {
  savePresets(prefs, snapshot.presets);
  saveUiSettings(prefs, snapshot.uiSettings);
  saveQuickPromptSettings(prefs, snapshot.quickPrompts);
  saveToolSettings(prefs, snapshot.toolSettings);
  if (snapshot.translateSettings)
    saveTranslateSettings(prefs, snapshot.translateSettings);
  const [annotations, threads, translateCache, overviews, readingPositions] =
    await Promise.all([
      importAllAnnotations(snapshot.annotations),
      importAllThreads(snapshot.threads ?? []),
      importTranslateCache(snapshot.translateCache),
      importOverviews(snapshot.overviews),
      importReadingStore(snapshot.readingPositions),
    ]);
  return { annotations, threads, translateCache, overviews, readingPositions };
}

function normalizePortableThreads(value: unknown): PortableThread[] {
  const threads: PortableThread[] = [];
  if (!Array.isArray(value)) return [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const libraryType =
      entry.libraryType === 'user' ||
      entry.libraryType === 'group' ||
      entry.libraryType === 'global'
        ? entry.libraryType
        : null;
    if (!libraryType) continue;
    const updatedAt =
      typeof entry.updatedAt === 'string' ? entry.updatedAt : '';
    const messages = Array.isArray(entry.messages) ? entry.messages : [];
    const conversationID =
      typeof entry.conversationID === 'string'
        ? entry.conversationID.trim()
        : '';
    if (!updatedAt || (messages.length === 0 && !conversationID)) continue;
    const conversationFields = conversationID
      ? {
          conversationID,
          ...(typeof entry.title === 'string' && entry.title.trim()
            ? { title: entry.title.trim() }
            : {}),
          ...(typeof entry.presetID === 'string' && entry.presetID
            ? { presetID: entry.presetID }
            : {}),
          ...(typeof entry.draftText === 'string'
            ? { draftText: entry.draftText }
            : {}),
          ...(entry.historyMode === 'none' ||
          entry.historyMode === 'previous' ||
          entry.historyMode === 'all'
            ? { historyMode: entry.historyMode }
            : {}),
          ...(typeof entry.createdAt === 'string' && entry.createdAt
            ? { createdAt: entry.createdAt }
            : {}),
          ...(typeof entry.active === 'boolean'
            ? { active: entry.active }
            : {}),
        }
      : {};
    if (libraryType === 'global') {
      threads.push({
        libraryType,
        ...conversationFields,
        updatedAt,
        messages: messages as PortableThread['messages'],
      });
      continue;
    }
    const itemKey = typeof entry.itemKey === 'string' ? entry.itemKey : '';
    if (!itemKey) continue;
    if (libraryType === 'group') {
      if (typeof entry.groupID !== 'number') continue;
      threads.push({
        libraryType,
        groupID: entry.groupID,
        itemKey,
        ...conversationFields,
        updatedAt,
        messages: messages as PortableThread['messages'],
      });
      continue;
    }
    threads.push({
      libraryType,
      itemKey,
      ...conversationFields,
      updatedAt,
      messages: messages as PortableThread['messages'],
    });
  }
  return threads;
}

function normalizePortableAnnotations(value: unknown): PortableAnnotation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const libraryType =
      entry.libraryType === 'user' || entry.libraryType === 'group'
        ? entry.libraryType
        : null;
    if (!libraryType) return [];
    const parentItemKey =
      typeof entry.parentItemKey === 'string' ? entry.parentItemKey : '';
    const key = typeof entry.key === 'string' ? entry.key : '';
    const dateModified =
      typeof entry.dateModified === 'string' ? entry.dateModified : '';
    const type = entry.type;
    const validType =
      type === 'highlight' ||
      type === 'underline' ||
      type === 'note' ||
      type === 'ink';
    if (!parentItemKey || !key || !dateModified || !validType) return [];
    if (!isRecord(entry.json)) return [];
    if (libraryType === 'group' && typeof entry.groupID !== 'number') return [];
    const tags = Array.isArray(entry.tags)
      ? entry.tags.filter((t): t is string => typeof t === 'string')
      : [];
    const portable: PortableAnnotation = {
      libraryType,
      parentItemKey,
      key,
      dateModified,
      type,
      json: entry.json,
      tags,
    };
    if (typeof entry.groupID === 'number') portable.groupID = entry.groupID;
    if (typeof entry.parentParentItemKey === 'string') {
      portable.parentParentItemKey = entry.parentParentItemKey;
    }
    return [portable];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
