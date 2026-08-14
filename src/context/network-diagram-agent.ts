import {
  openGitHubRepository,
  type GitHubFetch,
  type GitHubFileEvidence,
  type GitHubFileReadRequest,
} from "./github-repository";
import { DEFAULT_CONTEXT_POLICY } from "./policy";
import type {
  AgentTool,
  Message,
  Provider,
  StreamChunk,
  ToolExecutionResult,
} from "../providers/types";
import type { ModelPreset } from "../settings/types";
import type { ToolSettings } from "../settings/tool-settings";
import {
  isNetworkDiagramOrchestrationNode,
  type DetailedNetworkGraph,
  type DetailedNetworkNode,
  type EvidenceReference,
  type InitialDetailCategory,
  type NetworkDiagramAgentResult,
  type NetworkDiagramAnalysisProgress,
  type NetworkDiagramCoverageItem,
  type NetworkDiagramNodeAttribution,
  type NetworkDiagramRepository,
  type NetworkDiagramToolActivity,
} from "./network-diagram-types";

export const INITIAL_DETAIL_CATEGORIES: InitialDetailCategory[] = [
  "inputs-preprocess",
  "backbone-features",
  "core-innovations",
  "branches-fusion",
  "inference-path",
  "training-path",
  "parameters-tensors",
  "outputs",
];

const CATEGORY_SET = new Set(INITIAL_DETAIL_CATEGORIES);
const VISIBLE_NODE_STAGES: InitialDetailCategory[] = [
  "inputs-preprocess",
  "backbone-features",
  "core-innovations",
  "branches-fusion",
  "inference-path",
  "outputs",
];
const NODE_ATTRIBUTIONS: NetworkDiagramNodeAttribution[] = [
  "paper-contribution",
  "adopted-baseline",
  "standard-module",
  "tensor-operation",
  "input-output",
];
const NODE_ATTRIBUTION_SET = new Set(NODE_ATTRIBUTIONS);
const REQUIRED_NODE_STAGES = new Map<InitialDetailCategory, string>([
  ["inputs-preprocess", "缺少输入与预处理节点"],
  ["backbone-features", "缺少主干与特征层级节点"],
  ["core-innovations", "缺少模型特有的核心计算节点"],
  ["outputs", "缺少输出节点"],
]);
const NOT_APPLICABLE_ALLOWED = new Set<InitialDetailCategory>([
  "branches-fusion",
  "training-path",
  "parameters-tensors",
]);
const PAPER_INDEX_TOOL_NAMES = new Set(["arxiv_list_sections"]);

export interface RunNetworkDiagramAgentOptions {
  repositoryURL: string;
  provider: Provider;
  preset: ModelPreset;
  signal: AbortSignal;
  fetcher?: GitHubFetch;
  paperContext?: string;
  paperEvidence?: EvidenceReference[];
  paperTools?: AgentTool[];
  paperSourceMode?: "latex" | "pdf";
  existingEvidence?: EvidenceReference[];
  conversationContext?: string;
  currentGraph?: DetailedNetworkGraph;
  mode?: "initial" | "refine";
  userInstruction?: string;
  pinnedRepository?: NetworkDiagramRepository;
  toolSettings?: ToolSettings;
  promptCacheKey?: string;
  relayRoutingItemKey?: string | null;
  onProgress?: (progress: NetworkDiagramAnalysisProgress) => void;
}

export interface NetworkDiagramPromptSource {
  repositoryURL: string;
  commitSHA?: string;
  paperTitle?: string;
}

export function buildNetworkDiagramUserPrompt(
  source: NetworkDiagramPromptSource,
): string {
  const repositoryURL = source.repositoryURL.trim() || "当前已关联仓库";
  const commitSHA = source.commitSHA?.trim();
  const paperTitle = source.paperTitle?.trim() || "当前 Zotero 论文";
  return [
    "请生成可核验的详细网络图。",
    "",
    "[本轮数据源]",
    `GitHub：${repositoryURL}`,
    `固定 commit：${commitSHA || "分析开始时由工具锁定，并随结果保存"}`,
    `当前 Zotero 论文：${paperTitle}`,
    "",
    "[五阶段分析契约]",
    "1. Paper specification：按 Parameters → Data flow → Loss / objective 整理论文定义；总览只用于定位，关键模型主张必须继续读取方法正文、公式、图注、训练目标或附录后才能采用。",
    "2. Implementation specification：依次核对 README / config / factory / __init__ / forward / loss / inference，锁定一个真实可执行变体，并追踪关键张量名称与 shape。",
    "3. Reconciliation：区分论文定义与固定 commit 的实际实现；forward 明确执行的边、公式、当前配置和文字描述分级取证，冲突或推断写入备注，不把互斥变体混成一张图。",
    "4. Architecture IR：先建立唯一 nodes / edges / canonical tensor names，再渲染纵向 TB 架构图；标准主干合并，模型特有模块、注意力、跨分支与特征融合展开。",
    "5. Validation：检查参数与模块有据可查、仅用部署输入可执行完整推理、loss 输入可追溯到对应输出，并检查 shape 连续、无重复/悬空节点、训练监督不混入推理主链。",
    "",
    "每个关键节点写输入 shape → 输出 shape，并按 Parameters、Data flow、Loss / objective、方法归属、实现依据记录备注。数值维度无法由论文、配置或代码确认时使用符号维度，不得猜测。",
  ].join("\n");
}

interface SubmittedDiagram {
  graph: DetailedNetworkGraph;
  coverage: NetworkDiagramCoverageItem[];
  assistantSummary: string;
  changedNodeIDs: string[];
}

function emptyCoverage(): NetworkDiagramAnalysisProgress["coverage"] {
  return {
    "inputs-preprocess": "missing",
    "backbone-features": "missing",
    "core-innovations": "missing",
    "branches-fusion": "missing",
    "inference-path": "missing",
    "training-path": "missing",
    "parameters-tensors": "missing",
    outputs: "missing",
  };
}

function cloneProgress(
  progress: NetworkDiagramAnalysisProgress,
): NetworkDiagramAnalysisProgress {
  return {
    ...progress,
    usage: progress.usage ? { ...progress.usage } : undefined,
    completedSteps: [...progress.completedSteps],
    readFiles: progress.readFiles.map((file) => ({
      ...file,
      symbols: [...file.symbols],
    })),
    readPaperSections: [...progress.readPaperSections],
    toolActivities: progress.toolActivities?.map((activity) => ({
      ...activity,
    })),
    coverage: { ...progress.coverage },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function compactToolActivityText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const compact = value.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 160) : fallback;
}

function toolRequestSummary(toolName: string, args: unknown): string {
  const parsed = isRecord(args) ? args : {};
  const stringValue = (key: string): string =>
    typeof parsed[key] === "string" ? String(parsed[key]).trim() : "";
  const scalarValue = (key: string): string => {
    const value = parsed[key];
    return typeof value === "string" || typeof value === "number"
      ? String(value).trim()
      : "";
  };
  switch (toolName) {
    case "github_list_paths": {
      const prefix = stringValue("prefix") || "/";
      const contains = stringValue("contains");
      return compactToolActivityText(
        contains ? `${prefix} · 包含 ${contains}` : prefix,
        "仓库候选路径",
      );
    }
    case "github_search_code": {
      const query = stringValue("query");
      const prefix = stringValue("prefix");
      return compactToolActivityText(
        `${query}${prefix ? ` · ${prefix}` : ""}`,
        "代码内容搜索",
      );
    }
    case "github_outline_file":
      return compactToolActivityText(stringValue("path"), "文件符号大纲");
    case "github_read_range": {
      const path = stringValue("path");
      const start =
        typeof parsed.startLine === "number" ? parsed.startLine : "?";
      const end = typeof parsed.endLine === "number" ? parsed.endLine : "?";
      return compactToolActivityText(
        `${path}:L${start}-L${end}`,
        "精确代码范围",
      );
    }
    case "github_read_files": {
      const paths = Array.isArray(parsed.files)
        ? parsed.files.flatMap((file) =>
            isRecord(file) && typeof file.path === "string" ? [file.path] : [],
          )
        : [];
      return compactToolActivityText(
        paths.length
          ? `${paths.length} 个文件 · ${paths.slice(0, 3).join("、")}`
          : "批量代码证据",
        "批量代码证据",
      );
    }
    case "submit_network_diagram": {
      const graph = isRecord(parsed.graph) ? parsed.graph : {};
      const nodes = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
      const edges = Array.isArray(graph.edges) ? graph.edges.length : 0;
      return `校验候选图 · ${nodes} 节点 / ${edges} 条边`;
    }
    case "arxiv_list_sections":
      return "LaTeX 章节目录";
    case "arxiv_get_section":
      return compactToolActivityText(
        stringValue("sectionNo") ||
          stringValue("section") ||
          stringValue("query") ||
          stringValue("title"),
        "LaTeX 方法章节",
      );
    case "arxiv_get_equation":
      return compactToolActivityText(
        stringValue("label") ||
          stringValue("equation") ||
          scalarValue("number") ||
          stringValue("query"),
        "LaTeX 公式",
      );
    case "arxiv_get_figure":
      return compactToolActivityText(
        stringValue("label") || stringValue("figure") || stringValue("query"),
        "LaTeX 图与图注",
      );
    case "arxiv_get_table":
      return compactToolActivityText(
        stringValue("label") || stringValue("table") || stringValue("query"),
        "LaTeX 表格",
      );
    case "zotero_search_pdf":
      return compactToolActivityText(stringValue("query"), "搜索 PDF");
    case "zotero_read_pdf_range": {
      const start = scalarValue("start") || scalarValue("startPage");
      const end = scalarValue("end") || scalarValue("endPage");
      return compactToolActivityText(
        start || end ? `${start || "?"}-${end || "?"}` : "PDF 精确范围",
        "PDF 精确范围",
      );
    }
    default: {
      const firstScalar = Object.values(parsed).find(
        (value) => typeof value === "string" || typeof value === "number",
      );
      return compactToolActivityText(firstScalar, "按需读取");
    }
  }
}

