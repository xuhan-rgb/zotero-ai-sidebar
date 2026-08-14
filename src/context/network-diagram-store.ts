import type {
  DetailedNetworkGraph,
  EvidenceReference,
  InitialDetailCategory,
  NetworkDiagramCoverageItem,
  NetworkDiagramMessage,
  NetworkDiagramRepository,
  NetworkDiagramRevision,
  NetworkDiagramWorkspace,
} from "./network-diagram-types";

const STORE_FILE = "zotero-ai-sidebar-network-diagram-store.json";
const MAX_WORKSPACES = 500;

export interface StoredNetworkDiagramWorkspace {
  workspace: NetworkDiagramWorkspace;
  updatedAt: number;
}

export interface NetworkDiagramStoreSnapshot {
  entries: Record<string, StoredNetworkDiagramWorkspace>;
}

export interface ImportNetworkDiagramWorkspacesResult {
  imported: number;
  unchanged: number;
  skipped: number;
}

interface ZoteroGlobal {
  File: {
    getContentsAsync(path: string, charset?: string): Promise<string>;
    putContentsAsync(path: string, contents: string): Promise<void>;
  };
  DataDirectory?: { dir?: string; path?: string };
  Profile: { dir: string };
}

let writeQueue: Promise<void> = Promise.resolve();

function getZotero(): ZoteroGlobal {
  return (globalThis as unknown as { Zotero: ZoteroGlobal }).Zotero;
}

export function networkDiagramStorePath(): string {
  const Zotero = getZotero();
  const dir =
    Zotero.DataDirectory?.dir ??
    Zotero.DataDirectory?.path ??
    Zotero.Profile.dir;
  const separator = dir.includes("\\") ? "\\" : "/";
  const base = dir.replace(/[\\/]+$/g, "");
  return base
    ? `${base}${separator}${STORE_FILE}`
    : `${separator}${STORE_FILE}`;
}

async function readStore(): Promise<NetworkDiagramStoreSnapshot> {
  try {
    const raw = await getZotero().File.getContentsAsync(
      networkDiagramStorePath(),
      "utf-8",
    );
    return normalizeNetworkDiagramStore(JSON.parse(raw));
  } catch {
    return { entries: {} };
  }
}

async function writeStore(state: NetworkDiagramStoreSnapshot): Promise<void> {
  const entries = Object.entries(state.entries).sort(
    ([, a], [, b]) => b.updatedAt - a.updatedAt,
  );
  const trimmed = Object.fromEntries(entries.slice(0, MAX_WORKSPACES));
  await getZotero().File.putContentsAsync(
    networkDiagramStorePath(),
    JSON.stringify({ entries: trimmed }),
  );
}

export async function loadNetworkDiagramWorkspace(
  itemKey: string,
): Promise<StoredNetworkDiagramWorkspace | null> {
  if (!itemKey) return null;
  return (await readStore()).entries[itemKey] ?? null;
}

export function saveNetworkDiagramWorkspace(
  itemKey: string,
  workspace: NetworkDiagramWorkspace,
  updatedAt: number = Date.now(),
): Promise<void> {
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      if (!itemKey) return;
      const state = await readStore();
      state.entries[itemKey] = {
        workspace: { ...workspace, itemKey },
        updatedAt,
      };
      await writeStore(state);
    });
  return writeQueue;
}

export async function exportNetworkDiagramWorkspaces(): Promise<NetworkDiagramStoreSnapshot> {
  return readStore();
}

export function importNetworkDiagramWorkspaces(
  snapshot: NetworkDiagramStoreSnapshot | undefined,
): Promise<ImportNetworkDiagramWorkspacesResult> {
  let result: ImportNetworkDiagramWorkspacesResult = {
    imported: 0,
    unchanged: 0,
    skipped: 0,
  };
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      const incoming = normalizeNetworkDiagramStore(snapshot);
      const current = await readStore();
      for (const [key, entry] of Object.entries(incoming.entries)) {
        if (!key) {
          result.skipped += 1;
          continue;
        }
        const existing = current.entries[key];
        if (existing && existing.updatedAt >= entry.updatedAt) {
          result.unchanged += 1;
          continue;
        }
        current.entries[key] = entry;
        result.imported += 1;
      }
      await writeStore(current);
    });
  return writeQueue.then(() => result);
}

export function appendNetworkDiagramRevision(
  workspace: NetworkDiagramWorkspace,
  revision: NetworkDiagramRevision,
): NetworkDiagramWorkspace {
  const revisions = workspace.revisions.filter(
    (existing) => existing.id !== revision.id,
  );
  revisions.push(revision);
  return {
    ...workspace,
    currentRevisionID: revision.id,
    latestRevisionID: revision.id,
    revisions,
  };
}

export function clearNetworkDiagramMessages(
  workspace: NetworkDiagramWorkspace,
): NetworkDiagramWorkspace {
  return workspace.messages.length ? { ...workspace, messages: [] } : workspace;
}

