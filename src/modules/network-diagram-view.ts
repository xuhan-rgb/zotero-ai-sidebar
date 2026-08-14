import {
  currentNetworkDiagramRevision,
  detailedNetworkGraphToMindmap,
  type DetailedNetworkNode,
  type InitialDetailCategory,
  type NetworkDiagramAnalysisProgress,
  type NetworkDiagramWorkspace,
} from "../context/network-diagram-types";
import type { MindmapData } from "../providers/types";
import type { MessageUsage } from "../providers/types";
import { parsePublicGitHubRepositoryURL } from "../context/github-repository";
import { renderMindmapBlock } from "./mindmap-render";

const ATTRIBUTION_LABELS = {
  "paper-contribution": "论文明确贡献",
  "adopted-baseline": "沿用/改造已有方法",
  "standard-module": "标准网络模块",
  "tensor-operation": "张量与几何操作",
  "input-output": "模型输入/输出",
} as const;

export interface NetworkDiagramWorkspaceViewState {
  workspace: NetworkDiagramWorkspace | null;
  progress: NetworkDiagramAnalysisProgress | null;
  busy: boolean;
  error?: string;
  draftRepositoryURL?: string;
  fallbackGraph?: MindmapData;
  targetActive?: boolean;
}

export interface NetworkDiagramWorkspaceViewHandlers {
  onAnalyze(repositoryURL: string): void;
  onCancel?(): void;
  onSaveRepository?(repositoryURL: string): void | Promise<void>;
  onAskNetwork?: (instruction?: string) => void;
  onSelectNode?: (node: DetailedNetworkNode) => void;
  onOptimizeNode?: (node: DetailedNetworkNode) => void;
  onUndo?: () => void;
  onRestoreLatest?: () => void;
}

export interface NetworkDiagramAnalysisCardState {
  progress: NetworkDiagramAnalysisProgress | null;
  busy: boolean;
  error?: string;
}

export interface NetworkDiagramAnalysisCardHandlers {
  onCancel?(): void;
}

function formatTokenUsage(usage: MessageUsage): string {
  const count = (value: number) => Math.trunc(value).toLocaleString("en-US");
  return [
    `Token：输入 ${count(usage.input)}`,
    `输出 ${count(usage.output)}`,
    ...(usage.cacheRead != null ? [`缓存命中 ${count(usage.cacheRead)}`] : []),
    `输入+输出 ${count(usage.input + usage.output)}`,
  ].join(" · ");
}

const COVERAGE_LABELS: Record<InitialDetailCategory, string> = {
  "inputs-preprocess": "输入 / 预处理",
  "backbone-features": "主干 / 特征层级",
  "core-innovations": "核心模块",
  "branches-fusion": "分支 / 融合",
  "inference-path": "推理路径",
  "training-path": "训练监督",
  "parameters-tensors": "参数 / 张量",
  outputs: "输出",
};

function createButton(
  doc: Document,
  className: string,
  label: string,
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  return button;
}