function category(value: unknown): InitialDetailCategory | null {
  return typeof value === "string" &&
    CATEGORY_SET.has(value as InitialDetailCategory)
    ? (value as InitialDetailCategory)
    : null;
}

function isShapeTransition(value: string | undefined): boolean {
  return !!value && /(?:→|->|=>)/.test(value);
}

function requiredIncomingSources(node: DetailedNetworkNode): number {
  if (!node.tensorShape) return 0;
  const inputSide = node.tensorShape.split(/(?:→|->|=>)/, 1)[0];
  const inputs = inputSide
    .split("+")
    .map((value) => value.trim())
    .filter(Boolean);
  if (inputs.length < 2) return inputs.length;
  const explanation = [
    node.description,
    node.notes?.parameters,
    node.notes?.dataFlow,
    node.notes?.implementation,
  ]
    .filter(Boolean)
    .join(" ");
  const learnedQuery =
    /(?:\bQ\b|\bquery\b|查询)[^\n。；;]{0,60}(?:learned|learnable|parameter|可学习|参数)|(?:learned|learnable|parameter|可学习|参数)[^\n。；;]{0,60}(?:\bQ\b|\bquery\b|查询)/i.test(
      explanation,
    );
  return inputs.filter(
    (input) => !(learnedQuery && /(?:\bQ\b|\bquery\b|查询)/i.test(input)),
  ).length;
}

function isAttentionNode(node: DetailedNetworkNode): boolean {
  return /attention|attn|注意力/i.test(`${node.label} ${node.description}`);
}

function normalizeNodeNotes(
  value: unknown,
): DetailedNetworkNode["notes"] | undefined {
  if (!isRecord(value)) return undefined;
  const attribution =
    typeof value.attribution === "string" &&
    NODE_ATTRIBUTION_SET.has(value.attribution as NetworkDiagramNodeAttribution)
      ? (value.attribution as NetworkDiagramNodeAttribution)
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
    parameters: value.parameters.trim(),
    dataFlow: value.dataFlow.trim(),
    objective: value.objective.trim(),
    attribution,
    implementation: value.implementation.trim(),
  };
}

function namesAttentionSources(description: string): boolean {
  const hasQuery = /(?:\bQ\b|\bquery\b|查询)/i.test(description);
  const hasKeyValue =
    /(?:\bK\s*\/\s*V\b|\bkey(?:s)?\b[^\n。；;]{0,60}\bvalue(?:s)?\b|键[^\n。；;]{0,20}值)/i.test(
      description,
    );
  return hasQuery && hasKeyValue;
}

function normalizeGraph(value: unknown): DetailedNetworkGraph | null {
  if (!isRecord(value) || !Array.isArray(value.nodes)) return null;
  const nodes: DetailedNetworkNode[] = [];
  for (const rawNode of value.nodes) {
    if (!isRecord(rawNode)) continue;
    const stage = category(rawNode.stage);
    if (
      typeof rawNode.id !== "string" ||
      typeof rawNode.label !== "string" ||
      !stage
    ) {
      continue;
    }
    const requestedType = [
      "root",
      "section",
      "point",
      "result",
      "innovation",
    ].includes(String(rawNode.type))
      ? (rawNode.type as DetailedNetworkNode["type"])
      : "point";
    const notes = normalizeNodeNotes(rawNode.notes);
    const type =
      requestedType === "root" || requestedType === "result"
        ? requestedType
        : notes?.attribution === "paper-contribution"
          ? "innovation"
          : requestedType === "innovation"
            ? "point"
            : requestedType;
    nodes.push({
      id: rawNode.id.trim(),
      label: rawNode.label.trim(),
      type,
      stage,
      description:
        typeof rawNode.description === "string"
          ? rawNode.description.trim()
          : "",
      tensorShape:
        typeof rawNode.tensorShape === "string" && rawNode.tensorShape.trim()
          ? rawNode.tensorShape.trim()
          : undefined,
      notes,
      sectionNo:
        typeof rawNode.sectionNo === "string" && rawNode.sectionNo.trim()
          ? rawNode.sectionNo.trim()
          : undefined,
      evidenceIDs: stringArray(rawNode.evidenceIDs),
    });
  }
  const edges = Array.isArray(value.edges)
    ? value.edges.flatMap((rawEdge) => {
        if (
          !isRecord(rawEdge) ||
          typeof rawEdge.source !== "string" ||
          typeof rawEdge.target !== "string"
        ) {
          return [];
        }
        return [
          {
            source: rawEdge.source.trim(),
            target: rawEdge.target.trim(),
            label:
              typeof rawEdge.label === "string" && rawEdge.label.trim()
                ? rawEdge.label.trim()
                : undefined,
          },
        ];
      })
    : [];
  return { rankdir: "TB", nodes, edges };
}

function normalizeCoverage(value: unknown): NetworkDiagramCoverageItem[] {
  if (!Array.isArray(value)) return [];
  const coverage: NetworkDiagramCoverageItem[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const resolvedCategory = category(raw.category);
    const status = ["missing", "partial", "done", "not-applicable"].includes(
      String(raw.status),
    )
      ? (raw.status as NetworkDiagramCoverageItem["status"])
      : null;
    if (!resolvedCategory || !status) continue;
    coverage.push({
      category: resolvedCategory,
      status,
      summary: typeof raw.summary === "string" ? raw.summary.trim() : "",
      evidenceIDs: stringArray(raw.evidenceIDs),
    });
  }
  return coverage;
}

function canonicalizeSubmittedEvidenceIDs(
  graph: DetailedNetworkGraph,
  coverage: NetworkDiagramCoverageItem[],
  evidence: EvidenceReference[],
): void {
  const codeEvidenceByPath = new Map(
    evidence.flatMap((item) =>
      item.kind === "code" && item.path ? [[item.path, item.id]] : [],
    ),
  );
  const canonicalize = (id: string): string => {
    if (!id.startsWith("code:")) return id;
    const separator = id.indexOf(":", "code:".length);
    if (separator < 0) return id;
    const path = id.slice(separator + 1);
    return codeEvidenceByPath.get(path) ?? id;
  };
  for (const node of graph.nodes) {
    node.evidenceIDs = node.evidenceIDs.map(canonicalize);
  }
  for (const item of coverage) {
    item.evidenceIDs = item.evidenceIDs.map(canonicalize);
  }
}

function hasDirectedPath(
  graph: DetailedNetworkGraph,
  starts: Set<string>,
  targets: Set<string>,
): boolean {
  const next = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = next.get(edge.source) ?? [];
    list.push(edge.target);
    next.set(edge.source, list);
  }
  const queue = [...starts];
  const seen = new Set(queue);
  while (queue.length) {
    const id = queue.shift()!;
    if (targets.has(id)) return true;
    for (const candidate of next.get(id) ?? []) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      queue.push(candidate);
    }
  }
  return false;
}

