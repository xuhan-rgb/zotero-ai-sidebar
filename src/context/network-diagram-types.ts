import type {
  MessageUsage,
  MindmapData,
  MindmapNode,
} from "../providers/types";

export type InitialDetailCategory =
  | "inputs-preprocess"
  | "backbone-features"
  | "core-innovations"
  | "branches-fusion"
  | "inference-path"
  | "training-path"
  | "parameters-tensors"
  | "outputs";

export type InitialDetailCoverageStatus =
  | "missing"
  | "partial"
  | "done"
  | "not-applicable";

export interface NetworkDiagramCoverageItem {
  category: InitialDetailCategory;
  status: InitialDetailCoverageStatus;
  summary: string;
  evidenceIDs: string[];
}

export type NetworkDiagramNodeAttribution =
  | "paper-contribution"
  | "adopted-baseline"
  | "standard-module"
  | "tensor-operation"
  | "input-output";

export interface NetworkDiagramNodeNotes {
  parameters: string;
  dataFlow: string;
  objective: string;
  attribution: NetworkDiagramNodeAttribution;
  implementation: string;
}

export interface DetailedNetworkNode {
  id: string;
  label: string;
  type: NonNullable<MindmapNode["type"]>;
  stage: InitialDetailCategory;
  description: string;
  tensorShape?: string;
  notes?: NetworkDiagramNodeNotes;
  sectionNo?: string;
  evidenceIDs: string[];
}

export interface DetailedNetworkGraph {
  rankdir: "TB" | "LR";
  nodes: DetailedNetworkNode[];
  edges: Array<{ source: string; target: string; label?: string }>;
}

export interface NetworkDiagramRepository {
  url: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  commitSHA: string;
  analyzedAt: number;
}

export interface EvidenceReference {
  id: string;
  kind: "code" | "paper";
  label: string;
  path?: string;
  symbols?: string[];
  commitSHA?: string;
  sectionNo?: string;
  reason?: string;
  coverage?: InitialDetailCategory;
}

export interface NetworkDiagramRevision {
  id: string;
  parentID?: string;
  createdAt: number;
  userInstruction: string;
  assistantSummary: string;
  usage?: MessageUsage;
  repository?: NetworkDiagramRepository;
  graph: DetailedNetworkGraph;
  coverage?: NetworkDiagramCoverageItem[];
  evidenceIDs: string[];
  changedNodeIDs: string[];
}

export interface NetworkDiagramMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface NetworkDiagramWorkspace {
  itemKey: string;
  linkedRepositoryURL?: string;
  repository?: NetworkDiagramRepository;
  currentRevisionID?: string;
  latestRevisionID?: string;
  revisions: NetworkDiagramRevision[];
  messages: NetworkDiagramMessage[];
  evidenceIndex: EvidenceReference[];
}

export interface NetworkDiagramReadFileProgress {
  path: string;
  symbols: string[];
  reason: string;
  coverage: InitialDetailCategory;
}

export interface NetworkDiagramToolActivity {
  id: string;
  toolName: string;
  status: "running" | "complete" | "error";
  request: string;
  result?: string;
}

export interface NetworkDiagramAnalysisProgress {
  status:
    | "validating"
    | "scanning"
    | "selecting-code"
    | "model-processing"
    | "reading-paper"
    | "reading-code"
    | "mapping"
    | "validating-detail"
    | "complete"
    | "cancelled"
    | "error";
  currentDetail: string;
  usage?: MessageUsage;
  completedSteps: string[];
  readFiles: NetworkDiagramReadFileProgress[];
  readPaperSections: string[];
  toolActivities?: NetworkDiagramToolActivity[];
  coverage: Record<
    InitialDetailCategory,
    Exclude<InitialDetailCoverageStatus, "not-applicable">
  >;
}

export interface NetworkDiagramAgentResult {
  repository: NetworkDiagramRepository;
  graph: DetailedNetworkGraph;
  coverage: NetworkDiagramCoverageItem[];
  evidence: EvidenceReference[];
  assistantSummary: string;
  usage?: MessageUsage;
  changedNodeIDs: string[];
}

const ORCHESTRATION_NODE_RE =
  /\b(?:dataset|data\s*loader|load\s*\/|augment(?:ation)?|optimizer|metrics?|evaluation|state\s*manager|checkpoint|logger)\b|数据加载|数据增强|优化器|评估(?:器)?|状态管理(?:器)?|日志(?:器)?/i;

export function isNetworkDiagramOrchestrationNode(
  node: DetailedNetworkNode,
): boolean {
  return ORCHESTRATION_NODE_RE.test(node.label);
}