function renderProgress(
  doc: Document,
  progress: NetworkDiagramAnalysisProgress,
): HTMLElement {
  const panel = doc.createElement("div");
  panel.className = "network-diagram-progress";

  const head = doc.createElement("div");
  head.className = "network-diagram-progress-head";
  const title = doc.createElement("strong");
  title.textContent = progress.currentDetail;
  const status = doc.createElement("span");
  status.textContent = progress.status;
  head.append(title, status);
  panel.append(head);

  if (progress.completedSteps.length) {
    const completed = doc.createElement("div");
    completed.className = "network-diagram-completed";
    completed.textContent = progress.completedSteps
      .map((step) => `✓ ${step}`)
      .join(" · ");
    panel.append(completed);
  }

  if (progress.readPaperSections.length) {
    const paper = doc.createElement("div");
    paper.className = "network-diagram-paper-evidence";
    paper.textContent = `论文依据：${progress.readPaperSections.join("、")}`;
    panel.append(paper);
  }

  if (progress.toolActivities?.length) {
    const details = doc.createElement("details");
    details.className = "network-diagram-tool-activities";
    details.open = progress.status !== "complete";
    const summary = doc.createElement("summary");
    summary.textContent = `工具过程 · ${progress.toolActivities.length} 步`;
    const list = doc.createElement("div");
    list.className = "network-diagram-tool-activity-list";
    for (const activity of progress.toolActivities) {
      const row = doc.createElement("div");
      row.className = `network-diagram-tool-activity network-diagram-tool-activity-${activity.status}`;
      const marker = doc.createElement("span");
      marker.className = "network-diagram-tool-activity-marker";
      marker.textContent =
        activity.status === "complete"
          ? "✓"
          : activity.status === "error"
            ? "!"
            : "●";
      const name = doc.createElement("strong");
      name.textContent = activity.toolName;
      const request = doc.createElement("span");
      request.className = "network-diagram-tool-activity-request";
      request.textContent = activity.request;
      row.append(marker, name, request);
      if (activity.result) {
        const result = doc.createElement("span");
        result.className = "network-diagram-tool-activity-result";
        result.textContent = activity.result;
        row.append(result);
      }
      list.append(row);
    }
    details.append(summary, list);
    panel.append(details);
  }

  if (progress.readFiles.length) {
    const details = doc.createElement("details");
    details.className = "network-diagram-file-details";
    details.open =
      progress.status !== "complete" && progress.readFiles.length <= 5;
    const summary = doc.createElement("summary");
    summary.textContent = `已读取 ${progress.readFiles.length} 个 AI 选择的文件`;
    const files = doc.createElement("div");
    files.className = "network-diagram-file-list";
    for (const file of progress.readFiles) {
      const row = doc.createElement("div");
      row.className = "network-diagram-file-row";
      const path = doc.createElement("strong");
      path.textContent = file.path;
      const symbols = file.symbols.length
        ? ` · ${file.symbols.join(", ")}`
        : "";
      const detail = doc.createElement("span");
      detail.textContent = `${symbols} · ${file.reason} · 补全「${COVERAGE_LABELS[file.coverage]}」`;
      row.append(path, detail);
      files.append(row);
    }
    details.append(summary, files);
    panel.append(details);
  }

  const coverage = doc.createElement("div");
  coverage.className = "network-diagram-coverage";
  for (const [category, label] of Object.entries(COVERAGE_LABELS) as Array<
    [InitialDetailCategory, string]
  >) {
    const badge = doc.createElement("span");
    const value = progress.coverage[category];
    badge.className = `network-diagram-coverage-${value}`;
    badge.textContent = `${value === "done" ? "✓ " : ""}${label}`;
    coverage.append(badge);
  }
  panel.append(coverage);

  const usage = doc.createElement("div");
  usage.className = "network-diagram-token-usage";
  usage.textContent = progress.usage
    ? formatTokenUsage(progress.usage)
    : "Token：等待模型返回用量";
  panel.append(usage);
  return panel;
}

export function renderNetworkDiagramAnalysisCard(
  doc: Document,
  state: NetworkDiagramAnalysisCardState,
  handlers: NetworkDiagramAnalysisCardHandlers = {},
): HTMLElement {
  const card = doc.createElement("details");
  card.className = "network-diagram-task-card";
  card.open = state.busy || !!state.error;
  const head = doc.createElement("summary");
  head.className = "network-diagram-task-head";
  const title = doc.createElement("strong");
  title.textContent = state.busy
    ? "📐 正在分析网络图"
    : state.error
      ? "📐 网络图分析失败"
      : "📐 网络图分析结果";
  head.append(title);
  if (state.busy && handlers.onCancel) {
    const stop = createButton(doc, "network-diagram-task-stop", "停止分析");
    stop.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const win = doc.defaultView;
      if (
        win?.confirm(
          "确定停止本次网络图分析吗？已生成的网络图会保留，本次尚未通过校验的结果不会保存。",
        )
      ) {
        handlers.onCancel?.();
      }
    });
    head.append(stop);
  }
  card.append(head);
  if (state.progress) card.append(renderProgress(doc, state.progress));
  if (state.error) {
    const error = doc.createElement("div");
    error.className = "network-diagram-error";
    error.textContent = state.error;
    card.append(error);
  }
  return card;
}