function directedReachable(
  graph: DetailedNetworkGraph,
  starts: Set<string>,
  reverse = false,
): Set<string> {
  const next = new Map<string, string[]>();
  for (const edge of graph.edges) {
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

function hasDirectedCycle(graph: DetailedNetworkGraph): boolean {
  const next = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const targets = next.get(edge.source) ?? [];
    targets.push(edge.target);
    next.set(edge.source, targets);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const target of next.get(id) ?? []) {
      if (visit(target)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return graph.nodes.some((node) => visit(node.id));
}

function inputShapeSide(value: string): string {
  return value.split(/(?:→|->|=>)/, 1)[0];
}

function outputShapeSide(value: string): string {
  const parts = value.split(/(?:→|->|=>)/);
  return parts[parts.length - 1];
}

function containsCanonicalTensorName(value: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(^|[^\\p{L}\\p{N}_])${escaped}([^\\p{L}\\p{N}_]|$)`,
    "iu",
  ).test(value);
}

export function validateDetailedNetworkGraph(
  graph: DetailedNetworkGraph,
  coverage: NetworkDiagramCoverageItem[],
  knownEvidenceIDs: Set<string>,
  evidenceByID?: ReadonlyMap<string, EvidenceReference>,
  pinnedCommitSHA?: string,
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const labels = new Map<string, string>();
  const incomingSources = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    const sources = incomingSources.get(edge.target) ?? new Set<string>();
    sources.add(edge.source);
    incomingSources.set(edge.target, sources);
  }
  for (const node of graph.nodes) {
    if (!node.id || !node.label) errors.push("网络节点必须包含 id 和 label");
    if (ids.has(node.id)) errors.push(`节点 id 重复：${node.id}`);
    ids.add(node.id);
    const normalizedLabel = node.label
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
    if (normalizedLabel && labels.has(normalizedLabel)) {
      errors.push(`节点名称重复：${node.label.trim()}`);
    } else if (normalizedLabel) {
      labels.set(normalizedLabel, node.id);
    }
    if (isNetworkDiagramOrchestrationNode(node)) {
      errors.push(`节点 ${node.id} 属于数据或运行编排，不应出现在模型网络图中`);
    }
    if (node.stage === "training-path" || node.stage === "parameters-tensors") {
      errors.push(
        `节点 ${node.id} 属于训练监督或参数说明，应保留为依据而不是模型拓扑节点`,
      );
    }
    if (!node.tensorShape?.trim()) {
      errors.push(`节点 ${node.id} 缺少张量 shape`);
    } else if (node.type === "root" && isShapeTransition(node.tensorShape)) {
      errors.push(
        `输入节点 ${node.id} 只能声明原始输入名称和 shape，不能包含变换`,
      );
    } else if (
      node.type !== "root" &&
      !(
        node.stage === "inputs-preprocess" &&
        (incomingSources.get(node.id)?.size ?? 0) === 0
      ) &&
      !isShapeTransition(node.tensorShape)
    ) {
      errors.push(`节点 ${node.id} 需要标出输入 shape → 输出 shape`);
    }
    if (!node.description) errors.push(`节点 ${node.id} 缺少作用说明`);
    if (node.notes) {
      for (const [key, value] of Object.entries(node.notes)) {
        if (!value) errors.push(`节点 ${node.id} 的备注字段 ${key} 不能为空`);
      }
      if (
        node.type === "innovation" &&
        node.notes.attribution !== "paper-contribution"
      ) {
        errors.push(`节点 ${node.id} 不是论文明确贡献，不应标记为 innovation`);
      }
      if (
        node.notes.attribution === "paper-contribution" &&
        node.type !== "innovation"
      ) {
        errors.push(`节点 ${node.id} 是论文贡献，应使用 innovation 类型`);
      }
    }
    for (const evidenceID of node.evidenceIDs) {
      if (!knownEvidenceIDs.has(evidenceID)) {
        errors.push(`节点 ${node.id} 引用了未知依据 ${evidenceID}`);
      }
      if (evidenceID.startsWith("code:") && pinnedCommitSHA) {
        const reference = evidenceByID?.get(evidenceID);
        if (
          !reference?.path ||
          !reference.commitSHA ||
          reference.commitSHA !== pinnedCommitSHA
        ) {
          errors.push(
            `节点 ${node.id} 的代码依据不属于当前固定 commit：${evidenceID}`,
          );
        }
      }
    }
    if (!node.evidenceIDs.some((id) => id.startsWith("code:"))) {
      errors.push(`节点 ${node.id} 缺少固定 commit 的代码依据`);
    }
  }
  const edgeKeys = new Set<string>();
  for (const edge of graph.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      errors.push(`连线 ${edge.source} → ${edge.target} 引用了未知节点`);
    }
    const edgeKey = `${edge.source}\u0000${edge.target}`;
    if (edgeKeys.has(edgeKey)) {
      errors.push(`连线重复：${edge.source} → ${edge.target}`);
    }
    edgeKeys.add(edgeKey);
    const source = graph.nodes.find((node) => node.id === edge.source);
    const target = graph.nodes.find((node) => node.id === edge.target);
    const tensor = edge.label?.trim();
    if (tensor && source?.tensorShape && target?.tensorShape) {
      if (
        !containsCanonicalTensorName(
          outputShapeSide(source.tensorShape),
          tensor,
        )
      ) {
        errors.push(
          `连线 ${edge.source} → ${edge.target} 的张量 ${tensor} 未出现在源节点输出中`,
        );
      }
      if (
        !containsCanonicalTensorName(inputShapeSide(target.tensorShape), tensor)
      ) {
        errors.push(
          `连线 ${edge.source} → ${edge.target} 的张量 ${tensor} 未出现在目标节点输入中`,
        );
      }
    }
  }
  if (hasDirectedCycle(graph)) errors.push("网络图不能包含环路");

  for (const node of graph.nodes) {
    const requiredInputs = requiredIncomingSources(node);
    const actualInputs = incomingSources.get(node.id)?.size ?? 0;
    const isFeatureFusion =
      (node.stage === "branches-fusion" || node.stage === "core-innovations") &&
      /fusion|fuse|融合|concat|concatenat|拼接|weighted|加权/i.test(
        `${node.label} ${node.description}`,
      ) &&
      !/coordinate|pixel grid|depth (?:bin|sample)|位置网格|像素网格|坐标生成|深度(?:分箱|采样)/i.test(
        `${node.label} ${node.description}`,
      );
    if (
      node.type !== "root" &&
      isFeatureFusion &&
      requiredInputs >= 2 &&
      actualInputs < requiredInputs
    ) {
      errors.push(
        `节点 ${node.id} 声明多输入融合，但只有 ${actualInputs} 条输入连线`,
      );
    }
    const attentionExplanation = [
      node.description,
      node.notes?.dataFlow,
      node.notes?.implementation,
    ]
      .filter(Boolean)
      .join(" ");
    if (isAttentionNode(node) && !namesAttentionSources(attentionExplanation)) {
      errors.push(`注意力节点 ${node.id} 必须在作用说明中明确 Q 与 K/V 的来源`);
    }
  }

  for (const [stage, message] of REQUIRED_NODE_STAGES) {
    if (!graph.nodes.some((node) => node.stage === stage)) errors.push(message);
  }
  const innovationNodes = graph.nodes.filter(
    (node) => node.stage === "core-innovations" && node.type === "innovation",
  );
  for (const node of innovationNodes) {
    if (!node.evidenceIDs.some((id) => id.startsWith("code:"))) {
      errors.push(`核心创新节点 ${node.id} 缺少固定 commit 的代码依据`);
    }
    if (!node.evidenceIDs.some((id) => id.startsWith("paper:tool:"))) {
      errors.push(`核心创新节点 ${node.id} 缺少已读取的论文正文依据`);
    }
  }

  const inputIDs = new Set(
    graph.nodes
      .filter((node) => node.stage === "inputs-preprocess")
      .map((node) => node.id),
  );
  const outputIDs = new Set(
    graph.nodes
      .filter((node) => node.stage === "outputs")
      .map((node) => node.id),
  );
  if (!hasDirectedPath(graph, inputIDs, outputIDs)) {
    errors.push("缺少从输入到输出的完整推理路径");
  }
  const fromInput = directedReachable(graph, inputIDs);
  const toOutput = directedReachable(graph, outputIDs, true);
  for (const node of graph.nodes) {
    if (!fromInput.has(node.id) || !toOutput.has(node.id)) {
      errors.push(`节点 ${node.id} 不在输入到输出的模型前向路径上`);
    }
  }

  const coverageByCategory = new Map(
    coverage.map((item) => [item.category, item]),
  );
  for (const requiredCategory of INITIAL_DETAIL_CATEGORIES) {
    const item = coverageByCategory.get(requiredCategory);
    if (!item) {
      errors.push(`缺少细节覆盖声明：${requiredCategory}`);
      continue;
    }
    if (item.status === "missing" || item.status === "partial") {
      errors.push(`细节尚未完成：${requiredCategory}`);
    }
    if (
      item.status === "not-applicable" &&
      !NOT_APPLICABLE_ALLOWED.has(requiredCategory)
    ) {
      errors.push(`细节类别不能标记为不适用：${requiredCategory}`);
    }
    if (!item.summary) errors.push(`细节覆盖缺少说明：${requiredCategory}`);
    for (const evidenceID of item.evidenceIDs) {
      if (!knownEvidenceIDs.has(evidenceID)) {
        errors.push(`细节覆盖引用了未知依据：${evidenceID}`);
      }
    }
  }

  for (const stage of ["branches-fusion"] as const) {
    if (
      coverageByCategory.get(stage)?.status === "done" &&
      !graph.nodes.some((node) => node.stage === stage)
    ) {
      errors.push(`标记 ${stage} 已完成，但图中没有对应节点`);
    }
  }
  if (
    coverageByCategory.get("parameters-tensors")?.status === "done" &&
    !graph.nodes.some((node) => node.tensorShape)
  ) {
    errors.push("参数/张量标记已完成，但没有任何可核对的参数或形状");
  }
  return Array.from(new Set(errors));
}

function toolSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function formatTreeManifest(
  paths: string[],
  budget = DEFAULT_CONTEXT_POLICY.githubTreeManifestCharBudget,
): string {
  const lines: string[] = [];
  let chars = 0;
  for (const path of paths) {
    if (chars + path.length + 2 > budget) break;
    lines.push(path);
    chars += path.length + 1;
  }
  const omitted = paths.length - lines.length;
  return `${lines.join("\n")}${
    omitted > 0
      ? `\n…另有 ${omitted} 条候选路径，请使用 github_list_paths 按目录或名称继续检查。`
      : ""
  }`;
}

function progressStatusForChunk(
  chunk: StreamChunk,
): NetworkDiagramAnalysisProgress["status"] | null {
  if (chunk.type === "status") return "model-processing";
  return null;
}

function compatibleRelayNeedsInlineContract(preset: ModelPreset): boolean {
  if (preset.provider !== "openai") return false;
  const baseURL = preset.baseUrl.trim();
  if (!baseURL) return false;
  try {
    return new URL(baseURL).hostname !== "api.openai.com";
  } catch {
    return true;
  }
}

export function validateRefinementContinuity(
  current: DetailedNetworkGraph,
  candidate: DetailedNetworkGraph,
): string[] {
  const genericID =
    /^(?:input|inputs|output|outputs|root|result|prediction|predictions)$/i;
  const currentIDs = new Set(
    current.nodes.map((node) => node.id).filter((id) => !genericID.test(id)),
  );
  const candidateIDs = new Set(
    candidate.nodes.map((node) => node.id).filter((id) => !genericID.test(id)),
  );
  const comparableCount = Math.min(currentIDs.size, candidateIDs.size);
  const requiredIDs =
    comparableCount === 0
      ? 0
      : comparableCount === 1
        ? 1
        : Math.min(3, Math.max(2, Math.ceil(comparableCount * 0.25)));
  const sharedIDs = [...candidateIDs].filter((id) => currentIDs.has(id));

  const currentCodeEvidence = new Set(
    current.nodes.flatMap((node) =>
      node.evidenceIDs.filter((id) => id.startsWith("code:")),
    ),
  );
  const sharedEvidence = candidate.nodes.some((node) =>
    node.evidenceIDs.some((id) => currentCodeEvidence.has(id)),
  );
  const errors: string[] = [];
  if (sharedIDs.length < requiredIDs) {
    errors.push(
      `精修候选仅保留 ${sharedIDs.length} 个当前语义节点 id，至少需要 ${requiredIDs} 个；请复用未改变节点的 id，避免切换模型身份`,
    );
  }
  if (currentCodeEvidence.size > 0 && !sharedEvidence) {
    errors.push(
      "精修候选没有保留任何当前模型的代码依据；请先沿当前入口继续追踪，避免切换到仓库中的其他模型族",
    );
  }
  return errors;
}

export function refinementAnchorReadError(
  unreadAnchorPaths: ReadonlySet<string>,
  requestedPaths: string[],
  hasReadTargetAnchor = false,
): string | null {
  if (hasReadTargetAnchor || unreadAnchorPaths.size === 0) return null;
  if (requestedPaths.some((path) => unreadAnchorPaths.has(path))) return null;
  return `Refine mode must read the current target code anchors before unrelated paths:\n${[...unreadAnchorPaths].join("\n")}`;
}

async function runNetworkDiagramAgentInner(
  options: RunNetworkDiagramAgentOptions,
): Promise<NetworkDiagramAgentResult> {
  const mode = options.mode ?? "initial";
  const progress: NetworkDiagramAnalysisProgress = {
    status: "validating",
    currentDetail: "正在校验公开 GitHub 仓库链接",
    completedSteps: [],
    readFiles: [],
    readPaperSections: (options.paperEvidence ?? [])
      .map((item) => item.sectionNo)
      .filter((value): value is string => !!value),
    toolActivities: [],
    coverage: emptyCoverage(),
  };
  const emit = (
    status: NetworkDiagramAnalysisProgress["status"],
    detail: string,
  ) => {
    progress.status = status;
    progress.currentDetail = detail;
    options.onProgress?.(cloneProgress(progress));
  };
  emit("validating", progress.currentDetail);

  const pinned = options.pinnedRepository;
  const repository = await openGitHubRepository(options.repositoryURL, {
    fetcher: options.fetcher,
    commitSHA: pinned?.commitSHA,
    defaultBranch: pinned?.defaultBranch,
  });
  progress.completedSteps.push("固定仓库版本");
  emit(
    "scanning",
    `已固定 ${repository.reference.commitSHA.slice(0, 12)}，${repository.contentSource === "local-snapshot" ? "已使用本地源码快照" : "本地快照不可用，使用固定 commit 远程只读回退"}；扫描到 ${repository.files.length} 个文件、${repository.candidates.length} 个源码候选`,
  );
  progress.completedSteps.push("扫描代码树");

  const evidence: EvidenceReference[] = [];
  for (const item of [
    ...(options.existingEvidence ?? []),
    ...(options.paperEvidence ?? []),
  ]) {
    if (!evidence.some((existing) => existing.id === item.id))
      evidence.push(item);
  }
  if (
    options.paperContext?.trim() &&
    !evidence.some((item) => item.kind === "paper")
  ) {
    evidence.push({
      id: "paper:overview-method-context",
      kind: "paper",
      label: "当前总览的方法章节上下文",
    });
  }
  const knownEvidenceIDs = new Set(evidence.map((item) => item.id));
  let paperEvidenceSequence = 0;
  const availablePaperTools = (options.paperTools ?? []).filter((tool) => {
    if (options.paperSourceMode === "latex")
      return tool.name.startsWith("arxiv_");
    if (options.paperSourceMode === "pdf")
      return tool.name.startsWith("zotero_");
    return true;
  });
  const paperTools = availablePaperTools.map((paperTool) => ({
    ...paperTool,
    description: PAPER_INDEX_TOOL_NAMES.has(paperTool.name)
      ? `${paperTool.description} This is a paper index tool for locating substantive sections. Its output is not claim evidence; follow it with a section, range, equation, figure, or table retrieval.`
      : `${paperTool.description} This is a paper-evidence tool: use it to verify the paper specification, not to infer repository implementation.`,
    execute: async (args: unknown) => {
      const isIndexTool = PAPER_INDEX_TOOL_NAMES.has(paperTool.name);
      emit(
        "reading-paper",
        isIndexTool
          ? `正在读取论文索引：${paperTool.name}`
          : `正在读取论文证据：${paperTool.name}`,
      );
      const result = await paperTool.execute(args);
      if (result.isError) return result;
      if (isIndexTool) {
        emit("reading-paper", `已读取论文索引：${result.summary}`);
        return result;
      }
      const evidenceID = `paper:tool:${paperTool.name}:${Date.now().toString(36)}-${++paperEvidenceSequence}`;
      const reference: EvidenceReference = {
        id: evidenceID,
        kind: "paper",
        label: result.summary?.trim() || paperTool.name,
        reason: `由 ${paperTool.name} 按需读取`,
      };
      evidence.push(reference);
      knownEvidenceIDs.add(evidenceID);
      progress.readPaperSections.push(reference.label);
      emit("reading-paper", `已读取论文证据：${reference.label}`);
      return {
        ...result,
        output: `[Paper evidence ID: ${evidenceID}]\n${result.output}`,
      };
    },
  }));
  const submission: { value: SubmittedDiagram | null } = { value: null };
  const currentEvidenceIDs = new Set(
    options.currentGraph?.nodes.flatMap((node) => node.evidenceIDs) ?? [],
  );
  const currentTargetPaths = [
    ...new Set(
      evidence
        .filter(
          (item) =>
            item.kind === "code" &&
            !!item.path &&
            currentEvidenceIDs.has(item.id),
        )
        .map((item) => item.path as string),
    ),
  ];
  const unreadTargetAnchors = new Set(
    mode === "refine" ? currentTargetPaths : [],
  );
  const currentTargetPathSet = new Set(currentTargetPaths);
  let hasReadTargetAnchor =
    mode !== "refine" || currentTargetPaths.length === 0;
  const codeEvidenceReadThisRun = new Set<string>();
  const navigationCache = new Map<
    string,
    { toolName: string; summary: string }
  >();

  const reusedNavigationOutput = (
    key: string,
    toolName: string,
  ): ToolExecutionResult | null => {
    const cached = navigationCache.get(key);
    if (!cached) return null;
    return {
      output: JSON.stringify({
        reusedNavigation: {
          tool: toolName,
          summary: cached.summary,
        },
        instruction: "Reuse the earlier navigation result from tool history.",
      }),
      summary: `复用导航结果：${cached.summary}`,
    };
  };

  const rememberNavigation = (
    key: string,
    toolName: string,
    summary: string,
  ): void => {
    navigationCache.set(key, { toolName, summary });
  };

  const evidenceIDForRequest = (request: GitHubFileReadRequest): string => {
    const path = request.path.trim().replace(/^\/+/, "");
    return typeof request.startLine === "number" &&
      typeof request.endLine === "number"
      ? `code:${repository.reference.commitSHA}:${path}:L${Math.floor(request.startLine)}-L${Math.floor(request.endLine)}`
      : `code:${repository.reference.commitSHA}:${path}`;
  };

  const reusedEvidenceOutput = (evidenceIDs: string[]): string =>
    JSON.stringify({
      reusedEvidenceIDs: evidenceIDs,
      instruction: "Reuse these existing evidence IDs; do not read them again.",
    });

  const listPathsTool: AgentTool = {
    name: "github_list_paths",
    description:
      "Inspect real candidate paths from the pinned commit tree. Use prefix and/or contains to discover exact files before reading them. This never reads file contents.",
    parameters: toolSchema({
      prefix: { type: "string" },
      contains: { type: "string" },
    }),
    execute: async (args) => {
      if (!hasReadTargetAnchor) {
        return {
          output: `Rejected: read these current target code anchors with github_read_range or github_read_files before searching elsewhere:\n${[...unreadTargetAnchors].join("\n")}`,
          summary: "请先读取当前模型的代码锚点",
        };
      }
      const parsed = isRecord(args) ? args : {};
      const prefix = typeof parsed.prefix === "string" ? parsed.prefix : "";
      const contains =
        typeof parsed.contains === "string" ? parsed.contains : "";
      const cacheKey = `list:${prefix.trim()}:${contains.trim()}`;
      const reused = reusedNavigationOutput(cacheKey, "github_list_paths");
      if (reused) return reused;
      const paths = repository.listCandidatePaths(contains, prefix);
      emit(
        "selecting-code",
        `AI 正在检查候选路径：${prefix || "/"}${contains ? ` · 包含 ${contains}` : ""}`,
      );
      const summary = `列出 GitHub 候选路径 ${paths.length} 条`;
      rememberNavigation(cacheKey, "github_list_paths", summary);
      return {
        output: formatTreeManifest(paths),
        summary,
      };
    },
  };

  const searchCodeTool: AgentTool = {
    name: "github_search_code",
    description:
      "Search code text in candidate files from the pinned commit, like a bounded case-insensitive `rg -n -F`. Returns only matching paths, line numbers, and matching lines. This is navigation output, not graph evidence. Narrow with prefix and repeat when truncated.",
    parameters: toolSchema(
      {
        query: { type: "string" },
        prefix: { type: "string" },
        maxMatches: { type: "number" },
      },
      ["query"],
    ),
    execute: async (args) => {
      if (!hasReadTargetAnchor) {
        return {
          output: `Rejected: read these current target code anchors with github_read_range or github_read_files before searching elsewhere:\n${[...unreadTargetAnchors].join("\n")}`,
          summary: "请先读取当前模型的代码锚点",
        };
      }
      const parsed = isRecord(args) ? args : {};
      const query = typeof parsed.query === "string" ? parsed.query : "";
      const prefix = typeof parsed.prefix === "string" ? parsed.prefix : "";
      const maxMatches =
        typeof parsed.maxMatches === "number" ? parsed.maxMatches : 40;
      const cacheKey = `search:${query.trim().toLowerCase()}:${prefix.trim()}:${Math.floor(maxMatches)}`;
      const reused = reusedNavigationOutput(cacheKey, "github_search_code");
      if (reused) return reused;
      const result = await repository.searchCode(query, prefix, maxMatches);
      emit(
        "selecting-code",
        `AI 正在搜索代码：${query}${prefix ? ` · ${prefix}` : ""}`,
      );
      const summary = `搜索 GitHub 代码，命中 ${result.matches.length} 行`;
      rememberNavigation(cacheKey, "github_search_code", summary);
      return {
        output: JSON.stringify(result, null, 2),
        summary,
      };
    },
  };

  const outlineFileTool: AgentTool = {
    name: "github_outline_file",
    description:
      "Inspect one pinned-commit file as a compact symbol outline, like ctags plus declaration search. Returns imports, classes, functions/methods, types, and suggested line ranges without returning function bodies. This is navigation output, not graph evidence.",
    parameters: toolSchema(
      {
        path: { type: "string" },
      },
      ["path"],
    ),
    execute: async (args) => {
      const parsed = isRecord(args) ? args : {};
      if (typeof parsed.path !== "string" || !parsed.path.trim()) {
        return {
          output: "Rejected: path must be a non-empty pinned-tree path.",
          summary: "GitHub 文件大纲路径无效",
        };
      }
      const cacheKey = `outline:${parsed.path.trim().replace(/^\/+/, "")}`;
      const reused = reusedNavigationOutput(cacheKey, "github_outline_file");
      if (reused) return reused;
      const outline = await repository.outlineFile(parsed.path);
      emit("selecting-code", `AI 正在查看文件符号大纲：${outline.path}`);
      const summary = `读取 ${outline.path} 的符号大纲 ${outline.entries.length} 项`;
      rememberNavigation(cacheKey, "github_outline_file", summary);
      return {
        output: JSON.stringify(outline, null, 2),
        summary,
      };
    },
  };

  const registerCodeEvidence = (files: GitHubFileEvidence[]): void => {
    for (const file of files) {
      if (currentTargetPathSet.has(file.path)) hasReadTargetAnchor = true;
      unreadTargetAnchors.delete(file.path);
      const selectors = file.symbols.length
        ? file.symbols
        : typeof file.startLine === "number" && typeof file.endLine === "number"
          ? [`L${file.startLine}-${file.endLine}`]
          : [];
      progress.readFiles.push({
        path: file.path,
        symbols: selectors,
        reason: file.reason,
        coverage: file.coverage,
      });
      progress.coverage[file.coverage] = "partial";
      const reference: EvidenceReference = {
        id: file.evidenceID,
        kind: "code",
        label: file.path,
        path: file.path,
        symbols: selectors,
        commitSHA: repository.reference.commitSHA,
        reason: file.reason,
        coverage: file.coverage,
      };
      const existing = evidence.findIndex((item) => item.id === reference.id);
      if (existing >= 0) evidence[existing] = reference;
      else evidence.push(reference);
      knownEvidenceIDs.add(reference.id);
      codeEvidenceReadThisRun.add(reference.id);
    }
    emit(
      "reading-code",
      `已读取 ${progress.readFiles.length} 个 AI 选择的文件`,
    );
  };

  const formatCodeEvidence = (
    files: GitHubFileEvidence[],
    reusedEvidenceIDs: string[] = [],
    readErrors: Array<{ path: string; error: string }> = [],
  ): string =>
    JSON.stringify(
      {
        repository: repository.reference,
        remainingAnalysisChars: repository.remainingAnalysisChars(),
        files: files.map((file) => ({
          evidenceID: file.evidenceID,
          path: file.path,
          symbols: file.symbols,
          startLine: file.startLine,
          endLine: file.endLine,
          reason: file.reason,
          coverage: file.coverage,
          chars: file.chars,
          truncated: file.truncated,
          text: file.text,
        })),
        ...(reusedEvidenceIDs.length ? { reusedEvidenceIDs } : {}),
        ...(readErrors.length ? { readErrors } : {}),
      },
      null,
      2,
    );

  const readRangeTool: AgentTool = {
    name: "github_read_range",
    description: `Read one exact inclusive line range from a pinned-commit file, like \`sed -n START,ENDp\`. The span must be at most ${DEFAULT_CONTEXT_POLICY.githubMaxRangeLines} lines. Requires path, startLine, endLine, reason, and coverage. The returned evidence is eligible for graph nodes. Never request the same path and range twice; reuse its evidence ID.`,
    parameters: toolSchema(
      {
        path: { type: "string" },
        startLine: { type: "number" },
        endLine: { type: "number" },
        reason: { type: "string" },
        coverage: {
          type: "string",
          enum: INITIAL_DETAIL_CATEGORIES,
        },
      },
      ["path", "startLine", "endLine", "reason", "coverage"],
    ),
    execute: async (args) => {
      const parsed = isRecord(args) ? args : {};
      const resolvedCategory = category(parsed.coverage);
      if (
        typeof parsed.path !== "string" ||
        typeof parsed.startLine !== "number" ||
        typeof parsed.endLine !== "number" ||
        typeof parsed.reason !== "string" ||
        !resolvedCategory
      ) {
        return {
          output:
            "Rejected: path, startLine, endLine, reason and a valid coverage category are required.",
          summary: "GitHub 精确行范围参数无效",
        };
      }
      const request: GitHubFileReadRequest = {
        path: parsed.path,
        startLine: parsed.startLine,
        endLine: parsed.endLine,
        reason: parsed.reason,
        coverage: resolvedCategory,
      };
      const requestedEvidenceID = evidenceIDForRequest(request);
      if (codeEvidenceReadThisRun.has(requestedEvidenceID)) {
        return {
          output: reusedEvidenceOutput([requestedEvidenceID]),
          summary: `复用已读取代码证据 ${request.path}:${request.startLine}-${request.endLine}`,
        };
      }
      const anchorError = refinementAnchorReadError(
        unreadTargetAnchors,
        [request.path],
        hasReadTargetAnchor,
      );
      if (anchorError) {
        return {
          output: `Rejected: ${anchorError}`,
          summary: "请先读取当前模型的代码锚点",
        };
      }
      emit(
        "reading-code",
        `AI 正在精确读取 ${request.path}:${request.startLine}-${request.endLine}`,
      );
      const files = await repository.readFiles([request]);
      registerCodeEvidence(files);
      return {
        output: formatCodeEvidence(files),
        summary: `读取 GitHub 精确代码范围 ${request.path}:${request.startLine}-${request.endLine}`,
      };
    },
  };

  const readFilesTool: AgentTool = {
    name: "github_read_files",
    description: `Batch-read AI-selected evidence from the pinned commit. Every source file requires an exact line range found through search/outline, and each range must span at most ${DEFAULT_CONTEXT_POLICY.githubMaxRangeLines} lines. Split a longer symbol into consecutive ranges inside this same batch call. Only small config/document files may be read whole. Never request a broad source file or repeat an exact path/range already read. Every item requires a reason and coverage category.`,
    parameters: toolSchema(
      {
        files: {
          type: "array",
          items: toolSchema(
            {
              path: { type: "string" },
              startLine: { type: "number" },
              endLine: { type: "number" },
              reason: { type: "string" },
              coverage: {
                type: "string",
                enum: INITIAL_DETAIL_CATEGORIES,
              },
            },
            ["path", "reason", "coverage"],
          ),
        },
      },
      ["files"],
    ),
    execute: async (args) => {
      const parsed = isRecord(args) ? args : {};
      if (!Array.isArray(parsed.files) || !parsed.files.length) {
        return {
          output: "Rejected: files must be a non-empty array.",
          summary: "GitHub 文件选择无效",
        };
      }
      const requests = parsed.files.flatMap((raw) => {
        if (!isRecord(raw)) return [];
        const resolvedCategory = category(raw.coverage);
        if (
          typeof raw.path !== "string" ||
          typeof raw.reason !== "string" ||
          !resolvedCategory
        ) {
          return [];
        }
        return [
          {
            path: raw.path,
            startLine:
              typeof raw.startLine === "number" ? raw.startLine : undefined,
            endLine: typeof raw.endLine === "number" ? raw.endLine : undefined,
            reason: raw.reason,
            coverage: resolvedCategory,
          },
        ];
      });
      if (requests.length !== parsed.files.length) {
        return {
          output:
            "Rejected: every file needs path, reason and a valid coverage category.",
          summary: "GitHub 文件选择缺少理由或类别",
        };
      }
      const anchorError = refinementAnchorReadError(
        unreadTargetAnchors,
        requests.map((request) => request.path),
        hasReadTargetAnchor,
      );
      if (anchorError) {
        return {
          output: `Rejected: ${anchorError}`,
          summary: "请先读取当前模型的代码锚点",
        };
      }
      const seenEvidenceIDs = new Set(codeEvidenceReadThisRun);
      const reusedEvidenceIDs: string[] = [];
      const unreadRequests = requests.filter((request) => {
        const evidenceID = evidenceIDForRequest(request);
        if (seenEvidenceIDs.has(evidenceID)) {
          reusedEvidenceIDs.push(evidenceID);
          return false;
        }
        seenEvidenceIDs.add(evidenceID);
        return true;
      });
      if (!unreadRequests.length) {
        return {
          output: reusedEvidenceOutput(reusedEvidenceIDs),
          summary: `复用 ${reusedEvidenceIDs.length} 条已读取代码证据`,
        };
      }
      emit(
        "selecting-code",
        `AI 选择了 ${unreadRequests.length} 个新范围，正在核对路径、符号和选择理由`,
      );
      const files: GitHubFileEvidence[] = [];
      const readErrors: Array<{ path: string; error: string }> = [];
      for (const request of unreadRequests) {
        try {
          files.push(...(await repository.readFiles([request])));
        } catch (error) {
          readErrors.push({
            path: request.path,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (files.length) registerCodeEvidence(files);
      return {
        output: formatCodeEvidence(files, reusedEvidenceIDs, readErrors),
        summary: readErrors.length
          ? `读取 ${files.length} 条代码证据，${readErrors.length} 个范围需修正`
          : `读取 GitHub 代码证据 ${files.length} 个文件`,
        isError: files.length === 0 && readErrors.length > 0,
      };
    },
  };

  const submitTool: AgentTool = {
    name: "submit_network_diagram",
    description:
      "Submit one complete detailed network diagram candidate. This is atomic: a sparse or unsupported candidate is rejected and never replaces the current graph. Call only after checking all eight detail categories.",
    parameters: toolSchema(
      {
        assistantSummary: { type: "string" },
        changedNodeIDs: { type: "array", items: { type: "string" } },
        graph: toolSchema(
          {
            rankdir: { type: "string", enum: ["TB"] },
            nodes: {
              type: "array",
              items: toolSchema(
                {
                  id: { type: "string" },
                  label: { type: "string" },
                  type: {
                    type: "string",
                    enum: ["root", "section", "point", "result", "innovation"],
                    description:
                      "Use root only for an actual zero-indegree forward input tensor; learned parameters are not nodes.",
                  },
                  stage: {
                    type: "string",
                    enum: VISIBLE_NODE_STAGES,
                    description:
                      "Visible forward-computation role only. Training supervision and parameter evidence belong in coverage, never in graph nodes.",
                  },
                  description: { type: "string" },
                  tensorShape: {
                    type: "string",
                    description:
                      "Source input: `name [shape]`. Every other node: `named input shape(s) → named output shape` using the literal →.",
                  },
                  notes: toolSchema(
                    {
                      parameters: { type: "string" },
                      dataFlow: { type: "string" },
                      objective: { type: "string" },
                      attribution: {
                        type: "string",
                        enum: NODE_ATTRIBUTIONS,
                      },
                      implementation: { type: "string" },
                    },
                    [
                      "parameters",
                      "dataFlow",
                      "objective",
                      "attribution",
                      "implementation",
                    ],
                  ),
                  sectionNo: { type: "string" },
                  evidenceIDs: {
                    type: "array",
                    items: { type: "string" },
                    description:
                      "Exact evidenceID strings copied from github_read_range/github_read_files or supplied paper evidence.",
                  },
                },
                [
                  "id",
                  "label",
                  "type",
                  "stage",
                  "description",
                  "tensorShape",
                  "notes",
                  "evidenceIDs",
                ],
              ),
            },
            edges: {
              type: "array",
              items: toolSchema(
                {
                  source: { type: "string" },
                  target: { type: "string" },
                  label: {
                    type: "string",
                    description:
                      "One canonical tensor name that occurs verbatim in the source output and target input tensorShape.",
                  },
                },
                ["source", "target", "label"],
              ),
            },
          },
          ["rankdir", "nodes", "edges"],
        ),
        coverage: {
          type: "array",
          items: toolSchema(
            {
              category: {
                type: "string",
                enum: INITIAL_DETAIL_CATEGORIES,
              },
              status: {
                type: "string",
                enum: ["done", "not-applicable"],
              },
              summary: { type: "string" },
              evidenceIDs: { type: "array", items: { type: "string" } },
            },
            ["category", "status", "summary", "evidenceIDs"],
          ),
        },
      },
      ["assistantSummary", "graph", "coverage"],
    ),
    execute: async (args) => {
      emit("validating-detail", "正在检查八类初始细节门槛和代码依据");
      const parsed = isRecord(args) ? args : {};
      const graph = normalizeGraph(parsed.graph);
      const coverage = normalizeCoverage(parsed.coverage);
      if (!graph) {
        return {
          output: "Rejected: graph is missing or invalid.",
          summary: "网络图候选无效，保留当前图",
        };
      }
      const protocolErrors = [
        ...graph.nodes
          .filter((node) => !node.notes)
          .map((node) => `节点 ${node.id} 缺少结构化备注`),
        ...graph.edges
          .filter((edge) => !edge.label?.trim())
          .map(
            (edge) => `连线 ${edge.source} → ${edge.target} 缺少传递张量名称`,
          ),
      ];
      if (protocolErrors.length) {
        const detail = protocolErrors.join("；");
        emit("validating-detail", `候选图尚未通过：${detail}`);
        return {
          output: `Rejected: ${detail}`,
          summary: "节点备注或张量连线不完整，保留当前图",
        };
      }
      canonicalizeSubmittedEvidenceIDs(graph, coverage, evidence);
      const errors = validateDetailedNetworkGraph(
        graph,
        coverage,
        knownEvidenceIDs,
        new Map(evidence.map((item) => [item.id, item])),
        repository.reference.commitSHA,
      );
      if (mode === "refine" && options.currentGraph) {
        errors.unshift(
          ...validateRefinementContinuity(options.currentGraph, graph),
        );
      }
      if (errors.length) {
        for (const item of coverage) {
          progress.coverage[item.category] =
            item.status === "done" || item.status === "not-applicable"
              ? "done"
              : item.status;
        }
        emit(
          "validating-detail",
          `候选图尚未通过：${errors.slice(0, 3).join("；")}`,
        );
        return {
          output: `Rejected; keep the current graph and continue evidence collection:\n- ${errors.join("\n- ")}`,
          summary: "详细度不足，未发布半成品",
        };
      }
      for (const item of coverage) progress.coverage[item.category] = "done";
      submission.value = {
        graph,
        coverage,
        assistantSummary:
          typeof parsed.assistantSummary === "string" &&
          parsed.assistantSummary.trim()
            ? parsed.assistantSummary.trim()
            : "网络图已通过详细度校验",
        changedNodeIDs:
          stringArray(parsed.changedNodeIDs).length > 0
            ? stringArray(parsed.changedNodeIDs)
            : graph.nodes.map((node) => node.id),
      };
      emit("complete", "详细网络图已通过八类门槛，正在原子保存");
      return {
        output:
          "[Network diagram accepted] Detailed candidate passed all gates.",
        summary: "详细网络图已通过校验",
      };
    },
  };

  let toolActivitySequence = 0;
  const trackTool = (tool: AgentTool): AgentTool => ({
    ...tool,
    execute: async (args: unknown) => {
      const activity: NetworkDiagramToolActivity = {
        id: `tool-${++toolActivitySequence}`,
        toolName: tool.name,
        status: "running",
        request: toolRequestSummary(tool.name, args),
      };
      progress.toolActivities?.push(activity);
      options.onProgress?.(cloneProgress(progress));
      try {
        const result = await tool.execute(args);
        activity.status =
          result.isError || /^\s*Rejected\b/i.test(result.output)
            ? "error"
            : "complete";
        activity.result = compactToolActivityText(
          result.summary,
          activity.status === "error" ? "调用未通过" : "调用完成",
        );
        options.onProgress?.(cloneProgress(progress));
        return result;
      } catch (error) {
        activity.status = "error";
        activity.result = compactToolActivityText(
          error instanceof Error ? error.message : String(error),
          "工具调用失败",
        );
        options.onProgress?.(cloneProgress(progress));
        throw error;
      }
    },
  });
  const tools = [
    ...paperTools,
    listPathsTool,
    searchCodeTool,
    outlineFileTool,
    readRangeTool,
    readFilesTool,
    submitTool,
  ].map(trackTool);
  const candidatePaths = repository.candidates.map((file) => file.path);
  const manifest = formatTreeManifest(
    [
      ...currentTargetPaths.filter((path) => candidatePaths.includes(path)),
      ...candidatePaths.filter((path) => !currentTargetPaths.includes(path)),
    ],
    DEFAULT_CONTEXT_POLICY.githubPromptTreeManifestCharBudget,
  );
  const currentGraph = options.currentGraph
    ? JSON.stringify(options.currentGraph)
    : "none";
  const systemPrompt = [
    "You are the dedicated network-diagram agent inside Zotero.",
    "The harness pinned one PUBLIC GitHub commit and exposes read-only tools. Static analysis is not runtime tracing: never invent shapes, layers, losses, branches, or calls. Choose evidence by symbol/range and give path, reason, and missing coverage; completion depends on eight coverage categories, never file count.",
    "Resolve target identity from the paper/request, selected config, model entry and reachable forward. Repositories can contain several unrelated model families; exclude unlinked baselines. Bind the graph to one concrete executable variant and never union mutually exclusive paths.",
    "Evidence workflow: Paper specification → Implementation specification → Reconciliation → Architecture IR → Validation. Use paper retrieval tools for Parameters → Data flow → Loss / objective and attribution; use fixed-commit forward/config for executable edges/shapes and loss code for objectives. Keep paper claims and implementation distinct, label uncertainty, then simulate inference and tensor continuity before submission.",
    options.paperSourceMode === "latex"
      ? "Paper source policy: LaTeX source is available, so use only arxiv_list_sections, arxiv_get_section, arxiv_get_equation, arxiv_get_figure, and arxiv_get_table for paper evidence. Read an important architecture figure with arxiv_get_figure when it can clarify module grouping, branches, or author intent. Treat the figure as auxiliary semantic evidence and cross-check every executable edge and tensor shape against the pinned code."
      : options.paperSourceMode === "pdf"
        ? "Paper source policy: LaTeX source is unavailable, so fall back to targeted PDF search and exact PDF ranges before any whole-paper retrieval. Do not claim visual figure evidence unless a tool actually returns an image."
        : "Paper source policy: use the available targeted paper tools before whole-paper retrieval, and keep any unresolved formula or figure structure explicitly uncertain.",
    "Paper context is an index, not claim evidence. Retrieve targeted method text/equations/figures; use whole-paper retrieval only as fallback.",
    "Refinement identity-continuity contract: preserve unchanged node ids and current code evidence. First read at least one exact path from Current target code anchors, then follow its imports/calls; do not require every anchor before targeted search.",
    "Universal model roles: source tensors/conditions; shape transforms; standard encoder/backbone or embedding; adapters; model-specific representation; interaction/fusion/routing; prediction head/decoder/selection; outputs. Draw only evidenced roles and only forward-time computation. Exclude datasets, augmentation, training/runtime managers, optimizer/loss aggregation, metrics, logging, wrappers and titles from topology.",
    "Graph contract: rankdir=TB; compact DAG; each semantic concept is one node exactly once. Use one main inference spine with adjacent branches. Never duplicate downstream nodes, edges, cycles, transitive shortcuts or aliases. Every visible node lies on an input-to-output path; sources are actual forward tensors, not parameters or model wrappers.",
    "Granularity: collapse a generic CNN or standard backbone such as ResNet18 into one topology node; keep proven rank transforms/adapters adjacent. Expand model-specific blocks and multi-input feature fusion, including alignment/projection, attention/gating, concat/add, normalization and output projection when evidenced.",
    "Tensor contract: each source is `name [shape]`; every other node states input shape(s) → output shape with canonical tensor names. Use symbolic dimensions when needed, never guessed numbers. Every forward-time side input is a separate source. Show meaningful reshape, unsqueeze, squeeze, flatten, repeat, permute, concat, split, mask/index and mode selection. Attention notes identify Q, K, and V origins/shapes.",
    "Each edge label is one canonical tensor name present verbatim in source output and target input; multi-input nodes need all real incoming edges. Short labels only. Node notes follow Parameters → Data flow → Objective / supervision → Attribution → Implementation evidence, using `none` where inapplicable.",
    "Attribution: paper-contribution requires both targeted paper evidence and fixed-commit code evidence and uses innovation; otherwise use adopted-baseline, standard-module, tensor-operation, or input-output conservatively. Code proves execution, not authorship. End at semantic predictions, not evaluation metrics.",
    "Codex-style tools: github_list_paths=`rg --files`; github_search_code=bounded `rg -n -F`; github_outline_file=symbol outline; github_read_range=one exact range; github_read_files=parallel exact ranges/small config. Search/outline are navigation, never evidence. Locate symbols before reading; never fall back to the full source file. Batch independent reads, reuse prior navigation and evidence IDs, and copy returned evidenceID strings exactly.",
    `Each source range is at most ${DEFAULT_CONTEXT_POLICY.githubMaxRangeLines} lines. Use submit_network_diagram only for one complete atomic candidate after all eight categories are done/not-applicable; if rejected, fix only the reported gaps.`,
    `Mode: ${mode}`,
    `Pinned repository: ${JSON.stringify(repository.reference)}`,
    `User instruction: ${options.userInstruction?.trim() || "生成一次可用的详细网络图 v1"}`,
    `Paper context: ${(options.paperContext ?? "none").slice(0, DEFAULT_CONTEXT_POLICY.outlineCharBudget)}`,
    `Independent diagram conversation: ${(options.conversationContext ?? "none").slice(0, DEFAULT_CONTEXT_POLICY.retainedContextCharBudget)}`,
    `Known evidence index (metadata only): ${JSON.stringify(evidence)}`,
    `Current target code anchors: ${currentTargetPaths.length ? currentTargetPaths.join("\n") : "none"}`,
    `Current graph: ${currentGraph}`,
    `Candidate path manifest:\n${manifest}`,
  ].join("\n\n");
  const taskInstruction =
    options.userInstruction?.trim() ||
    "分析固定 commit 的实现，并一次生成通过八类细节门槛的网络图。";
  const messages: Message[] = [
    {
      role: "user",
      content: compatibleRelayNeedsInlineContract(options.preset)
        ? [
            "[Network diagram task]",
            "Follow the system instructions and use only the supplied read-only tools. Analyze the pinned fixed commit; use paper evidence for authorship and exact code ranges for executable edges. Search/outline are navigation only. Submit one complete validated TB graph through submit_network_diagram.",
            `Pinned fixed commit: ${repository.reference.owner}/${repository.reference.repo}@${repository.reference.commitSHA}`,
            `User instruction: ${taskInstruction}`,
          ].join("\n\n")
        : taskInstruction,
    },
  ];
  let modelText = "";
  for await (const chunk of options.provider.stream(
    messages,
    systemPrompt,
    options.preset,
    options.signal,
    {
      tools,
      parallelToolCalls: true,
      maxToolIterations: DEFAULT_CONTEXT_POLICY.githubMaxToolIterations,
      permissionMode: "default",
      toolSettings: options.toolSettings,
      promptCacheKey: options.promptCacheKey,
      relayRoutingItemKey: options.relayRoutingItemKey,
    },
  )) {
    if (chunk.type === "text_delta") modelText += chunk.text;
    if (chunk.type === "error") throw new Error(chunk.message);
    if (chunk.type === "usage") {
      const previous = progress.usage;
      progress.usage = {
        input: (previous?.input ?? 0) + chunk.input,
        output: (previous?.output ?? 0) + chunk.output,
        ...((previous?.cacheRead != null || chunk.cacheRead != null) && {
          cacheRead: (previous?.cacheRead ?? 0) + (chunk.cacheRead ?? 0),
        }),
      };
      options.onProgress?.(cloneProgress(progress));
    }
    const nextStatus = progressStatusForChunk(chunk);
    if (nextStatus && !submission.value) {
      emit(
        nextStatus,
        chunk.type === "status"
          ? chunk.message
          : "AI 正在建立论文概念、代码符号与网络节点映射",
      );
    }
  }
  if (!submission.value) {
    emit("error", "证据不足或候选图未通过细节门槛；已保留当前网络图");
    throw new Error("AI 没有提交通过八类细节门槛的网络图；当前图未被覆盖。");
  }
  const repositoryResult: NetworkDiagramRepository = {
    ...repository.reference,
    analyzedAt: Date.now(),
  };
  const submitted = submission.value;
  return {
    repository: repositoryResult,
    graph: submitted.graph,
    coverage: submitted.coverage,
    evidence,
    assistantSummary: submitted.assistantSummary || modelText.trim(),
    usage: progress.usage ? { ...progress.usage } : undefined,
    changedNodeIDs: submitted.changedNodeIDs,
  };
}

export async function runNetworkDiagramAgent(
  options: RunNetworkDiagramAgentOptions,
): Promise<NetworkDiagramAgentResult> {
  const controller = new AbortController();
  let timedOut = false;
  let callerCancelled = false;
  let rejectCancellation: ((reason: Error) => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  const abortFromCaller = () => {
    callerCancelled = true;
    controller.abort();
    rejectCancellation?.(new Error("网络图分析已由用户停止。"));
  };
  if (options.signal.aborted) controller.abort();
  else
    options.signal.addEventListener("abort", abortFromCaller, { once: true });
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error("GitHub 网络图分析超过时间预算，当前图未被覆盖。"));
    }, DEFAULT_CONTEXT_POLICY.githubAnalysisTimeoutMs);
  });
  const sourceFetcher =
    options.fetcher ??
    ((input: string, init?: RequestInit) => globalThis.fetch(input, init));
  const fetcher: GitHubFetch = (input, init) =>
    sourceFetcher(input, { ...init, signal: controller.signal });
  try {
    return await Promise.race([
      runNetworkDiagramAgentInner({
        ...options,
        signal: controller.signal,
        fetcher,
      }),
      deadline,
      cancellation,
    ]);
  } catch (error) {
    if (callerCancelled) {
      throw new Error("网络图分析已由用户停止。");
    }
    if (timedOut) {
      throw new Error("GitHub 网络图分析超过时间预算，当前图未被覆盖。");
    }
    throw error;
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout);
    options.signal.removeEventListener("abort", abortFromCaller);
  }
}