export function undoNetworkDiagramRevision(
  workspace: NetworkDiagramWorkspace,
): NetworkDiagramWorkspace {
  const current = workspace.revisions.find(
    (revision) => revision.id === workspace.currentRevisionID,
  );
  if (!current?.parentID) return workspace;
  if (
    !workspace.revisions.some((revision) => revision.id === current.parentID)
  ) {
    return workspace;
  }
  return { ...workspace, currentRevisionID: current.parentID };
}

export function restoreLatestNetworkDiagramRevision(
  workspace: NetworkDiagramWorkspace,
): NetworkDiagramWorkspace {
  if (!workspace.latestRevisionID) return workspace;
  if (
    !workspace.revisions.some(
      (revision) => revision.id === workspace.latestRevisionID,
    )
  ) {
    return workspace;
  }
  return { ...workspace, currentRevisionID: workspace.latestRevisionID };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function normalizeUsage(
  value: unknown,
): NetworkDiagramRevision["usage"] | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.input !== "number" ||
    !Number.isFinite(value.input) ||
    value.input < 0 ||
    typeof value.output !== "number" ||
    !Number.isFinite(value.output) ||
    value.output < 0
  ) {
    return undefined;
  }
  const cacheRead =
    typeof value.cacheRead === "number" &&
    Number.isFinite(value.cacheRead) &&
    value.cacheRead >= 0
      ? value.cacheRead
      : undefined;
  return {
    input: value.input,
    output: value.output,
    ...(cacheRead != null ? { cacheRead } : {}),
  };
}

const CATEGORIES = new Set<InitialDetailCategory>([
  "inputs-preprocess",
  "backbone-features",
  "core-innovations",
  "branches-fusion",
  "inference-path",
  "training-path",
  "parameters-tensors",
  "outputs",
]);

function category(value: unknown): InitialDetailCategory | null {
  return typeof value === "string" &&
    CATEGORIES.has(value as InitialDetailCategory)
    ? (value as InitialDetailCategory)
    : null;
}

function normalizeNodeNotes(value: unknown) {
  if (!isRecord(value)) return undefined;
  const attribution = [
    "paper-contribution",
    "adopted-baseline",
    "standard-module",
    "tensor-operation",
    "input-output",
  ].includes(String(value.attribution))
    ? (value.attribution as NonNullable<
        DetailedNetworkGraph["nodes"][number]["notes"]
      >["attribution"])
    : null;
  if (
    typeof value.parameters !== "string" ||
    typeof value.dataFlow !== "string" ||
    typeof value.objective !== "string" ||
    typeof value.implementation !== "string" ||
    !attribution
  ) {
    return undefined;
  }
  return {
    parameters: value.parameters,
    dataFlow: value.dataFlow,
    objective: value.objective,
    attribution,
    implementation: value.implementation,
  };
}

function normalizeGraph(value: unknown): DetailedNetworkGraph | null {
  if (!isRecord(value) || !Array.isArray(value.nodes)) return null;
  const nodes = value.nodes.flatMap((node) => {
    if (!isRecord(node)) return [];
    const stage = category(node.stage);
    if (
      typeof node.id !== "string" ||
      typeof node.label !== "string" ||
      !stage
    ) {
      return [];
    }
    const allowedTypes = ["root", "section", "point", "result", "innovation"];
    const type = allowedTypes.includes(String(node.type))
      ? (node.type as "root" | "section" | "point" | "result" | "innovation")
      : "point";
    return [
      {
        id: node.id,
        label: node.label,
        type,
        stage,
        description:
          typeof node.description === "string" ? node.description : "",
        tensorShape:
          typeof node.tensorShape === "string" ? node.tensorShape : undefined,
        notes: normalizeNodeNotes(node.notes),
        sectionNo:
          typeof node.sectionNo === "string" ? node.sectionNo : undefined,
        evidenceIDs: strings(node.evidenceIDs),
      },
    ];
  });
  const ids = new Set(nodes.map((node) => node.id));
  const rawEdges = Array.isArray(value.edges) ? value.edges : [];
  const edges = rawEdges.flatMap((edge) => {
    if (
      !isRecord(edge) ||
      typeof edge.source !== "string" ||
      typeof edge.target !== "string" ||
      !ids.has(edge.source) ||
      !ids.has(edge.target)
    ) {
      return [];
    }
    return [
      {
        source: edge.source,
        target: edge.target,
        label: typeof edge.label === "string" ? edge.label : undefined,
      },
    ];
  });
  return { rankdir: "TB", nodes, edges };
}

