import { describe, expect, it, vi } from "vitest";
import {
  renderNetworkDiagramAnalysisCard,
  renderNetworkDiagramWorkspace,
} from "../../src/modules/network-diagram-view";
import type { NetworkDiagramWorkspace } from "../../src/context/network-diagram-types";

describe("network diagram workspace view", () => {
  it("renders analysis progress as a right-dialog task card", () => {
    const onCancel = vi.fn();
    const confirm = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    Object.defineProperty(window, "confirm", {
      configurable: true,
      value: confirm,
    });
    const view = renderNetworkDiagramAnalysisCard(
      document,
      {
        busy: true,
        error: undefined,
        progress: {
          status: "model-processing",
          currentDetail: "模型正在处理第 2 轮请求",
          completedSteps: ["固定仓库版本", "扫描代码树"],
          readFiles: [],
          readPaperSections: [],
          toolActivities: [
            {
              id: "tool-1",
              toolName: "arxiv_get_section",
              status: "complete",
              request: "§3 Method",
              result: "读取论文方法正文",
            },
            {
              id: "tool-2",
              toolName: "github_search_code",
              status: "complete",
              request: "WorldModel · models/",
              result: "命中 3 行",
            },
            {
              id: "tool-3",
              toolName: "github_read_range",
              status: "running",
              request: "models/net.py:L20-L80",
            },
          ],
          usage: { input: 12345, output: 678, cacheRead: 9000 },
          coverage: {
            "inputs-preprocess": "partial",
            "backbone-features": "partial",
            "core-innovations": "missing",
            "branches-fusion": "missing",
            "inference-path": "missing",
            "training-path": "missing",
            "parameters-tensors": "missing",
            outputs: "missing",
          },
        },
      },
      { onCancel },
    );

    expect(view.textContent).toContain(
      "Token：输入 12,345 · 输出 678 · 缓存命中 9,000 · 输入+输出 13,023",
    );
    const coverage = view.querySelector(".network-diagram-coverage")!;
    const activities = view.querySelector<HTMLDetailsElement>(
      ".network-diagram-tool-activities",
    )!;
    const usage = view.querySelector(".network-diagram-token-usage")!;
    expect(activities.open).toBe(true);
    expect(activities.querySelector("summary")?.textContent).toBe(
      "工具过程 · 3 步",
    );
    expect(activities.textContent).toContain("arxiv_get_section");
    expect(activities.textContent).toContain("models/net.py:L20-L80");
    expect(
      coverage.compareDocumentPosition(usage) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const stop = view.querySelector<HTMLButtonElement>(
      ".network-diagram-task-stop",
    )!;
    expect(stop.textContent).toBe("停止分析");
    stop.click();
    expect(onCancel).not.toHaveBeenCalled();
    stop.click();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("accepts a GitHub repository before any graph exists", () => {
    vi.useFakeTimers();
    const onAnalyze = vi.fn();
    const onSaveRepository = vi.fn();
    const view = renderNetworkDiagramWorkspace(
      document,
      { workspace: null, progress: null, busy: false },
      { onAnalyze, onSaveRepository },
    );
    const input = view.querySelector<HTMLInputElement>(
      ".network-diagram-repository-input",
    )!;
    input.value = "https://github.com/owner";
    input.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(600);
    expect(onSaveRepository).not.toHaveBeenCalled();

    input.value = "https://github.com/owner/repo";
    input.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(600);
    view.querySelector<HTMLButtonElement>(".network-diagram-analyze")!.click();

    expect(onSaveRepository).toHaveBeenCalledWith(
      "https://github.com/owner/repo",
    );
    expect(onAnalyze).toHaveBeenCalledWith("https://github.com/owner/repo");
    expect(view.textContent).toContain("公开 GitHub 仓库");
    expect(view.querySelector(".network-diagram-empty")).toBeNull();
    expect(view.querySelector(".network-diagram-save-source")).toBeNull();
    vi.useRealTimers();
  });

  it("restores a saved paper repository link without requiring a graph", () => {
    const workspace: NetworkDiagramWorkspace = {
      ...{
        itemKey: "ITEM",
        revisions: [],
        messages: [],
        evidenceIndex: [],
      },
      linkedRepositoryURL: "https://github.com/owner/repo",
    };
    const view = renderNetworkDiagramWorkspace(
      document,
      { workspace, progress: null, busy: false },
      { onAnalyze: vi.fn(), onSaveRepository: vi.fn() },
    );

    expect(
      view.querySelector<HTMLInputElement>(".network-diagram-repository-input")
        ?.value,
    ).toBe("https://github.com/owner/repo");
    expect(
      view.querySelector(".network-diagram-source-link-status")?.textContent,
    ).toBe("已关联");
  });

  it("does not repeat the repository as a standalone link", () => {
    const workspace: NetworkDiagramWorkspace = {
      itemKey: "ITEM",
      linkedRepositoryURL: "https://github.com/owner/repo",
      revisions: [],
      messages: [],
      evidenceIndex: [],
    };
    const linked = renderNetworkDiagramWorkspace(
      document,
      { workspace, progress: null, busy: false },
      { onAnalyze: vi.fn() },
    );

    expect(
      linked.querySelector(".network-diagram-linked-repository"),
    ).toBeNull();

    const unavailable = renderNetworkDiagramWorkspace(
      document,
      { workspace: null, progress: null, busy: false },
      { onAnalyze: vi.fn() },
    );
    expect(
      unavailable.querySelector(".network-diagram-linked-repository"),
    ).toBeNull();
  });

  it("keeps analysis details out of the left network workspace", () => {
    const view = renderNetworkDiagramWorkspace(
      document,
      {
        workspace: null,
        busy: true,
        progress: {
          status: "reading-code",
          currentDetail: "AI 正在选择下一批代码证据",
          completedSteps: ["固定仓库版本", "扫描代码树"],
          readFiles: [
            {
              path: "models/world_model.py",
              symbols: ["WorldModel.forward"],
              reason: "补全推理路径",
              coverage: "inference-path",
            },
          ],
          readPaperSections: ["4.1", "4.2"],
          coverage: {
            "inputs-preprocess": "done",
            "backbone-features": "partial",
            "core-innovations": "partial",
            "branches-fusion": "missing",
            "inference-path": "partial",
            "training-path": "missing",
            "parameters-tensors": "missing",
            outputs: "missing",
          },
        },
      },
      { onAnalyze: vi.fn() },
    );
    expect(view.querySelector(".network-diagram-log")).toBeNull();
    expect(view.querySelector(".network-diagram-progress")).toBeNull();
    expect(view.textContent).not.toContain("WorldModel.forward");
  });

  it("renders the current revision with one ask-network entry point", () => {
    const onAskNetwork = vi.fn();
    const onSelectNode = vi.fn();
    const onOptimizeNode = vi.fn();
    const onAnalyze = vi.fn();
    const workspace: NetworkDiagramWorkspace = {
      itemKey: "ITEM",
      repository: {
        url: "https://github.com/owner/repo",
        owner: "owner",
        repo: "repo",
        defaultBranch: "main",
        commitSHA: "abc123",
        analyzedAt: 1,
      },
      currentRevisionID: "v1",
      latestRevisionID: "v1",
      revisions: [
        {
          id: "v1",
          createdAt: 1,
          userInstruction: "首次生成",
          assistantSummary: "详细 v1",
          usage: { input: 1200, output: 300, cacheRead: 400 },
          graph: {
            rankdir: "TB",
            nodes: [
              {
                id: "input",
                label: "Input",
                type: "root",
                stage: "inputs-preprocess",
                description: "image tensor",
                notes: {
                  parameters: "无；运行期输入",
                  dataFlow: "读取 image [B,3,H,W]",
                  objective: "无直接损失",
                  attribution: "input-output",
                  implementation: "Model.forward(image)",
                },
                evidenceIDs: ["code:1"],
              },
            ],
            edges: [],
          },
          evidenceIDs: ["code:1"],
          changedNodeIDs: ["input"],
        },
      ],
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "详细 v1 已生成",
          createdAt: 2,
        },
      ],
      evidenceIndex: [],
    };
    const view = renderNetworkDiagramWorkspace(
      document,
      { workspace, progress: null, busy: false },
      { onAnalyze, onAskNetwork, onSelectNode, onOptimizeNode },
    );

    expect(view.textContent).not.toContain("详细 v1");
    expect(view.textContent).toContain("v1 · 当前版本");
    expect(view.textContent).toContain("abc123");
    expect(view.querySelector(".zai-mm-svg")).toBeTruthy();
    expect(view.querySelector(".network-diagram-source-compact")).toBeTruthy();
    expect(
      view.querySelector<HTMLElement>(".network-diagram-source-editor")?.hidden,
    ).toBe(true);
    expect(view.querySelector(".network-diagram-regenerate")).toBeNull();
    expect(view.querySelector(".network-diagram-analyze")).toBeNull();
    expect(view.querySelector(".network-diagram-change-source")).toBeNull();
    expect(view.querySelector(".network-diagram-chat")).toBeNull();
    expect(view.querySelector(".network-diagram-source-usage")).toBeNull();
    view.querySelector<HTMLButtonElement>(".network-diagram-ask")!.click();
    expect(onAskNetwork).toHaveBeenCalledTimes(1);
    view
      .querySelector<HTMLButtonElement>(".network-diagram-repository-name")!
      .click();
    expect(
      view.querySelector<HTMLElement>(".network-diagram-source-compact")
        ?.hidden,
    ).toBe(true);
    expect(
      view.querySelector<HTMLElement>(".network-diagram-source-editor")?.hidden,
    ).toBe(false);
    expect(view.querySelector(".network-diagram-source-label")).toBeNull();
    const repositoryInput = view.querySelector<HTMLInputElement>(
      ".network-diagram-repository-input",
    )!;
    repositoryInput.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(onAnalyze).not.toHaveBeenCalled();
    view
      .querySelector<HTMLButtonElement>(".network-diagram-cancel-source")!
      .click();
    expect(
      view.querySelector<HTMLElement>(".network-diagram-source-compact")
        ?.hidden,
    ).toBe(false);
    expect(
      view.querySelector<HTMLElement>(".network-diagram-source-editor")?.hidden,
    ).toBe(true);

    expect(view.querySelector(".mindmap-header")).toBeNull();
    expect(view.querySelector(".mindmap-focus-toggle")).toBeNull();
    expect(view.querySelector(".mindmap-source-tab")).toBeNull();
    expect(view.querySelector(".mindmap-copy-btn")).toBeNull();

    view
      .querySelector<SVGElement>('[data-node-id="input"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(
      view.querySelector(".network-diagram-node-detail")?.textContent,
    ).toContain("image tensor");
    expect(
      view.querySelector(".network-diagram-node-detail")?.textContent,
    ).toContain("参数");
    expect(
      view.querySelector(".network-diagram-node-detail")?.textContent,
    ).toContain("Model.forward(image)");
    expect(onSelectNode).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "input",
        label: "Input",
      }),
    );
    view
      .querySelector<HTMLButtonElement>(".network-diagram-node-optimize")!
      .click();
    expect(onOptimizeNode).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "input", label: "Input" }),
    );
    expect(onAskNetwork).toHaveBeenCalledTimes(1);
    expect(onAnalyze).not.toHaveBeenCalled();
  });

  it("hides repository metadata while the network conversation is targeted", () => {
    const onAskNetwork = vi.fn();
    const workspace: NetworkDiagramWorkspace = {
      itemKey: "ITEM",
      repository: {
        url: "https://github.com/owner/repo",
        owner: "owner",
        repo: "repo",
        defaultBranch: "main",
        commitSHA: "abc123",
        analyzedAt: 1,
      },
      currentRevisionID: "v1",
      latestRevisionID: "v1",
      revisions: [
        {
          id: "v1",
          createdAt: 1,
          userInstruction: "首次生成",
          assistantSummary: "完成",
          graph: { rankdir: "TB", nodes: [], edges: [] },
          evidenceIDs: [],
          changedNodeIDs: [],
        },
      ],
      messages: [],
      evidenceIndex: [],
    };
    const view = renderNetworkDiagramWorkspace(
      document,
      {
        workspace,
        progress: null,
        busy: false,
        targetActive: true,
      },
      { onAnalyze: vi.fn(), onAskNetwork },
    );

    expect(view.querySelector(".network-diagram-source")).toBeNull();
    expect(view.querySelector(".network-diagram-ask")).toBeNull();
    expect(onAskNetwork).not.toHaveBeenCalled();
  });

  it("can reopen the network conversation while analysis is still running", () => {
    const onAskNetwork = vi.fn();
    const workspace: NetworkDiagramWorkspace = {
      itemKey: "ITEM",
      repository: {
        url: "https://github.com/owner/repo",
        owner: "owner",
        repo: "repo",
        defaultBranch: "main",
        commitSHA: "abc123",
        analyzedAt: 1,
      },
      revisions: [],
      messages: [],
      evidenceIndex: [],
    };
    const view = renderNetworkDiagramWorkspace(
      document,
      { workspace, progress: null, busy: true, targetActive: false },
      { onAnalyze: vi.fn(), onAskNetwork },
    );

    const ask = view.querySelector<HTMLButtonElement>(".network-diagram-ask")!;
    expect(ask.disabled).toBe(false);
    ask.click();
    expect(onAskNetwork).toHaveBeenCalledTimes(1);
    expect(view.querySelector(".network-diagram-change-source")).toBeNull();
  });
});
