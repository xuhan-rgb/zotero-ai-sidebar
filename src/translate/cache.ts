export const MAX_CACHE_ENTRIES = 500;

export interface CacheEntry {
  text: string;
  model: string;
  createdAt: number;
}

interface CacheState {
  entries: Record<string, CacheEntry>;
}

export interface TranslateCacheSnapshot {
  entries: Record<string, CacheEntry>;
}

export interface ImportTranslateCacheResult {
  imported: number;
  unchanged: number;
  skipped: number;
}

interface CacheKeyInput {
  sentence: string;
  target: string;
  endpoint: string;
  model: string;
  thinking: string;
  ctxLevel: string;
  // Distinguishes derived outputs for the SAME sentence (e.g. "breakdown" vs the
  // default translation). Omitted/`translate` keeps the legacy key byte-identical
  // so existing on-disk translation cache entries still hit.
  kind?: string;
}

interface ZoteroFileAPI {
  getContentsAsync(path: string, charset?: string): Promise<string>;
  putContentsAsync(path: string, contents: string): Promise<void>;
}

interface ZoteroGlobal {
  File: ZoteroFileAPI;
  DataDirectory?: { dir?: string; path?: string };
  Profile: { dir: string };
}

// Synchronous FNV-1a-style 64-bit hex digest. Cache keys need stability
// and low collision rate, not crypto strength — and we run in environments
// where WebCrypto's sync API is unavailable.
function fnv1aHex64(input: string): string {
  let h1 = 0xcbf29ce4 >>> 0;
  let h2 = 0x84222325 >>> 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + 0x9e37), 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

function normalizeSentence(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function cacheKey(input: CacheKeyInput): string {
  const parts = [
    normalizeSentence(input.sentence),
    input.target,
    input.endpoint,
    input.model,
    input.thinking,
    input.ctxLevel,
  ];
  // Append the kind only for non-default outputs so legacy translation keys
  // (no kind / 'translate') keep their existing hash and stay cache-hot.
  if (input.kind && input.kind !== 'translate') parts.push(input.kind);
  return fnv1aHex64(parts.join('|')).slice(0, 16);
}

const CACHE_FILE = 'zotero-ai-sidebar-translate-cache.json';
let writeQueue: Promise<void> = Promise.resolve();

function getZotero(): ZoteroGlobal {
  return (globalThis as unknown as { Zotero: ZoteroGlobal }).Zotero;
}

export function translateCachePath(): string {
  const Z = getZotero();
  const dir = Z.DataDirectory?.dir ?? Z.DataDirectory?.path ?? Z.Profile.dir;
  return appendLocalFile(dir, CACHE_FILE);
}

function appendLocalFile(dir: string, file: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  const base = dir.replace(/[\\/]+$/g, '');
  return base ? `${base}${sep}${file}` : `${sep}${file}`;
}

async function readCache(): Promise<CacheState> {
  try {
    const raw = await getZotero().File.getContentsAsync(translateCachePath(), 'utf-8');
    return normalizeTranslateCache(JSON.parse(raw));
  } catch {
    return { entries: {} };
  }
}

async function writeCache(state: CacheState): Promise<void> {
  const entries = Object.entries(state.entries);
  let trimmed = state;
  if (entries.length > MAX_CACHE_ENTRIES) {
    entries.sort(([, a], [, b]) => b.createdAt - a.createdAt);
    const out: Record<string, CacheEntry> = {};
    for (const [k, v] of entries.slice(0, MAX_CACHE_ENTRIES)) out[k] = v;
    trimmed = { entries: out };
  }
  await getZotero().File.putContentsAsync(translateCachePath(), JSON.stringify(trimmed));
}

export async function getCachedTranslation(key: string): Promise<CacheEntry | undefined> {
  const state = await readCache();
  return state.entries[key];
}

// Writes are serialized via writeQueue — same pattern as chat-history.ts.
export function setCachedTranslation(key: string, entry: CacheEntry): Promise<void> {
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const state = await readCache();
    state.entries[key] = entry;
    await writeCache(state);
  });
  return writeQueue;
}

export async function exportTranslateCache(): Promise<TranslateCacheSnapshot> {
  return readCache();
}

export function importTranslateCache(
  snapshot: TranslateCacheSnapshot | undefined,
): Promise<ImportTranslateCacheResult> {
  let outcome: ImportTranslateCacheResult = {
    imported: 0,
    unchanged: 0,
    skipped: 0,
  };
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const incoming = normalizeTranslateCache(snapshot);
    const state = await readCache();
    let imported = 0;
    let unchanged = 0;
    let skipped = 0;
    for (const [key, entry] of Object.entries(incoming.entries)) {
      const existing = state.entries[key];
      if (existing && existing.createdAt >= entry.createdAt) {
        unchanged += 1;
        continue;
      }
      if (!key) {
        skipped += 1;
        continue;
      }
      state.entries[key] = entry;
      imported += 1;
    }
    await writeCache(state);
    outcome = { imported, unchanged, skipped };
  });
  return writeQueue.then(() => outcome);
}

export function normalizeTranslateCache(value: unknown): TranslateCacheSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { entries: {} };
  }
  const entries = (value as { entries?: Record<string, unknown> }).entries;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    return { entries: {} };
  }
  const out: Record<string, CacheEntry> = {};
  for (const [key, raw] of Object.entries(entries)) {
    if (!key || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const entry = raw as Partial<CacheEntry>;
    if (
      typeof entry.text === 'string' &&
      typeof entry.model === 'string' &&
      typeof entry.createdAt === 'number' &&
      Number.isFinite(entry.createdAt)
    ) {
      out[key] = {
        text: entry.text,
        model: entry.model,
        createdAt: entry.createdAt,
      };
    }
  }
  return { entries: out };
}