function normalizeCoverage(value: unknown): NetworkDiagramCoverageItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const resolvedCategory = category(item.category);
    const status = ["missing", "partial", "done", "not-applicable"].includes(
      String(item.status),
    )
      ? (item.status as NetworkDiagramCoverageItem["status"])
      : null;
    if (!resolvedCategory || !status) return [];
    return [
      {
        category: resolvedCategory,
        status,
        summary: typeof item.summary === "string" ? item.summary : "",
        evidenceIDs: strings(item.evidenceIDs),
      },
    ];
  });
}

function normalizeRepository(
  value: unknown,
): NetworkDiagramRepository | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.url !== "string" ||
    typeof value.owner !== "string" ||
    typeof value.repo !== "string" ||
    typeof value.defaultBranch !== "string" ||
    typeof value.commitSHA !== "string"
  ) {
    return undefined;
  }
  return {
    url: value.url,
    owner: value.owner,
    repo: value.repo,
    defaultBranch: value.defaultBranch,
    commitSHA: value.commitSHA,
    analyzedAt:
      typeof value.analyzedAt === "number" ? value.analyzedAt : Date.now(),
  };
}

function normalizeRevision(value: unknown): NetworkDiagramRevision | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  const graph = normalizeGraph(value.graph);
  if (!graph) return null;
  return {
    id: value.id,
    parentID: typeof value.parentID === "string" ? value.parentID : undefined,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    userInstruction:
      typeof value.userInstruction === "string" ? value.userInstruction : "",
    assistantSummary:
      typeof value.assistantSummary === "string" ? value.assistantSummary : "",
    usage: normalizeUsage(value.usage),
    repository: normalizeRepository(value.repository),
    graph,
    coverage: normalizeCoverage(value.coverage),
    evidenceIDs: strings(value.evidenceIDs),
    changedNodeIDs: strings(value.changedNodeIDs),
  };
}

function normalizeMessage(value: unknown): NetworkDiagramMessage | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  if (value.role !== "user" && value.role !== "assistant") return null;
  return {
    id: value.id,
    role: value.role,
    content: typeof value.content === "string" ? value.content : "",
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
  };
}

function normalizeEvidence(value: unknown): EvidenceReference | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  if (value.kind !== "code" && value.kind !== "paper") return null;
  const resolvedCoverage = category(value.coverage);
  return {
    id: value.id,
    kind: value.kind,
    label: typeof value.label === "string" ? value.label : value.id,
    path: typeof value.path === "string" ? value.path : undefined,
    symbols: strings(value.symbols),
    commitSHA:
      typeof value.commitSHA === "string" ? value.commitSHA : undefined,
    sectionNo:
      typeof value.sectionNo === "string" ? value.sectionNo : undefined,
    reason: typeof value.reason === "string" ? value.reason : undefined,
    coverage: resolvedCoverage ?? undefined,
  };
}

function normalizeWorkspace(
  value: unknown,
  fallbackKey: string,
): NetworkDiagramWorkspace | null {
  if (!isRecord(value)) return null;
  const revisions = Array.isArray(value.revisions)
    ? value.revisions
        .map(normalizeRevision)
        .filter((entry): entry is NetworkDiagramRevision => entry != null)
    : [];
  const revisionIDs = new Set(revisions.map((revision) => revision.id));
  const currentRevisionID =
    typeof value.currentRevisionID === "string" &&
    revisionIDs.has(value.currentRevisionID)
      ? value.currentRevisionID
      : undefined;
  const latestRevisionID =
    typeof value.latestRevisionID === "string" &&
    revisionIDs.has(value.latestRevisionID)
      ? value.latestRevisionID
      : undefined;
  return {
    itemKey:
      typeof value.itemKey === "string" && value.itemKey
        ? value.itemKey
        : fallbackKey,
    linkedRepositoryURL:
      typeof value.linkedRepositoryURL === "string"
        ? value.linkedRepositoryURL
        : undefined,
    repository: normalizeRepository(value.repository),
    currentRevisionID,
    latestRevisionID,
    revisions,
    messages: Array.isArray(value.messages)
      ? value.messages
          .map(normalizeMessage)
          .filter((entry): entry is NetworkDiagramMessage => entry != null)
      : [],
    evidenceIndex: Array.isArray(value.evidenceIndex)
      ? value.evidenceIndex
          .map(normalizeEvidence)
          .filter((entry): entry is EvidenceReference => entry != null)
      : [],
  };
}

export function normalizeNetworkDiagramStore(
  value: unknown,
): NetworkDiagramStoreSnapshot {
  if (!isRecord(value) || !isRecord(value.entries)) return { entries: {} };
  const entries: Record<string, StoredNetworkDiagramWorkspace> = {};
  for (const [key, entry] of Object.entries(value.entries)) {
    if (!key || !isRecord(entry)) continue;
    const workspace = normalizeWorkspace(entry.workspace, key);
    if (!workspace || typeof entry.updatedAt !== "number") continue;
    entries[key] = { workspace, updatedAt: entry.updatedAt };
  }
  return { entries };
}
