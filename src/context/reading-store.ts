// Per-item reading position store: the "在读" anchor (section no) the user last
// jumped into from the overview, plus the paper title and a last-read timestamp.
// Mirrors overview-store.ts (single JSON file, keyed by Zotero item key,
// serialized writes, last-write-wins by updatedAt). Kept SEPARATE from the
// overview store so updating a reading position never bumps the overview data's
// updatedAt (which would risk a sync merge clobbering regenerated content).
// Rides the same sync snapshot (see sync/state.ts) → reading positions and the
// "recently read" list follow the user's WebDAV state.json across machines.

const MAX_READING_ENTRIES = 300;
const STORE_FILE = "zotero-ai-sidebar-reading-store.json";

export interface ReadingRecord {
  // Section no of the 在读 anchor (e.g. "5.2"). Optional: an item can be marked
  // recently-read before any section is jumped to.
  readingNo?: string;
  // Paper title, denormalized so the "recently read" list can render without a
  // Zotero lookup (and so it survives across machines).
  title: string;
  updatedAt: number;
}

export interface ReadingStoreSnapshot {
  entries: Record<string, ReadingRecord>;
}

export interface RecentReadingEntry extends ReadingRecord {
  itemKey: string;
}

export interface ImportReadingResult {
  imported: number;
  unchanged: number;
  skipped: number;
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

let writeQueue: Promise<void> = Promise.resolve();

function getZotero(): ZoteroGlobal {
  return (globalThis as unknown as { Zotero: ZoteroGlobal }).Zotero;
}

export function readingStorePath(): string {
  const Z = getZotero();
  const dir = Z.DataDirectory?.dir ?? Z.DataDirectory?.path ?? Z.Profile.dir;
  const sep = dir.includes("\\") ? "\\" : "/";
  const base = dir.replace(/[\\/]+$/g, "");
  return base ? `${base}${sep}${STORE_FILE}` : `${sep}${STORE_FILE}`;
}

async function readStore(): Promise<ReadingStoreSnapshot> {
  try {
    const raw = await getZotero().File.getContentsAsync(
      readingStorePath(),
      "utf-8",
    );
    return normalizeReadingStore(JSON.parse(raw));
  } catch {
    return { entries: {} };
  }
}

async function writeStore(state: ReadingStoreSnapshot): Promise<void> {
  const entries = Object.entries(state.entries);
  let trimmed = state;
  if (entries.length > MAX_READING_ENTRIES) {
    entries.sort(([, a], [, b]) => b.updatedAt - a.updatedAt);
    const out: Record<string, ReadingRecord> = {};
    for (const [k, v] of entries.slice(0, MAX_READING_ENTRIES)) out[k] = v;
    trimmed = { entries: out };
  }
  await getZotero().File.putContentsAsync(
    readingStorePath(),
    JSON.stringify(trimmed),
  );
}

export async function loadReading(
  itemKey: string,
): Promise<ReadingRecord | null> {
  if (!itemKey) return null;
  const state = await readStore();
  return state.entries[itemKey] ?? null;
}

// Upsert a reading record, MERGING with any existing one: an omitted readingNo
// keeps the stored anchor (so a plain "read this paper" event never clobbers the
// 在读 position), and an empty title keeps the stored title. Always bumps
// updatedAt (= last-read time). Writes are serialized via writeQueue.
export function saveReading(
  itemKey: string,
  record: { readingNo?: string; title: string },
  updatedAt: number = Date.now(),
): Promise<void> {
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    if (!itemKey) return;
    const state = await readStore();
    const prev = state.entries[itemKey];
    state.entries[itemKey] = {
      readingNo:
        record.readingNo !== undefined ? record.readingNo : prev?.readingNo,
      title: record.title || prev?.title || "",
      updatedAt,
    };
    await writeStore(state);
  });
  return writeQueue;
}

// The "recently read" list: entries sorted by last-read time, newest first.
export async function listRecentReading(
  limit = 12,
): Promise<RecentReadingEntry[]> {
  const state = await readStore();
  return Object.entries(state.entries)
    .map(([itemKey, rec]) => ({ itemKey, ...rec }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(0, limit));
}

export async function exportReadingStore(): Promise<ReadingStoreSnapshot> {
  return readStore();
}

export function importReadingStore(
  snapshot: ReadingStoreSnapshot | undefined,
): Promise<ImportReadingResult> {
  let outcome: ImportReadingResult = { imported: 0, unchanged: 0, skipped: 0 };
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const incoming = normalizeReadingStore(snapshot);
    const state = await readStore();
    let imported = 0;
    let unchanged = 0;
    let skipped = 0;
    for (const [key, entry] of Object.entries(incoming.entries)) {
      if (!key) {
        skipped += 1;
        continue;
      }
      const existing = state.entries[key];
      if (existing && existing.updatedAt >= entry.updatedAt) {
        unchanged += 1;
        continue;
      }
      state.entries[key] = entry;
      imported += 1;
    }
    await writeStore(state);
    outcome = { imported, unchanged, skipped };
  });
  return writeQueue.then(() => outcome);
}

export function normalizeReadingStore(value: unknown): ReadingStoreSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { entries: {} };
  }
  const entries = (value as { entries?: Record<string, unknown> }).entries;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    return { entries: {} };
  }
  const out: Record<string, ReadingRecord> = {};
  for (const [key, raw] of Object.entries(entries)) {
    if (!key || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const r = raw as { readingNo?: unknown; title?: unknown; updatedAt?: unknown };
    if (typeof r.updatedAt !== "number" || !Number.isFinite(r.updatedAt)) continue;
    out[key] = {
      readingNo: typeof r.readingNo === "string" ? r.readingNo : undefined,
      title: typeof r.title === "string" ? r.title : "",
      updatedAt: r.updatedAt,
    };
  }
  return { entries: out };
}
