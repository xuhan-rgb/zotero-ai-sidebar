import { describe, expect, it, vi } from "vitest";
import type {
  AgentTool,
  Provider,
  ProviderStreamOptions,
} from "../../src/providers/types";
import type { ModelPreset } from "../../src/settings/types";
import {
  buildNetworkDiagramUserPrompt,
  INITIAL_DETAIL_CATEGORIES,
  refinementAnchorReadError,
  runNetworkDiagramAgent,
  validateDetailedNetworkGraph,
  validateRefinementContinuity,
} from "../../src/context/network-diagram-agent";
import { DEFAULT_CONTEXT_POLICY } from "../../src/context/policy";
import type { NetworkDiagramAnalysisProgress } from "../../src/context/network-diagram-types";

const preset: ModelPreset = {
  id: "p",
  label: "P",
  provider: "openai",
  apiKey: "key",
  baseUrl: "",
  model: "model",
  maxTokens: 4096,
};

function repositoryFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (url.endsWith("/repos/owner/repo")) {
    return Promise.resolve(
      new Response(JSON.stringify({ default_branch: "main" }), { status: 200 }),
    );
  }
  if (url.endsWith("/commits/main")) {
    return Promise.resolve(
      new Response(JSON.stringify({ sha: "commit" }), { status: 200 }),
    );
  }
  if (url.includes("/git/trees/commit")) {
    return Promise.resolve(
      new Response(
        JSON.stringify({
          truncated: false,
          tree: [
            { path: "models/net.py", type: "blob", sha: "b1", size: 100 },
            { path: "configs/net.yaml", type: "blob", sha: "b2", size: 100 },
          ],
        }),
        { status: 200 },
      ),
    );
  }
  if (url.endsWith("/models/net.py")) {
    return Promise.resolve(
      new Response("class WorldModel:\n  def forward(self, x): return x", {
        status: 200,
      }),
    );
  }
  if (url.endsWith("/configs/net.yaml")) {
    return Promise.resolve(
      new Response("layers: 6\nheads: 8", { status: 200 }),
    );
  }
  return Promise.resolve(new Response("not found", { status: 404 }));
}

