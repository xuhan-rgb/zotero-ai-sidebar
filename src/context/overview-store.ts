import type {
  OverviewData,
  OverviewEmphasis,
  OverviewPhase,
  OverviewSection,
} from "./overview-types";
import type { MindmapData, MindmapNode } from "../providers/types";

function asPhase(value: unknown): OverviewPhase | undefined {
  return value === "motivation" || value === "method" || value === "validation"
    ? value
    : undefined;
}

function asEmphasis(value: unknown): OverviewEmphasis | undefined {
  return value === "innovation" ||
    value === "result" ||
    value === "normal" ||
    value === "background"
    ? value
    : undefined;
}

// Per-item store for rendered paper overviews. Mirrors translate/cache.ts:
// a single JSON file holding a map keyed by Zotero item key, serialized
// writes via a queue, last-write-wins by `updatedAt` on merge. Riding the
// existing sync snapshot (see sync/state.ts) lets overviews follow the
// user's WebDAV state.json across devices.

const MAX_OVERVIEW_ENTRIES = 500;
const STORE_FILE = "zotero-ai-sidebar-overview-store.json";

export interface StoredOverview {
  data: OverviewData;
  updatedAt: number;
}

export interface OverviewStoreSnapshot {
  entries: Record<string, StoredOverview>;
}

export interface ImportOverviewsResult {
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

export function overviewStorePath(): string {
  const Z = getZotero();
  const dir = Z.DataDirectory?.dir ?? Z.DataDirectory?.path ?? Z.Profile.dir;
  const sep = dir.includes("\\") ? "\\" : "/";
  const base = dir.replace(/[\\/]+$/g, "");
  return base ? `${base}${sep}${STORE_FILE}` : `${sep}${STORE_FILE}`;
}

async function readStore(): Promise<OverviewStoreSnapshot> {
  try {
    const raw = await getZotero().File.getContentsAsync(
      overviewStorePath(),
      "utf-8",
    );
    return normalizeOverviewStore(JSON.parse(raw));
  } catch {
    return { entries: {} };
  }
}

async function writeStore(state: OverviewStoreSnapshot): Promise<void> {
  const entries = Object.entries(state.entries);
  let trimmed = state;
  if (entries.length > MAX_OVERVIEW_ENTRIES) {
    entries.sort(([, a], [, b]) => b.updatedAt - a.updatedAt);
    const out: Record<string, StoredOverview> = {};
    for (const [k, v] of entries.slice(0, MAX_OVERVIEW_ENTRIES)) out[k] = v;
    trimmed = { entries: out };
  }
  await getZotero().File.putContentsAsync(
    overviewStorePath(),
    JSON.stringify(trimmed),
  );
}

export async function loadOverview(
  itemKey: string,
): Promise<StoredOverview | null> {
  if (!itemKey) return null;
  const state = await readStore();
  return state.entries[itemKey] ?? null;
}

// Writes are serialized via writeQueue — same pattern as translate/cache.ts.
export function saveOverview(
  itemKey: string,
  data: OverviewData,
  updatedAt: number = Date.now(),
): Promise<void> {
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    if (!itemKey) return;
    const state = await readStore();
    state.entries[itemKey] = { data, updatedAt };
    await writeStore(state);
  });
  return writeQueue;
}

export async function exportOverviews(): Promise<OverviewStoreSnapshot> {
  return readStore();
}

export function importOverviews(
  snapshot: OverviewStoreSnapshot | undefined,
): Promise<ImportOverviewsResult> {
  let outcome: ImportOverviewsResult = { imported: 0, unchanged: 0, skipped: 0 };
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const incoming = normalizeOverviewStore(snapshot);
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

export function normalizeOverviewStore(value: unknown): OverviewStoreSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { entries: {} };
  }
  const entries = (value as { entries?: Record<string, unknown> }).entries;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    return { entries: {} };
  }
  const out: Record<string, StoredOverview> = {};
  for (const [key, raw] of Object.entries(entries)) {
    if (!key || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as { data?: unknown; updatedAt?: unknown };
    const data = normalizeOverviewData(entry.data);
    if (!data) continue;
    if (typeof entry.updatedAt !== "number" || !Number.isFinite(entry.updatedAt))
      continue;
    out[key] = { data, updatedAt: entry.updatedAt };
  }
  return { entries: out };
}

function normalizeOverviewData(raw: unknown): OverviewData | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.sections)) return null;
  const sections: OverviewSection[] = r.sections
    .filter(
      (s): s is Record<string, unknown> =>
        !!s && typeof s === "object" && !Array.isArray(s),
    )
    .map((s) => ({
      no: typeof s.no === "string" ? s.no : "",
      level: typeof s.level === "number" ? s.level : 1,
      title: typeof s.title === "string" ? s.title : "",
      gist: typeof s.gist === "string" ? s.gist : undefined,
      charStart: typeof s.charStart === "number" ? s.charStart : 0,
      charEnd: typeof s.charEnd === "number" ? s.charEnd : 0,
      pageLabel: typeof s.pageLabel === "string" ? s.pageLabel : undefined,
      anchors: Array.isArray(s.anchors)
        ? s.anchors.filter((a): a is string => typeof a === "string")
        : undefined,
      phase: asPhase(s.phase),
      emphasis: asEmphasis(s.emphasis),
    }));
  return {
    title: typeof r.title === "string" ? r.title : "",
    source: r.source === "arxiv" ? "arxiv" : "pdf",
    coverage: r.coverage === "uniform-fallback" ? "uniform-fallback" : "headings",
    narrative: typeof r.narrative === "string" ? r.narrative : undefined,
    sections,
    flowchart: normalizeStoredFlowchart(r.flowchart),
  };
}

function normalizeStoredFlowchart(raw: unknown): MindmapData | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as { rankdir?: unknown; nodes?: unknown; edges?: unknown };
  if (!Array.isArray(r.nodes)) return undefined;
  const nodes: MindmapNode[] = r.nodes
    .filter(
      (n): n is Record<string, unknown> =>
        !!n &&
        typeof n === "object" &&
        typeof (n as { id?: unknown }).id === "string" &&
        typeof (n as { label?: unknown }).label === "string",
    )
    .map((n) => ({
      id: n.id as string,
      label: n.label as string,
      type: (["root", "section", "point", "result", "innovation"].includes(
        n.type as string,
      )
        ? (n.type as string)
        : "point") as MindmapNode["type"],
      ...(typeof n.sectionNo === "string"
        ? { sectionNo: n.sectionNo as string }
        : {}),
    }));
  if (!nodes.length) return undefined;
  const ids = new Set(nodes.map((n) => n.id));
  const edges = Array.isArray(r.edges)
    ? r.edges
        .filter(
          (e): e is Record<string, unknown> =>
            !!e &&
            typeof e === "object" &&
            ids.has((e as { source?: unknown }).source as string) &&
            ids.has((e as { target?: unknown }).target as string),
        )
        .map((e) => ({
          source: e.source as string,
          target: e.target as string,
          ...(typeof e.label === "string" && e.label
            ? { label: e.label as string }
            : {}),
        }))
    : [];
  return {
    nodes,
    edges,
    rankdir: r.rankdir === "TB" ? "TB" : r.rankdir === "LR" ? "LR" : undefined,
  };
}