function reachableNodes(
  starts: Iterable<string>,
  edges: DetailedNetworkGraph["edges"],
  reverse = false,
): Set<string> {
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    const source = reverse ? edge.target : edge.source;
    const target = reverse ? edge.source : edge.target;
    const targets = next.get(source) ?? [];
    targets.push(target);
    next.set(source, targets);
  }
  const queue = [...starts];
  const seen = new Set(queue);
  while (queue.length) {
    const id = queue.shift()!;
    for (const target of next.get(id) ?? []) {
      if (seen.has(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return seen;
}

function projectNetworkModelGraph(
  graph: DetailedNetworkGraph,
): DetailedNetworkGraph {
  const hidden = new Set(
    graph.nodes
      .filter(
        (node) =>
          node.stage === "training-path" ||
          node.stage === "parameters-tensors" ||
          (node.stage !== "outputs" && isNetworkDiagramOrchestrationNode(node)),
      )
      .map((node) => node.id),
  );
  const visible = graph.nodes.filter((node) => !hidden.has(node.id));
  const outgoing = new Map<string, DetailedNetworkGraph["edges"]>();
  for (const edge of graph.edges) {
    const edges = outgoing.get(edge.source) ?? [];
    edges.push(edge);
    outgoing.set(edge.source, edges);
  }
  const contractedEdges: DetailedNetworkGraph["edges"] = [];
  const edgeKeys = new Set<string>();
  for (const node of visible) {
    const queue = [...(outgoing.get(node.id) ?? [])];
    const visitedHidden = new Set<string>();
    while (queue.length) {
      const edge = queue.shift()!;
      if (hidden.has(edge.target)) {
        if (visitedHidden.has(edge.target)) continue;
        visitedHidden.add(edge.target);
        queue.push(...(outgoing.get(edge.target) ?? []));
        continue;
      }
      const key = `${node.id}\u0000${edge.target}`;
      if (node.id === edge.target || edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      contractedEdges.push({ source: node.id, target: edge.target });
    }
  }
  const inputIDs = visible
    .filter((node) => node.stage === "inputs-preprocess")
    .map((node) => node.id);
  const outputIDs = visible
    .filter((node) => node.stage === "outputs")
    .map((node) => node.id);
  const fromInput = reachableNodes(inputIDs, contractedEdges);
  const toOutput = reachableNodes(outputIDs, contractedEdges, true);
  const kept = new Set(
    visible
      .filter((node) => fromInput.has(node.id) && toOutput.has(node.id))
      .map((node) => node.id),
  );
  if (!kept.size)
    return { rankdir: "TB", nodes: visible, edges: contractedEdges };
  return {
    rankdir: "TB",
    nodes: visible.filter((node) => kept.has(node.id)),
    edges: contractedEdges.filter(
      (edge) => kept.has(edge.source) && kept.has(edge.target),
    ),
  };
}

function mermaidLabel(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function detailedNetworkGraphToMermaid(graph: DetailedNetworkGraph): string {
  const nodeIDs = new Map(
    graph.nodes.map((node, index) => [node.id, `n${index}`]),
  );
  const compactLabels = new Map(
    graph.nodes.map((node) => [
      node.id,
      [node.label, node.tensorShape].filter(Boolean).join(" · "),
    ]),
  );
  const lines = ["flowchart TB"];
  for (const node of graph.nodes) {
    const id = nodeIDs.get(node.id)!;
    const label = mermaidLabel(compactLabels.get(node.id) ?? node.label);
    if (node.type === "innovation") lines.push(`  ${id}{{"✦ ${label}"}}`);
    else if (node.type === "root" || node.type === "result") {
      lines.push(`  ${id}(["${label}"])`);
    } else lines.push(`  ${id}["${label}"]`);
  }
  for (const edge of graph.edges) {
    const source = nodeIDs.get(edge.source);
    const target = nodeIDs.get(edge.target);
    if (!source || !target) continue;
    const label = edge.label?.trim() ? `|${mermaidLabel(edge.label)}|` : "";
    lines.push(`  ${source} -->${label} ${target}`);
  }
  return lines.join("\n");
}

export function detailedNetworkGraphToMindmap(
  graph: DetailedNetworkGraph,
): MindmapData {
  const modelGraph = projectNetworkModelGraph(graph);
  return {
    rankdir: "TB",
    nodes: modelGraph.nodes.map((node) => ({
      id: node.id,
      label: [node.label, node.tensorShape].filter(Boolean).join(" · "),
      type: node.type,
      sectionNo: node.sectionNo,
    })),
    edges: modelGraph.edges.map((edge) => ({ ...edge })),
    source: detailedNetworkGraphToMermaid(modelGraph),
  };
}

export function currentNetworkDiagramRevision(
  workspace: NetworkDiagramWorkspace | null | undefined,
): NetworkDiagramRevision | undefined {
  if (!workspace?.currentRevisionID) return undefined;
  return workspace.revisions.find(
    (revision) => revision.id === workspace.currentRevisionID,
  );
}