function tool(
  options: ProviderStreamOptions | undefined,
  name: string,
): AgentTool {
  const found = options?.tools?.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

describe("network diagram agent", () => {
  it("builds a visible source-aware five-stage generation prompt", () => {
    const prompt = buildNetworkDiagramUserPrompt({
      repositoryURL: "https://github.com/owner/repo",
      commitSHA: "0123456789abcdef",
      paperTitle: "A General Paper",
    });

    expect(prompt).toContain("GitHub：https://github.com/owner/repo");
    expect(prompt).toContain("固定 commit：0123456789abcdef");
    expect(prompt).toContain("当前 Zotero 论文：A General Paper");
    expect(prompt).toContain("1. Paper specification");
    expect(prompt).toContain("Parameters → Data flow → Loss / objective");
    expect(prompt).toContain("2. Implementation specification");
    expect(prompt).toContain(
      "README / config / factory / __init__ / forward / loss / inference",
    );
    expect(prompt).toContain("3. Reconciliation");
    expect(prompt).toContain("4. Architecture IR");
    expect(prompt).toContain("5. Validation");
    expect(prompt).not.toContain("GraspNet");
    expect(prompt).not.toContain("LAW");
  });

  it("accumulates token usage from every model round", async () => {
    const snapshots: NetworkDiagramAnalysisProgress[] = [];
    const provider: Provider = {
      async *stream() {
        yield { type: "usage", input: 100, output: 20, cacheRead: 40 };
        yield { type: "usage", input: 250, output: 35, cacheRead: 180 };
        yield { type: "error", message: "stop after usage" };
      },
    };

    await expect(
      runNetworkDiagramAgent({
        repositoryURL: "https://github.com/owner/repo",
        provider,
        preset,
        signal: new AbortController().signal,
        fetcher: repositoryFetch,
        onProgress: (progress) => snapshots.push(progress),
      }),
    ).rejects.toThrow("stop after usage");

    expect(snapshots.at(-1)?.usage).toEqual({
      input: 350,
      output: 55,
      cacheRead: 220,
    });
  });

  it("does not register failed paper retrieval as evidence", async () => {
    let paperToolOutput = "";
    const snapshots: NetworkDiagramAnalysisProgress[] = [];
    const provider: Provider = {
      async *stream(_messages, _system, _preset, _signal, options) {
        paperToolOutput = (
          await tool(options, "zotero_search_pdf").execute({ query: "method" })
        ).output;
        yield { type: "error", message: "stop after paper check" };
      },
    };

    await expect(
      runNetworkDiagramAgent({
        repositoryURL: "https://github.com/owner/repo",
        provider,
        preset,
        signal: new AbortController().signal,
        fetcher: repositoryFetch,
        paperTools: [
          {
            name: "zotero_search_pdf",
            description: "Search paper",
            parameters: { type: "object", properties: {} },
            async execute() {
              return {
                output: "No readable PDF text is available.",
                summary: "No readable PDF text is available.",
                isError: true,
              };
            },
          },
        ],
        onProgress: (progress) => snapshots.push(progress),
      }),
    ).rejects.toThrow("stop after paper check");

    expect(paperToolOutput).toBe("No readable PDF text is available.");
    expect(paperToolOutput).not.toContain("Paper evidence ID");
    expect(snapshots.at(-1)?.toolActivities).toEqual([
      expect.objectContaining({
        toolName: "zotero_search_pdf",
        status: "error",
        request: "method",
        result: "No readable PDF text is available.",
      }),
    ]);
  });

  it("exposes Codex-style search, outline and precise range tools", async () => {
    let searchOutput = "";
    let outlineOutput = "";
    let rangeOutput = "";
    const snapshots: NetworkDiagramAnalysisProgress[] = [];
    const provider: Provider = {
      async *stream(_messages, system, _preset, _signal, options) {
        expect(system).toContain("github_search_code");
        expect(system).toContain("github_outline_file");
        expect(system).toContain("github_read_range");
        expect(system).toContain("never fall back to the full source file");
        searchOutput = (
          await tool(options, "github_search_code").execute({
            query: "WorldModel",
            prefix: "models/",
            maxMatches: 10,
          })
        ).output;
        const repeatedSearchOutput = (
          await tool(options, "github_search_code").execute({
            query: "WorldModel",
            prefix: "models/",
            maxMatches: 10,
          })
        ).output;
        expect(repeatedSearchOutput).toContain("reusedNavigation");
        expect(repeatedSearchOutput.length).toBeLessThan(240);
        outlineOutput = (
          await tool(options, "github_outline_file").execute({
            path: "models/net.py",
          })
        ).output;
        rangeOutput = (
          await tool(options, "github_read_range").execute({
            path: "models/net.py",
            startLine: 1,
            endLine: 2,
            reason: "确认模型入口",
            coverage: "inference-path",
          })
        ).output;
        yield { type: "error", message: "stop after code discovery check" };
      },
    };

    await expect(
      runNetworkDiagramAgent({
        repositoryURL: "https://github.com/owner/repo",
        provider,
        preset,
        signal: new AbortController().signal,
        fetcher: repositoryFetch,
        onProgress: (progress) => snapshots.push(progress),
      }),
    ).rejects.toThrow("stop after code discovery check");

    expect(searchOutput).toContain('"line": 1');
    expect(searchOutput).toContain("WorldModel");
    expect(searchOutput).not.toContain("evidenceID");
    expect(outlineOutput).toContain('"kind": "class"');
    expect(outlineOutput).not.toContain("evidenceID");
    expect(rangeOutput).toContain("code:commit:models/net.py");
    expect(rangeOutput).toContain("class WorldModel");
    expect(snapshots.at(-1)?.toolActivities).toEqual([
      expect.objectContaining({
        toolName: "github_search_code",
        status: "complete",
        request: "WorldModel · models/",
        result: "搜索 GitHub 代码，命中 1 行",
      }),
      expect.objectContaining({
        toolName: "github_search_code",
        status: "complete",
        request: "WorldModel · models/",
        result: "复用导航结果：搜索 GitHub 代码，命中 1 行",
      }),
      expect.objectContaining({
        toolName: "github_outline_file",
        status: "complete",
        request: "models/net.py",
      }),
      expect.objectContaining({
        toolName: "github_read_range",
        status: "complete",
        request: "models/net.py:L1-L2",
      }),
    ]);
  });

  it("uses the paper table of contents only as an index, not evidence", async () => {
    let paperToolOutput = "";
    const provider: Provider = {
      async *stream(_messages, _system, _preset, _signal, options) {
        paperToolOutput = (
          await tool(options, "arxiv_list_sections").execute({})
        ).output;
        yield { type: "error", message: "stop after paper index check" };
      },
    };

    await expect(
      runNetworkDiagramAgent({
        repositoryURL: "https://github.com/owner/repo",
        provider,
        preset,
        signal: new AbortController().signal,
        fetcher: repositoryFetch,
        paperTools: [
          {
            name: "arxiv_list_sections",
            description: "List paper sections",
            parameters: { type: "object", properties: {} },
            async execute() {
              return {
                output: '[{"number":"3","title":"Method"}]',
                summary: "论文目录 1 节",
              };
            },
          },
        ],
      }),
    ).rejects.toThrow("stop after paper index check");

    expect(paperToolOutput).toContain('"title":"Method"');
    expect(paperToolOutput).not.toContain("Paper evidence ID");
  });

  it("uses LaTeX tools exclusively when source is available and permits architecture figures", async () => {
    let paperToolNames: string[] = [];
    const provider: Provider = {
      async *stream(_messages, system, _preset, _signal, options) {
        paperToolNames = (options?.tools ?? [])
          .map((candidate) => candidate.name)
          .filter(
            (name) => name.startsWith("arxiv_") || name.startsWith("zotero_"),
          );
        expect(system).toContain("LaTeX source is available");
        expect(system).toContain("arxiv_get_figure");
        expect(system).toContain("important architecture figure");
        yield { type: "error", message: "stop after LaTeX policy check" };
      },
    };
    const paperTool = (name: string): AgentTool => ({
      name,
      description: name,
      parameters: { type: "object", properties: {} },
      async execute() {
        return { output: name };
      },
    });

    await expect(
      runNetworkDiagramAgent({
        repositoryURL: "https://github.com/owner/repo",
        provider,
        preset,
        signal: new AbortController().signal,
        fetcher: repositoryFetch,
        paperSourceMode: "latex",
        paperTools: [
          paperTool("zotero_search_pdf"),
          paperTool("arxiv_list_sections"),
          paperTool("arxiv_get_section"),
          paperTool("arxiv_get_figure"),
          paperTool("zotero_read_pdf_range"),
        ],
      }),
    ).rejects.toThrow("stop after LaTeX policy check");

    expect(paperToolNames).toEqual([
      "arxiv_list_sections",
      "arxiv_get_section",
      "arxiv_get_figure",
    ]);
  });

  it("falls back to PDF tools only when LaTeX source is unavailable", async () => {
    let paperToolNames: string[] = [];
    const provider: Provider = {
      async *stream(_messages, system, _preset, _signal, options) {
        paperToolNames = (options?.tools ?? [])
          .map((candidate) => candidate.name)
          .filter(
            (name) => name.startsWith("arxiv_") || name.startsWith("zotero_"),
          );
        expect(system).toContain("LaTeX source is unavailable");
        expect(system).toContain("targeted PDF");
        yield { type: "error", message: "stop after PDF policy check" };
      },
    };
    const paperTool = (name: string): AgentTool => ({
      name,
      description: name,
      parameters: { type: "object", properties: {} },
      async execute() {
        return { output: name };
      },
    });

    await expect(
      runNetworkDiagramAgent({
        repositoryURL: "https://github.com/owner/repo",
        provider,
        preset,
        signal: new AbortController().signal,
        fetcher: repositoryFetch,
        paperSourceMode: "pdf",
        paperTools: [
          paperTool("arxiv_list_sections"),
          paperTool("zotero_search_pdf"),
          paperTool("arxiv_get_figure"),
          paperTool("zotero_read_pdf_range"),
        ],
      }),
    ).rejects.toThrow("stop after PDF policy check");

    expect(paperToolNames).toEqual([
      "zotero_search_pdf",
      "zotero_read_pdf_range",
    ]);
  });

  it("enforces the analysis deadline when a provider ignores abort", async () => {
    vi.useFakeTimers();
    let releaseProvider!: () => void;
    const providerBlocked = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    let providerEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      providerEntered = resolve;
    });
    const provider: Provider = {
      async *stream() {
        providerEntered();
        await providerBlocked;
      },
    };
    const run = runNetworkDiagramAgent({
      repositoryURL: "https://github.com/owner/repo",
      provider,
      preset,
      signal: new AbortController().signal,
      fetcher: repositoryFetch,
    });
    let outcome = "pending";
    void run.then(
      () => {
        outcome = "resolved";
      },
      () => {
        outcome = "rejected";
      },
    );

    try {
      await entered;
      await vi.advanceTimersByTimeAsync(
        DEFAULT_CONTEXT_POLICY.githubAnalysisTimeoutMs + 1,
      );
      await Promise.resolve();
      expect(outcome).toBe("rejected");
    } finally {
      releaseProvider();
      await run.catch(() => undefined);
      vi.useRealTimers();
    }
  });

  it("stops immediately when the caller cancels even if the provider ignores abort", async () => {
    let releaseProvider!: () => void;
    const providerBlocked = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    let providerEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      providerEntered = resolve;
    });
    const provider: Provider = {
      async *stream() {
        providerEntered();
        await providerBlocked;
      },
    };
    const controller = new AbortController();
    const run = runNetworkDiagramAgent({
      repositoryURL: "https://github.com/owner/repo",
      provider,
      preset,
      signal: controller.signal,
      fetcher: repositoryFetch,
    });

    try {
      await entered;
      controller.abort();
      const outcome = await Promise.race([
        run.then(
          () => "resolved",
          () => "rejected",
        ),
        new Promise<string>((resolve) =>
          setTimeout(() => resolve("pending"), 50),
        ),
      ]);
      expect(outcome).toBe("rejected");
    } finally {
      releaseProvider();
      await run.catch(() => undefined);
    }
  });

  it("lets the AI choose evidence files and accepts one detailed atomic v1", async () => {
    const chosen: Array<{ path: string; reason: string }> = [];
    let capturedSystemPrompt = "";
    let capturedUserPrompt = "";
    let capturedProviderOptions: ProviderStreamOptions | undefined;
    const provider: Provider = {
      async *stream(messages, system, _preset, _signal, options) {
        capturedSystemPrompt = system;
        capturedUserPrompt = messages[0]?.content ?? "";
        capturedProviderOptions = options;
        const readPaper = tool(options, "zotero_search_pdf");
        const paperResult = await readPaper.execute({
          query: "method architecture objective",
        });
        const paperEvidenceID = paperResult.output.match(
          /Paper evidence ID: ([^\]]+)/,
        )?.[1];
        expect(paperEvidenceID).toBeTruthy();
        const readRange = tool(options, "github_read_range");
        const sourceResult = await readRange.execute({
          path: "models/net.py",
          startLine: 1,
          endLine: 2,
          reason: "确认完整推理路径和创新模块",
          coverage: "inference-path",
        });
        const duplicateResult = await readRange.execute({
          path: "models/net.py",
          startLine: 1,
          endLine: 2,
          reason: "再次确认同一范围",
          coverage: "core-innovations",
        });
        expect(duplicateResult.output).toContain("reusedEvidenceIDs");
        expect(duplicateResult.output.length).toBeLessThan(240);
        const read = tool(options, "github_read_files");
        const configResult = await read.execute({
          files: [
            {
              path: "configs/net.yaml",
              reason: "确认层数和注意力头",
              coverage: "parameters-tensors",
            },
            {
              path: "models/net.py",
              startLine: 20,
              endLine: 30,
              reason: "模拟模型给出的越界范围",
              coverage: "core-innovations",
            },
          ],
        });
        const sourceEvidence = JSON.parse(sourceResult.output) as {
          files: Array<{ evidenceID: string; path: string; reason: string }>;
        };
        const configEvidence = JSON.parse(configResult.output) as {
          files: Array<{ evidenceID: string; path: string; reason: string }>;
          readErrors?: Array<{ path: string; error: string }>;
        };
        expect(configEvidence.files).toHaveLength(1);
        expect(configEvidence.readErrors).toEqual([
          expect.objectContaining({
            path: "models/net.py",
            error: expect.stringContaining("文件共 2 行"),
          }),
        ]);
        const evidence = {
          files: [...sourceEvidence.files, ...configEvidence.files],
        };
        chosen.push(...evidence.files);
        const codeEvidence = evidence.files.map((file) => file.evidenceID);
        const submit = tool(options, "submit_network_diagram");
        const submitted = await submit.execute({
          assistantSummary: "已生成详细网络图 v1",
          graph: {
            rankdir: "TB",
            nodes: [
              {
                id: "input",
                label: "多视角图像",
                type: "root",
                stage: "inputs-preprocess",
                description: "归一化并形成批量视图张量",
                tensorShape: "images [B,V,3,H,W]",
                notes: {
                  parameters: "none",
                  dataFlow: "receive multi-view images",
                  objective: "none directly",
                  attribution: "input-output",
                  implementation: "WorldModel.forward input",
                },
                evidenceIDs: ["code:mistyped-commit:models/net.py"],
              },
              {
                id: "backbone",
                label: "Backbone + FPN",
                type: "section",
                stage: "backbone-features",
                description: "输出多尺度图像特征",
                tensorShape:
                  "images [B,V,3,H,W] → visual [B,V,C,H/4,W/4] + visual_pyramid [B,V,C,H/8,W/8]",
                notes: {
                  parameters: "standard backbone parameters",
                  dataFlow: "encode images into multi-scale features",
                  objective: "trained through downstream objectives",
                  attribution: "standard-module",
                  implementation: "models/net.py backbone",
                },
                evidenceIDs: [codeEvidence[0]],
              },
              {
                id: "action",
                label: "动作条件",
                type: "root",
                stage: "inputs-preprocess",
                description: "模型 forward 的动作侧输入",
                tensorShape: "action [B,T,A]",
                notes: {
                  parameters: "none",
                  dataFlow: "receive action condition",
                  objective: "none directly",
                  attribution: "input-output",
                  implementation: "WorldModel.forward action",
                },
                evidenceIDs: [codeEvidence[0]],
              },
              {
                id: "world",
                label: "潜在世界模型",
                type: "point",
                stage: "core-innovations",
                description: "动作条件的未来潜变量预测",
                tensorShape:
                  "visual [B,V,C,h,w] + action [B,T,A] → latent [B,T,D]",
                notes: {
                  parameters: "action encoder and latent predictor",
                  dataFlow: "condition visual features on actions",
                  objective: "future latent prediction loss",
                  attribution: "paper-contribution",
                  implementation: "WorldModel.forward",
                },
                evidenceIDs: [...codeEvidence, paperEvidenceID as string],
              },
              {
                id: "output",
                label: "航点输出",
                type: "result",
                stage: "outputs",
                description: "输出未来 T 步航点",
                tensorShape: "latent [B,T,D] → waypoints [B,T,2]",
                notes: {
                  parameters: "prediction head",
                  dataFlow: "decode latent into waypoints",
                  objective: "waypoint loss",
                  attribution: "input-output",
                  implementation: "WorldModel.forward return",
                },
                evidenceIDs: [codeEvidence[0]],
              },
            ],
            edges: [
              { source: "input", target: "backbone", label: "images" },
              { source: "backbone", target: "world", label: "visual" },
              { source: "action", target: "world", label: "action" },
              { source: "world", target: "output", label: "latent" },
            ],
          },
          coverage: INITIAL_DETAIL_CATEGORIES.map((category) => ({
            category,
            status:
              category === "branches-fusion" || category === "training-path"
                ? "not-applicable"
                : "done",
            summary: `已检查 ${category}`,
            evidenceIDs: codeEvidence,
          })),
        });
        expect(submitted.output).toContain("accepted");
        yield { type: "text_delta", text: "完成" };
      },
    };
    const progress: string[] = [];
    const result = await runNetworkDiagramAgent({
      repositoryURL: "https://github.com/owner/repo",
      provider,
      preset: { ...preset, baseUrl: "https://relay.example/openai" },
      signal: new AbortController().signal,
      fetcher: repositoryFetch,
      paperContext: "论文方法章节说明潜在世界模型。",
      paperEvidence: [
        {
          id: "paper:section:4.1",
          kind: "paper",
          label: "§4.1 Method",
          sectionNo: "4.1",
        },
      ],
      paperTools: [
        {
          name: "zotero_search_pdf",
          description: "Search the current paper.",
          parameters: { type: "object", properties: {} },
          async execute() {
            return {
              output:
                "[Retrieved PDF passages]\nThe proposed latent module predicts future representations.",
              summary: "检索论文方法，返回 1 段",
            };
          },
        },
      ],
      promptCacheKey: "zai:network:item-1",
      relayRoutingItemKey: "ITEM1",
      onProgress: (state) => progress.push(state.currentDetail),
    });

    expect(chosen).toMatchObject([
      {
        path: "models/net.py",
        reason: "确认完整推理路径和创新模块",
        evidenceID: expect.any(String),
      },
      {
        path: "configs/net.yaml",
        reason: "确认层数和注意力头",
        evidenceID: expect.any(String),
      },
    ]);
    expect(result.graph.nodes).toHaveLength(5);
    expect(result.graph.nodes.find((node) => node.id === "world")?.type).toBe(
      "innovation",
    );
    expect(result.graph.nodes[0].evidenceIDs).toEqual([
      "code:commit:models/net.py:L1-L2",
    ]);
    expect(result.repository.commitSHA).toBe("commit");
    expect(progress.some((line) => line.includes("AI 选择"))).toBe(true);
    expect(progress).toContain("已读取 2 个 AI 选择的文件");
    expect(progress.some((line) => line.includes("论文证据"))).toBe(true);
    expect(capturedProviderOptions?.promptCacheKey).toBe("zai:network:item-1");
    expect(capturedProviderOptions?.relayRoutingItemKey).toBe("ITEM1");
    expect(capturedProviderOptions?.parallelToolCalls).toBe(true);
    expect(capturedProviderOptions?.maxToolIterations).toBe(12);
    expect(capturedUserPrompt).toContain("Network diagram task");
    expect(capturedUserPrompt).toContain("fixed commit");
    expect(capturedUserPrompt).not.toContain("Candidate path manifest");
    expect(capturedUserPrompt.length).toBeLessThan(1_200);
    expect(capturedSystemPrompt.length).toBeLessThan(14_000);
    expect(capturedSystemPrompt).toContain("one node exactly once");
    expect(capturedSystemPrompt).toContain("main inference spine");
    expect(capturedSystemPrompt).toContain("Never duplicate downstream nodes");
    expect(capturedSystemPrompt).toContain("input shape(s) → output shape");
    expect(capturedSystemPrompt).toContain("one topology node");
    expect(capturedSystemPrompt).toContain("ResNet18");
    expect(capturedSystemPrompt).toContain("multi-input feature fusion");
    expect(capturedSystemPrompt).toContain("alignment/projection");
    expect(capturedSystemPrompt).toContain("forward-time side input");
    expect(capturedSystemPrompt).toContain("Q, K, and V");
    expect(capturedSystemPrompt).toContain(
      "reshape, unsqueeze, squeeze, flatten, repeat",
    );
    expect(capturedSystemPrompt).toContain("mode selection");
    expect(capturedSystemPrompt).toContain(
      "Parameters → Data flow → Objective",
    );
    expect(capturedSystemPrompt).toContain("paper-contribution");
    expect(capturedSystemPrompt).toContain("canonical tensor name");
    expect(capturedSystemPrompt).toContain("Universal model roles");
    expect(capturedSystemPrompt).toContain("standard encoder/backbone");
    expect(capturedSystemPrompt).toContain("prediction head");
    expect(capturedSystemPrompt).toContain("Resolve target identity");
    expect(capturedSystemPrompt).toContain("several unrelated model families");
    expect(capturedSystemPrompt).toContain("identity-continuity contract");
    expect(capturedSystemPrompt).toContain("Current target code anchors");
    expect(capturedSystemPrompt).toContain(
      "read at least one exact path from Current target code anchors",
    );
    expect(capturedSystemPrompt).toContain("one concrete executable variant");
    expect(capturedSystemPrompt).toContain(
      "never union mutually exclusive paths",
    );
    expect(capturedSystemPrompt).toContain("Paper specification");
    expect(capturedSystemPrompt).toContain("Implementation specification");
    expect(capturedSystemPrompt).toContain("Reconciliation");
    expect(capturedSystemPrompt).toContain("Architecture IR");
    expect(capturedSystemPrompt).toContain("Validation");
    expect(capturedSystemPrompt).toContain("paper retrieval tools");
    expect(capturedSystemPrompt).not.toContain("waypoint queries");
    expect(capturedSystemPrompt).not.toContain("lidar2img");
    expect(capturedSystemPrompt).not.toContain("ego_fut_cmd");
    expect(capturedSystemPrompt).not.toContain("spatial_view_feat");
    expect(capturedSystemPrompt).not.toContain("V_t");
  });

  it("rejects refinement candidates that drift to another model identity", () => {
    const current = {
      rankdir: "TB" as const,
      nodes: ["encoder", "fusion", "head"].map((id) => ({
        id,
        label: id,
        type: "point" as const,
        stage: "core-innovations" as const,
        description: id,
        tensorShape: `${id}_in [B,D] → ${id}_out [B,D]`,
        evidenceIDs: ["code:target:model.py"],
      })),
      edges: [],
    };
    const drifted = {
      rankdir: "TB" as const,
      nodes: ["other_encoder", "other_fusion", "other_head"].map((id) => ({
        id,
        label: id,
        type: "point" as const,
        stage: "core-innovations" as const,
        description: id,
        tensorShape: `${id}_in [B,D] → ${id}_out [B,D]`,
        evidenceIDs: ["code:baseline:model.py"],
      })),
      edges: [],
    };

    expect(validateRefinementContinuity(current, drifted)).toEqual([
      "精修候选仅保留 0 个当前语义节点 id，至少需要 2 个；请复用未改变节点的 id，避免切换模型身份",
      "精修候选没有保留任何当前模型的代码依据；请先沿当前入口继续追踪，避免切换到仓库中的其他模型族",
    ]);
    expect(validateRefinementContinuity(current, current)).toEqual([]);
  });

  it("requires refinement anchors before unrelated repository files", () => {
    const unread = new Set(["models/target.py", "configs/target.yaml"]);

    expect(refinementAnchorReadError(unread, ["models/target.py"])).toBeNull();
    expect(
      refinementAnchorReadError(unread, [
        "models/target.py",
        "models/dependency.py",
      ]),
    ).toBeNull();
    expect(refinementAnchorReadError(unread, ["models/baseline.py"])).toContain(
      "models/target.py",
    );
    expect(
      refinementAnchorReadError(unread, ["models/dependency.py"], true),
    ).toBeNull();
    expect(
      refinementAnchorReadError(new Set(), ["models/baseline.py"]),
    ).toBeNull();
  });

  it("rejects a sparse candidate before it can replace the current graph", () => {
    const errors = validateDetailedNetworkGraph(
      {
        rankdir: "TB",
        nodes: [
          {
            id: "model",
            label: "模型",
            type: "innovation",
            stage: "core-innovations",
            description: "一个抽象模型节点",
            evidenceIDs: ["code:one"],
          },
        ],
        edges: [],
      },
      [],
      new Set(["code:one"]),
    );

    expect(errors).toContain("缺少输入与预处理节点");
    expect(errors).toContain("缺少主干与特征层级节点");
    expect(errors).toContain("缺少输出节点");
    expect(errors).toContain("缺少从输入到输出的完整推理路径");
  });

  it("does not invent a paper contribution for an adopted core module", () => {
    const codeEvidence = "code:one";
    const errors = validateDetailedNetworkGraph(
      {
        rankdir: "TB",
        nodes: [
          {
            id: "input",
            label: "模型输入",
            type: "root",
            stage: "inputs-preprocess",
            description: "forward 输入张量",
            tensorShape: "input [B,N,D]",
            evidenceIDs: [codeEvidence],
          },
          {
            id: "backbone",
            label: "标准编码器",
            type: "section",
            stage: "backbone-features",
            description: "提取输入特征",
            tensorShape: "input [B,N,D] → feature [B,N,D]",
            evidenceIDs: [codeEvidence],
          },
          {
            id: "core",
            label: "既有解码模块",
            type: "point",
            stage: "core-innovations",
            description: "采用已有方法完成解码",
            tensorShape: "feature [B,N,D] → decoded [B,N,D]",
            notes: {
              parameters: "decoder parameters",
              dataFlow: "decode feature",
              objective: "trained by task loss",
              attribution: "adopted-baseline",
              implementation: "Model.forward",
            },
            evidenceIDs: [codeEvidence],
          },
          {
            id: "output",
            label: "模型输出",
            type: "result",
            stage: "outputs",
            description: "forward 返回值",
            tensorShape: "decoded [B,N,D] → prediction [B,N,C]",
            evidenceIDs: [codeEvidence],
          },
        ],
        edges: [
          { source: "input", target: "backbone", label: "input" },
          { source: "backbone", target: "core", label: "feature" },
          { source: "core", target: "output", label: "decoded" },
        ],
      },
      INITIAL_DETAIL_CATEGORIES.map((category) => ({
        category,
        status:
          category === "branches-fusion" || category === "training-path"
            ? "not-applicable"
            : "done",
        summary: `已检查 ${category}`,
        evidenceIDs: [codeEvidence],
      })),
      new Set([codeEvidence]),
    );

    expect(errors).not.toContain("核心创新必须使用 innovation 节点明确标出");
  });

  it("requires fixed-commit code evidence for every visible node", () => {
    const errors = validateDetailedNetworkGraph(
      {
        rankdir: "TB",
        nodes: [
          {
            id: "input",
            label: "模型输入",
            type: "root",
            stage: "inputs-preprocess",
            description: "forward 输入",
            tensorShape: "input [B,N,D]",
            evidenceIDs: ["paper:tool:zotero_search_pdf:1"],
          },
        ],
        edges: [],
      },
      [],
      new Set(["paper:tool:zotero_search_pdf:1"]),
    );

    expect(errors).toContain("节点 input 缺少固定 commit 的代码依据");
  });

  it("rejects code evidence from a different pinned commit", () => {
    const codeEvidence = "code:old-commit:models/net.py";
    const errors = validateDetailedNetworkGraph(
      {
        rankdir: "TB",
        nodes: [
          {
            id: "input",
            label: "模型输入",
            type: "root",
            stage: "inputs-preprocess",
            description: "forward 输入",
            tensorShape: "input [B,N,D]",
            evidenceIDs: [codeEvidence],
          },
        ],
        edges: [],
      },
      [],
      new Set([codeEvidence]),
      new Map([
        [
          codeEvidence,
          {
            id: codeEvidence,
            kind: "code" as const,
            label: "models/net.py",
            path: "models/net.py",
            commitSHA: "old-commit",
          },
        ],
      ]),
      "current-commit",
    );

    expect(errors).toContain(
      "节点 input 的代码依据不属于当前固定 commit：code:old-commit:models/net.py",
    );
  });

  it("rejects duplicate concepts, duplicate edges, and cycles", () => {
    const errors = validateDetailedNetworkGraph(
      {
        rankdir: "TB",
        nodes: [
          {
            id: "input",
            label: "输入",
            type: "root",
            stage: "inputs-preprocess",
            description: "输入张量",
            evidenceIDs: ["code:one"],
          },
          {
            id: "encoder-a",
            label: "共享编码器",
            type: "section",
            stage: "backbone-features",
            description: "编码特征",
            evidenceIDs: ["code:one"],
          },
          {
            id: "encoder-b",
            label: "共享编码器",
            type: "innovation",
            stage: "core-innovations",
            description: "重复概念",
            evidenceIDs: ["code:one"],
          },
          {
            id: "output",
            label: "输出",
            type: "result",
            stage: "outputs",
            description: "预测结果",
            evidenceIDs: ["code:one"],
          },
        ],
        edges: [
          { source: "input", target: "encoder-a" },
          { source: "input", target: "encoder-a" },
          { source: "encoder-a", target: "encoder-b" },
          { source: "encoder-b", target: "encoder-a" },
          { source: "encoder-b", target: "output" },
        ],
      },
      INITIAL_DETAIL_CATEGORIES.map((category) => ({
        category,
        status:
          category === "branches-fusion" || category === "training-path"
            ? "not-applicable"
            : "done",
        summary: `已检查 ${category}`,
        evidenceIDs: ["code:one"],
      })),
      new Set(["code:one"]),
    );

    expect(errors).toContain("节点名称重复：共享编码器");
    expect(errors).toContain("连线重复：input → encoder-a");
    expect(errors).toContain("网络图不能包含环路");
  });

  it("rejects orchestration details and nodes outside the model forward path", () => {
    const errors = validateDetailedNetworkGraph(
      {
        rankdir: "TB",
        nodes: [
          {
            id: "input",
            label: "多视角图像张量",
            type: "root",
            stage: "inputs-preprocess",
            description: "模型输入",
            evidenceIDs: ["code:one"],
          },
          {
            id: "backbone",
            label: "图像编码器",
            type: "section",
            stage: "backbone-features",
            description: "提取图像特征",
            tensorShape: "[B,N,C,H,W]",
            evidenceIDs: ["code:one"],
          },
          {
            id: "innovation",
            label: "时空融合",
            type: "innovation",
            stage: "core-innovations",
            description: "融合历史与当前特征",
            evidenceIDs: ["code:one"],
          },
          {
            id: "output",
            label: "模型预测",
            type: "result",
            stage: "outputs",
            description: "检测与规划输出",
            evidenceIDs: ["code:one"],
          },
          {
            id: "loader",
            label: "Load / align / augment",
            type: "point",
            stage: "inputs-preprocess",
            description: "数据流水线",
            evidenceIDs: ["code:one"],
          },
          {
            id: "state",
            label: "Inference state manager",
            type: "point",
            stage: "inference-path",
            description: "运行时状态管理",
            evidenceIDs: ["code:one"],
          },
        ],
        edges: [
          { source: "input", target: "backbone" },
          { source: "backbone", target: "innovation" },
          { source: "innovation", target: "output" },
          { source: "loader", target: "backbone" },
          { source: "state", target: "innovation" },
        ],
      },
      INITIAL_DETAIL_CATEGORIES.map((category) => ({
        category,
        status:
          category === "branches-fusion" || category === "training-path"
            ? "not-applicable"
            : "done",
        summary: `已检查 ${category}`,
        evidenceIDs: ["code:one"],
      })),
      new Set(["code:one"]),
    );

    expect(errors).toContain(
      "节点 loader 属于数据或运行编排，不应出现在模型网络图中",
    );
    expect(errors).toContain(
      "节点 state 属于数据或运行编排，不应出现在模型网络图中",
    );
    expect(errors).toContain("节点 state 不在输入到输出的模型前向路径上");
  });

  it("requires shape propagation through every visible computation node", () => {
    const errors = validateDetailedNetworkGraph(
      {
        rankdir: "TB",
        nodes: [
          {
            id: "input",
            label: "输入图像",
            type: "root",
            stage: "inputs-preprocess",
            description: "模型输入",
            evidenceIDs: ["code:one"],
          },
          {
            id: "backbone",
            label: "ResNet18",
            type: "section",
            stage: "backbone-features",
            description: "标准骨干整体表示",
            tensorShape: "[B,3,H,W]",
            evidenceIDs: ["code:one"],
          },
          {
            id: "fusion",
            label: "跨模态特征融合",
            type: "innovation",
            stage: "core-innovations",
            description: "对齐后使用交叉注意力融合",
            tensorShape: "image [B,N,D] + state [B,T,D] → fused [B,T,D]",
            evidenceIDs: ["code:one"],
          },
          {
            id: "output",
            label: "预测输出",
            type: "result",
            stage: "outputs",
            description: "输出预测",
            tensorShape: "fused [B,T,D] → prediction [B,T,2]",
            evidenceIDs: ["code:one"],
          },
        ],
        edges: [
          { source: "input", target: "backbone" },
          { source: "backbone", target: "fusion" },
          { source: "fusion", target: "output" },
        ],
      },
      INITIAL_DETAIL_CATEGORIES.map((category) => ({
        category,
        status:
          category === "branches-fusion" || category === "training-path"
            ? "not-applicable"
            : "done",
        summary: `已检查 ${category}`,
        evidenceIDs: ["code:one"],
      })),
      new Set(["code:one"]),
    );

    expect(errors).toContain("节点 input 缺少张量 shape");
    expect(errors).toContain("节点 backbone 需要标出输入 shape → 输出 shape");
    expect(errors).not.toContain("节点 fusion 需要标出输入 shape → 输出 shape");
  });

  it("keeps source input nodes free of hidden preprocessing", () => {
    const errors = validateDetailedNetworkGraph(
      {
        rankdir: "TB",
        nodes: [
          {
            id: "input",
            label: "序列输入",
            type: "root",
            stage: "inputs-preprocess",
            description: "forward 接收的原始序列",
            tensorShape: "raw [B,T,C] → current [B,C]",
            evidenceIDs: ["code:one"],
          },
          {
            id: "output",
            label: "模型输出",
            type: "result",
            stage: "outputs",
            description: "返回模型预测",
            tensorShape: "current [B,C] → prediction [B,K]",
            evidenceIDs: ["code:one"],
          },
        ],
        edges: [{ source: "input", target: "output" }],
      },
      INITIAL_DETAIL_CATEGORIES.map((category) => ({
        category,
        status: "done",
        summary: `已检查 ${category}`,
        evidenceIDs: ["code:one"],
      })),
      new Set(["code:one"]),
    );

    expect(errors).toContain(
      "输入节点 input 只能声明原始输入名称和 shape，不能包含变换",
    );
  });

  it("requires real incoming edges for every declared multi-input fusion", () => {
    const errors = validateDetailedNetworkGraph(
      {
        rankdir: "TB",
        nodes: [
          {
            id: "input",
            label: "图像输入",
            type: "root",
            stage: "inputs-preprocess",
            description: "图像张量",
            tensorShape: "image [B,N,3,H,W]",
            evidenceIDs: ["code:one"],
          },
          {
            id: "backbone",
            label: "ResNet18",
            type: "section",
            stage: "backbone-features",
            description: "标准主干整体表示",
            tensorShape: "image [B,N,3,H,W] → visual [B,N,D,h,w]",
            evidenceIDs: ["code:one"],
          },
          {
            id: "fusion",
            label: "动作条件融合",
            type: "innovation",
            stage: "core-innovations",
            description: "将视觉特征与动作条件拼接",
            tensorShape: "visual [B,N,D,h,w] + action [B,A] → fused [B,N,D]",
            evidenceIDs: ["code:one"],
          },
          {
            id: "output",
            label: "预测输出",
            type: "result",
            stage: "outputs",
            description: "输出预测",
            tensorShape: "fused [B,N,D] → prediction [B,T,2]",
            evidenceIDs: ["code:one"],
          },
        ],
        edges: [
          { source: "input", target: "backbone" },
          { source: "backbone", target: "fusion" },
          { source: "fusion", target: "output" },
        ],
      },
      INITIAL_DETAIL_CATEGORIES.map((category) => ({
        category,
        status:
          category === "training-path" || category === "parameters-tensors"
            ? "not-applicable"
            : "done",
        summary: `已检查 ${category}`,
        evidenceIDs: ["code:one"],
      })),
      new Set(["code:one"]),
    );

    expect(errors).toContain("节点 fusion 声明多输入融合，但只有 1 条输入连线");
  });

  it("requires attention nodes to identify Q and K/V sources", () => {
    const errors = validateDetailedNetworkGraph(
      {
        rankdir: "TB",
        nodes: [
          {
            id: "input",
            label: "图像输入",
            type: "root",
            stage: "inputs-preprocess",
            description: "图像张量",
            tensorShape: "image [B,N,3,H,W]",
            evidenceIDs: ["code:one"],
          },
          {
            id: "query",
            label: "条件输入",
            type: "root",
            stage: "inputs-preprocess",
            description: "运行期条件张量",
            tensorShape: "condition [B,Q,D]",
            evidenceIDs: ["code:one"],
          },
          {
            id: "backbone",
            label: "图像编码器",
            type: "section",
            stage: "backbone-features",
            description: "提取图像 token",
            tensorShape: "image [B,N,3,H,W] → visual [B,S,D]",
            evidenceIDs: ["code:one"],
          },
          {
            id: "attention",
            label: "Cross-Attention 融合",
            type: "innovation",
            stage: "core-innovations",
            description: "融合条件与图像 token",
            tensorShape: "condition [B,Q,D] + visual [B,S,D] → fused [B,Q,D]",
            evidenceIDs: ["code:one"],
          },
          {
            id: "output",
            label: "预测输出",
            type: "result",
            stage: "outputs",
            description: "输出预测",
            tensorShape: "fused [B,Q,D] → prediction [B,Q,2]",
            evidenceIDs: ["code:one"],
          },
        ],
        edges: [
          { source: "input", target: "backbone" },
          { source: "backbone", target: "attention" },
          { source: "query", target: "attention" },
          { source: "attention", target: "output" },
        ],
      },
      INITIAL_DETAIL_CATEGORIES.map((category) => ({
        category,
        status:
          category === "training-path" || category === "parameters-tensors"
            ? "not-applicable"
            : "done",
        summary: `已检查 ${category}`,
        evidenceIDs: ["code:one"],
      })),
      new Set(["code:one"]),
    );

    expect(errors).toContain(
      "注意力节点 attention 必须在作用说明中明确 Q 与 K/V 的来源",
    );
  });

  it("keeps learned attention queries inside the module instead of requiring a fake input node", () => {
    const errors = validateDetailedNetworkGraph(
      {
        rankdir: "TB",
        nodes: [
          {
            id: "input",
            label: "图像输入",
            type: "root",
            stage: "inputs-preprocess",
            description: "图像张量",
            tensorShape: "image [B,N,3,H,W]",
            evidenceIDs: ["code:one"],
          },
          {
            id: "backbone",
            label: "图像编码器",
            type: "section",
            stage: "backbone-features",
            description: "提取图像 token",
            tensorShape: "image [B,N,3,H,W] → visual [B,S,D]",
            evidenceIDs: ["code:one"],
          },
          {
            id: "attention",
            label: "View-Query Cross-Attention",
            type: "innovation",
            stage: "core-innovations",
            description: "融合可学习查询与图像 token",
            tensorShape: "Q [B,Q,D] + K/V visual [B,S,D] → view latent [B,Q,D]",
            evidenceIDs: ["code:one"],
            notes: {
              parameters: "Q 是模块内部的可学习 query",
              dataFlow: "Q 查询视觉表示；K/V 来自图像编码器 visual tokens",
              objective: "通过下游预测目标训练",
              attribution: "paper-contribution",
              implementation: "AttentionBlock.forward",
            },
          },
          {
            id: "output",
            label: "预测输出",
            type: "result",
            stage: "outputs",
            description: "输出预测",
            tensorShape: "view latent [B,Q,D] → prediction [B,Q,2]",
            evidenceIDs: ["code:one"],
          },
        ],
        edges: [
          { source: "input", target: "backbone" },
          { source: "backbone", target: "attention" },
          { source: "attention", target: "output" },
        ],
      },
      INITIAL_DETAIL_CATEGORIES.map((category) => ({
        category,
        status:
          category === "branches-fusion" ||
          category === "training-path" ||
          category === "parameters-tensors"
            ? "not-applicable"
            : "done",
        summary: `已检查 ${category}`,
        evidenceIDs: ["code:one"],
      })),
      new Set(["code:one"]),
    );

    expect(errors).not.toContain(
      "节点 attention 声明多输入融合，但只有 1 条输入连线",
    );
    expect(errors).not.toContain(
      "注意力节点 attention 必须在作用说明中明确 Q 与 K/V 的来源",
    );
  });

  it("does not mistake internally generated coordinate grids for feature fusion", () => {
    const errors = validateDetailedNetworkGraph(
      {
        rankdir: "TB",
        nodes: [
          {
            id: "input",
            label: "相机图像",
            type: "root",
            stage: "inputs-preprocess",
            description: "模型图像输入",
            tensorShape: "image [B,N,3,H,W]",
            evidenceIDs: ["code:one"],
          },
          {
            id: "backbone",
            label: "标准图像主干",
            type: "section",
            stage: "backbone-features",
            description: "提取图像特征",
            tensorShape: "image [B,N,3,H,W] → feature [B,N,C,h,w]",
            evidenceIDs: ["code:one"],
          },
          {
            id: "depth",
            label: "像素网格与深度采样拼接",
            type: "innovation",
            stage: "core-innovations",
            description: "生成像素网格，并拼接模块内部固定的深度采样 bins",
            tensorShape:
              "pixel grid [B,N,h,w,2] + fixed depth [D] → coordinates [B,N,h,w,D,3]",
            evidenceIDs: ["code:one"],
          },
          {
            id: "output",
            label: "位置特征输出",
            type: "result",
            stage: "outputs",
            description: "输出位置特征",
            tensorShape: "coordinates [B,N,h,w,D,3] → position [B,N,C,h,w]",
            evidenceIDs: ["code:one"],
          },
        ],
        edges: [
          { source: "input", target: "backbone" },
          { source: "backbone", target: "depth" },
          { source: "depth", target: "output" },
        ],
      },
      INITIAL_DETAIL_CATEGORIES.map((category) => ({
        category,
        status:
          category === "branches-fusion" ||
          category === "training-path" ||
          category === "parameters-tensors"
            ? "not-applicable"
            : "done",
        summary: `已检查 ${category}`,
        evidenceIDs: ["code:one"],
      })),
      new Set(["code:one"]),
    );

    expect(errors).not.toContain(
      "节点 depth 声明多输入融合，但只有 1 条输入连线",
    );
  });

  it("rejects a labeled edge whose tensor is absent from either endpoint", () => {
    const errors = validateDetailedNetworkGraph(
      {
        rankdir: "TB",
        nodes: [
          {
            id: "input",
            label: "图像输入",
            type: "root",
            stage: "inputs-preprocess",
            description: "图像张量",
            tensorShape: "images [B,3,H,W]",
            evidenceIDs: ["code:one"],
          },
          {
            id: "backbone",
            label: "标准主干",
            type: "section",
            stage: "backbone-features",
            description: "提取视觉特征",
            tensorShape: "images [B,3,H,W] → visual [B,C,h,w]",
            evidenceIDs: ["code:one"],
          },
          {
            id: "innovation",
            label: "创新模块",
            type: "innovation",
            stage: "core-innovations",
            description: "预测潜变量",
            tensorShape: "latent [B,C,h,w] → future [B,C,h,w]",
            evidenceIDs: ["code:one"],
          },
          {
            id: "output",
            label: "预测输出",
            type: "result",
            stage: "outputs",
            description: "返回预测",
            tensorShape: "future [B,C,h,w] → output [B,C,h,w]",
            evidenceIDs: ["code:one"],
          },
        ],
        edges: [
          { source: "input", target: "backbone", label: "images" },
          { source: "backbone", target: "innovation", label: "visual" },
          { source: "innovation", target: "output", label: "future" },
        ],
      },
      INITIAL_DETAIL_CATEGORIES.map((category) => ({
        category,
        status:
          category === "branches-fusion" ||
          category === "training-path" ||
          category === "parameters-tensors"
            ? "not-applicable"
            : "done",
        summary: `已检查 ${category}`,
        evidenceIDs: ["code:one"],
      })),
      new Set(["code:one"]),
    );

    expect(errors).toContain(
      "连线 backbone → innovation 的张量 visual 未出现在目标节点输入中",
    );
  });
});