export function renderNetworkDiagramWorkspace(
  doc: Document,
  state: NetworkDiagramWorkspaceViewState,
  handlers: NetworkDiagramWorkspaceViewHandlers,
): HTMLElement {
  const root = doc.createElement("section");
  root.className = "network-diagram-workspace";
  const revision = currentNetworkDiagramRevision(state.workspace);
  const displayedRepository =
    revision?.repository ?? state.workspace?.repository;
  const linkedRepositoryURL =
    state.workspace?.linkedRepositoryURL ?? displayedRepository?.url ?? "";

  const source = doc.createElement("div");
  source.className = "network-diagram-source";
  const editor = doc.createElement("div");
  editor.className = "network-diagram-source-editor";
  editor.hidden = !!displayedRepository;
  const label = doc.createElement("label");
  label.className = "network-diagram-source-label";
  label.textContent = "公开 GitHub 仓库";
  const linkStatus = doc.createElement("span");
  linkStatus.className = "network-diagram-source-link-status";
  linkStatus.textContent = linkedRepositoryURL ? "已关联" : "";
  label.append(linkStatus);
  const inputRow = doc.createElement("div");
  inputRow.className = "network-diagram-source-row";
  const input = doc.createElement("input");
  input.type = "url";
  input.className = "network-diagram-repository-input";
  input.placeholder = "https://github.com/owner/repo";
  input.value = state.draftRepositoryURL ?? linkedRepositoryURL;
  input.disabled = state.busy;
  let saveTimer: number | undefined;
  let compact: HTMLElement | null = null;
  let lastRequestedURL = linkedRepositoryURL;
  const canonicalRepositoryURL = (): string | null => {
    try {
      const { owner, repo } = parsePublicGitHubRepositoryURL(input.value);
      return `https://github.com/${owner}/${repo}`;
    } catch {
      return null;
    }
  };
  const autoSaveRepository = async () => {
    if (state.busy || !handlers.onSaveRepository) return;
    const repositoryURL = canonicalRepositoryURL();
    if (!repositoryURL) {
      linkStatus.textContent = "";
      return;
    }
    if (repositoryURL === linkedRepositoryURL) {
      linkStatus.textContent = "已关联";
      return;
    }
    if (repositoryURL === lastRequestedURL) return;
    lastRequestedURL = repositoryURL;
    linkStatus.textContent = "关联中…";
    try {
      await handlers.onSaveRepository(repositoryURL);
      linkStatus.textContent = "已关联";
    } catch {
      lastRequestedURL = linkedRepositoryURL;
      linkStatus.textContent = "关联失败";
    }
  };
  const scheduleAutoSave = () => {
    if (!handlers.onSaveRepository) return;
    const win = doc.defaultView;
    if (!win) return;
    if (saveTimer !== undefined) win.clearTimeout(saveTimer);
    linkStatus.textContent = "";
    saveTimer = win.setTimeout(() => void autoSaveRepository(), 500);
  };
  input.addEventListener("input", scheduleAutoSave);
  input.addEventListener("blur", () => {
    const win = doc.defaultView;
    if (saveTimer !== undefined && win) win.clearTimeout(saveTimer);
    saveTimer = undefined;
    void autoSaveRepository();
  });
  input.addEventListener("keydown", (rawEvent) => {
    const event = rawEvent as KeyboardEvent;
    if (event.key !== "Enter" || state.busy) return;
    event.preventDefault();
    if (displayedRepository) {
      void autoSaveRepository().then(() => {
        editor.hidden = true;
        if (compact) compact.hidden = false;
      });
      return;
    }
    handlers.onAnalyze(input.value.trim());
  });
  inputRow.append(input);
  if (!displayedRepository) {
    const analyze = createButton(
      doc,
      "network-diagram-analyze",
      state.busy ? "分析中…" : "分析并生成",
    );
    analyze.disabled = state.busy;
    analyze.addEventListener("click", () => {
      handlers.onAnalyze(input.value.trim());
    });
    inputRow.append(analyze);
  }
  if (!displayedRepository) editor.append(label);
  editor.append(inputRow);
  if (displayedRepository) {
    compact = doc.createElement("div");
    compact.className = "network-diagram-source-compact";
    const metadata = doc.createElement("div");
    metadata.className = "network-diagram-source-meta";
    const repositoryName = createButton(
      doc,
      "network-diagram-repository-name",
      `${displayedRepository.owner}/${displayedRepository.repo}`,
    );
    repositoryName.disabled = state.busy;
    repositoryName.title = "修改关联的 GitHub 仓库链接";
    repositoryName.textContent = `${displayedRepository.owner}/${displayedRepository.repo}`;
    repositoryName.addEventListener("click", () => {
      if (!compact) return;
      compact.hidden = true;
      editor.hidden = false;
      input.focus();
      input.select();
    });
    const repositoryMeta = doc.createElement("span");
    repositoryMeta.textContent = `commit ${displayedRepository.commitSHA.slice(0, 12)} · 静态代码分析`;
    metadata.append(repositoryName, repositoryMeta);
    const actions = doc.createElement("div");
    actions.className = "network-diagram-source-actions";
    const ask = createButton(
      doc,
      "network-diagram-ask",
      state.targetActive ? "返回普通对话" : "问网络图",
    );
    ask.disabled = !handlers.onAskNetwork;
    ask.title = "在右侧共用输入框中向当前网络图发送优化指令";
    ask.addEventListener("click", () => handlers.onAskNetwork?.());
    const cancel = createButton(doc, "network-diagram-cancel-source", "取消");
    cancel.addEventListener("click", () => {
      const win = doc.defaultView;
      if (saveTimer !== undefined && win) win.clearTimeout(saveTimer);
      saveTimer = undefined;
      input.value = linkedRepositoryURL;
      linkStatus.textContent = linkedRepositoryURL ? "已关联" : "";
      editor.hidden = true;
      if (compact) compact.hidden = false;
    });
    inputRow.append(cancel);
    actions.append(ask);
    compact.append(metadata, actions);
    source.append(compact);
  }
  source.append(editor);
  if (!displayedRepository || !state.targetActive) root.append(source);

  const displayGraph = revision
    ? detailedNetworkGraphToMindmap(revision.graph)
    : state.fallbackGraph;
  let nodeDetail: HTMLElement | null = null;
  let nodeDetailTitle: HTMLElement | null = null;
  let nodeDetailMeta: HTMLElement | null = null;
  let nodeDetailDescription: HTMLElement | null = null;
  let nodeDetailNotes: HTMLElement | null = null;
  let optimizeNode: HTMLButtonElement | null = null;
  if (displayGraph) {
    const graph = doc.createElement("div");
    graph.className = "network-diagram-graph";
    graph.append(
      renderMindmapBlock(
        doc,
        {
          ...displayGraph,
          title: "网络架构图",
        },
        {
          header: false,
          viewportControls: true,
          focusToggle: false,
          sourceTab: false,
          copyButton: false,
          contextMenuCopy: true,
        },
      ),
    );
    root.append(graph);

    if (revision) {
      nodeDetail = doc.createElement("div");
      nodeDetail.className = "network-diagram-node-detail";
      nodeDetail.hidden = true;
      nodeDetailTitle = doc.createElement("strong");
      nodeDetailMeta = doc.createElement("span");
      nodeDetailDescription = doc.createElement("p");
      nodeDetailDescription.className = "network-diagram-node-summary";
      nodeDetailNotes = doc.createElement("div");
      nodeDetailNotes.className = "network-diagram-node-notes";
      optimizeNode = createButton(
        doc,
        "network-diagram-node-optimize",
        "优化此节点",
      );
      optimizeNode.disabled = state.busy || !handlers.onOptimizeNode;
      nodeDetail.append(
        nodeDetailTitle,
        nodeDetailMeta,
        nodeDetailDescription,
        nodeDetailNotes,
        optimizeNode,
      );
      root.append(nodeDetail);

      const version = doc.createElement("div");
      version.className = "network-diagram-version";
      const summary = doc.createElement("strong");
      summary.textContent = `${revision.id} · ${
        state.workspace?.currentRevisionID === state.workspace?.latestRevisionID
          ? "当前版本"
          : "历史版本"
      }`;
      const evidence = doc.createElement("span");
      evidence.textContent = `${revision.evidenceIDs.length} 条依据`;
      version.append(summary, evidence);
      if (handlers.onUndo) {
        const undo = createButton(doc, "network-diagram-undo", "撤销上一版");
        undo.disabled = !revision.parentID || state.busy;
        undo.addEventListener("click", handlers.onUndo);
        version.append(undo);
      }
      if (handlers.onRestoreLatest) {
        const restore = createButton(
          doc,
          "network-diagram-restore",
          "恢复最新版",
        );
        restore.disabled =
          state.workspace?.currentRevisionID ===
            state.workspace?.latestRevisionID || state.busy;
        restore.addEventListener("click", handlers.onRestoreLatest);
        version.append(restore);
      }
      root.append(version);
    }
  }

  if (revision) {
    root
      .querySelectorAll(".network-diagram-graph .zai-mm-node")
      .forEach((nodeElement: Element) => {
        nodeElement.addEventListener("click", () => {
          root
            .querySelectorAll(".network-diagram-node-selected")
            .forEach((item: Element) =>
              item.classList.remove("network-diagram-node-selected"),
            );
          nodeElement.classList.add("network-diagram-node-selected");
          const nodeID = nodeElement.getAttribute("data-node-id");
          const node = revision?.graph.nodes.find((item) => item.id === nodeID);
          if (!node) return;
          handlers.onSelectNode?.(node);
          if (
            nodeDetail &&
            nodeDetailTitle &&
            nodeDetailMeta &&
            nodeDetailDescription &&
            nodeDetailNotes &&
            optimizeNode
          ) {
            nodeDetail.hidden = false;
            nodeDetailTitle.textContent = node.label;
            nodeDetailMeta.textContent = [
              COVERAGE_LABELS[node.stage],
              node.tensorShape,
              `${node.evidenceIDs.length} 条依据`,
            ]
              .filter(Boolean)
              .join(" · ");
            nodeDetailDescription.textContent = node.description;
            nodeDetailNotes.replaceChildren();
            if (node.notes) {
              const noteRows = [
                ["参数", node.notes.parameters],
                ["数据流", node.notes.dataFlow],
                ["目标 / 监督", node.notes.objective],
                ["方法归属", ATTRIBUTION_LABELS[node.notes.attribution]],
                ["实现依据", node.notes.implementation],
              ] as const;
              for (const [label, value] of noteRows) {
                const row = doc.createElement("div");
                row.className = "network-diagram-node-note-row";
                const term = doc.createElement("strong");
                term.textContent = label;
                const detail = doc.createElement("span");
                detail.textContent = value;
                row.append(term, detail);
                nodeDetailNotes.append(row);
              }
            }
            optimizeNode.onclick = () => handlers.onOptimizeNode?.(node);
          }
        });
      });
  }

  return root;
}
