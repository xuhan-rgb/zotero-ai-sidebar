import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createWebPromptTask,
  registerWebPromptHub,
  unregisterWebPromptHub,
} from "../../src/modules/web-prompt-hub";
import {
  advanceWebProgressText,
  advanceWebReasoningSnapshot,
  interruptStaleWebPromptTasks,
  webPromptProviderForUserMessage,
  webPromptStatusBubbleContent,
  webPromptTaskPending,
} from "../../src/modules/web-prompt-runtime";

const sidebar = readFileSync(
  resolve(process.cwd(), "src/modules/sidebar.ts"),
  "utf8",
);

describe("WEB prompt runtime paint and send lock", () => {
  it("recognizes current and legacy Kimi WEB tasks", () => {
    expect(
      webPromptProviderForUserMessage({ task: { webProvider: "kimi" } }),
    ).toBe("kimi");
    expect(
      webPromptProviderForUserMessage({ task: { title: "Kimi Web" } }),
    ).toBe("kimi");
    expect(
      webPromptProviderForUserMessage({
        task: { webProvider: "custom:kimi-com" },
      }),
    ).toBe("kimi");
  });
  it("keeps painting when a growing snapshot normalizes its prefix", () => {
    const painted = "## 回答\n\n已经显示给用户的完整段落";
    const normalized = "回答\n\n已经显示给用户的完整段落和新增内容";

    expect(advanceWebProgressText(painted, normalized)).toBe(normalized);
    expect(advanceWebProgressText(painted, `${painted}\n\n继续生成`)).toBe(
      `${painted}\n\n继续生成`.slice(0, painted.length + 28),
    );
    expect(advanceWebProgressText(painted, "回答正在重新挂载")).toBe(painted);
  });

  it("paints a growing reasoning snapshot immediately without transient rollback", () => {
    const current = "正在分析用户问题";
    const largeSnapshot = `${current}\n${"浏览论文页面\n".repeat(300)}`;

    expect(advanceWebReasoningSnapshot(current, largeSnapshot)).toBe(
      largeSnapshot,
    );
    expect(
      advanceWebReasoningSnapshot(largeSnapshot, "思考节点正在重新挂载"),
    ).toBe(largeSnapshot);
    expect(sidebar).toContain("advanceWebReasoningSnapshot(");
  });

  it("replaces the generating placeholder once a snapshot has arrived", () => {
    const placeholder = "DeepSeek 正在生成回答。";
    expect(
      webPromptStatusBubbleContent({
        status: "generating",
        statusMessage: placeholder,
        paintedAnswer: "",
        queuedAnswer: "",
      }),
    ).toBe(placeholder);
    expect(
      webPromptStatusBubbleContent({
        status: "generating",
        statusMessage: placeholder,
        paintedAnswer: "",
        queuedAnswer: "flowchart TD\nA-->B",
      }),
    ).toBe("flowchart TD\nA-->B");
    expect(
      webPromptStatusBubbleContent({
        status: "generating",
        statusMessage: placeholder,
        paintedAnswer: "flowchart TD",
        queuedAnswer: "flowchart TD\nA-->B",
      }),
    ).toBe("flowchart TD");
    expect(
      webPromptStatusBubbleContent({
        status: "failed",
        statusMessage: "DeepSeek 同步失败：连接中断",
        paintedAnswer: "已经同步的回答",
        queuedAnswer: "已经同步的回答\n\n最后一段",
      }),
    ).toBe("已经同步的回答\n\n最后一段\n\n> DeepSeek 同步失败：连接中断");
    expect(
      webPromptStatusBubbleContent({
        status: "cancelled",
        statusMessage: "ChatGLM 网页任务已取消。",
        paintedAnswer: "已经同步的部分回答",
        queuedAnswer: "已经同步的部分回答\n\n最后一段",
      }),
    ).toBe("已经同步的部分回答\n\n最后一段\n\n> ChatGLM 网页任务已取消。");
  });

  it("unlocks WEB send after complete or fail, and holds it while a turn is open", () => {
    expect(
      webPromptTaskPending({
        webPromptBusy: true,
        messages: [],
      }),
    ).toBe(true);
    expect(
      webPromptTaskPending({
        webPromptBusy: true,
        webPromptBusyTaskID: "web-1",
        messages: [
          {
            task: {
              id: "web-1",
              title: "DeepSeek Web",
              webProvider: "deepseek",
              completedAt: 1,
            },
          },
        ],
      }),
    ).toBe(false);
    expect(
      webPromptTaskPending({
        webPromptBusy: false,
        messages: [
          {
            task: {
              id: "web-1",
              title: "DeepSeek Web",
              webProvider: "deepseek",
            },
          },
        ],
      }),
    ).toBe(true);
    expect(
      webPromptTaskPending({
        webPromptBusy: false,
        messages: [
          {
            task: {
              id: "web-1",
              title: "DeepSeek Web",
              webProvider: "deepseek",
              completedAt: 1,
            },
          },
        ],
      }),
    ).toBe(false);
    expect(
      webPromptTaskPending({
        webPromptBusy: false,
        messages: [
          {
            task: {
              id: "web-1",
              title: "DeepSeek Web",
              webProvider: "deepseek",
              error: "answer timed out",
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it("interrupts both sides of a restored WEB turn without deleting its partial answer", () => {
    const messages = [
      {
        role: "user" as const,
        content: "将流程图可视化",
        task: {
          id: "web-1",
          title: "DeepSeek Web",
          webProvider: "deepseek",
          webStatus: "generating" as const,
        },
      },
      {
        role: "assistant" as const,
        content: "已经同步下来的部分回答",
        task: {
          id: "web-1",
          title: "等待网页回答",
          webProvider: "deepseek",
          webStatus: "generating" as const,
        },
      },
    ];

    expect(interruptStaleWebPromptTasks(messages, 1234)).toBe(2);
    expect(messages[0].task.cancelledAt).toBe(1234);
    expect(messages[1].task.cancelledAt).toBe(1234);
    expect(messages[1].task.error).toBe("Zotero 重启时被中断");
    expect(messages[1].task.webStatus).toBeUndefined();
    expect(messages[1].content).toBe("已经同步下来的部分回答");
    expect(webPromptTaskPending({ messages })).toBe(false);
  });

  it("clears a stale phase from an already-cancelled WEB message", () => {
    const messages = [
      {
        role: "user" as const,
        task: {
          id: "web-1",
          title: "DeepSeek Web",
          webProvider: "deepseek",
          webStatus: "queued" as const,
          cancelledAt: 1000,
          error: "Zotero 重启时被中断",
        },
      },
    ];

    expect(interruptStaleWebPromptTasks(messages, 1234)).toBe(1);
    expect(messages[0].task.cancelledAt).toBe(1000);
    expect(messages[0].task.webStatus).toBeUndefined();
  });

  it("uses the shipped runtime helper for status paint and lock release", () => {
    expect(sidebar).toContain('from "./web-prompt-runtime"');
    expect(sidebar).toContain("webPromptStatusBubbleContent(");
    expect(sidebar).toContain("if (states.get(mount) !== state)");
    expect(sidebar).toContain("releaseWebPromptLock()");
    expect(sidebar).toMatch(
      /if \(states\.get\(mount\) !== state\) \{\s*releaseWebPromptLock\(\);\s*return;/,
    );
    expect(sidebar).toMatch(
      /if \(!conversation\) \{\s*releaseWebPromptLock\(\);\s*return;/,
    );
  });
});

describe("Web Prompt Hub empty completed unlocks the turn", () => {
  beforeEach(() => {
    vi.stubGlobal("Zotero", {
      Server: { Endpoints: {} },
      Utilities: { randomString: () => "fixed-task-id" },
      DataDirectory: { dir: "/zotero-data" },
    });
    vi.stubGlobal("IOUtils", {
      readUTF8: vi.fn(async () =>
        JSON.stringify({
          token: "test-token",
          nodePath: "/node",
          chromePath: "/chrome",
          agentScript: "/agent.mjs",
          profileDir: "/profile",
          port: 23120,
          callbackUrl: "http://127.0.0.1:23119/zai/web-prompt-hub",
        }),
      ),
    });
  });

  afterEach(() => {
    unregisterWebPromptHub();
    vi.unstubAllGlobals();
  });

  it("treats an empty completed payload as failure so WEB send can continue", async () => {
    const onImport = vi.fn();
    const onStatus = vi.fn();
    registerWebPromptHub();
    const task = createWebPromptTask({
      provider: "deepseek",
      prompt: "整理成流程图",
      sourceLabel: "Paper · Conversation 1",
      onImport,
      onStatus,
    });
    const Endpoint = Zotero.Server.Endpoints[
      "/zai/web-prompt-hub"
    ] as new () => {
      init(options: unknown): Promise<[number, string, string]>;
    };
    const endpoint = new Endpoint();
    const completed = await endpoint.init({
      headers: { authorization: "Bearer test-token" },
      method: "POST",
      searchParams: new URLSearchParams(),
      data: { id: task.id, state: "completed", answer: "   " },
    });
    expect(completed[0]).toBe(400);
    expect(onImport).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith("failed", "网页回答为空");
  });

  it("keeps the newest snapshot when callbacks arrive out of order", async () => {
    const onImport = vi.fn();
    const onProgress = vi.fn();
    const onStatus = vi.fn();
    registerWebPromptHub();
    const task = createWebPromptTask({
      provider: "deepseek",
      prompt: "整理论文",
      sourceLabel: "Paper · Conversation 1",
      onImport,
      onProgress,
      onStatus,
    });
    const Endpoint = Zotero.Server.Endpoints[
      "/zai/web-prompt-hub"
    ] as new () => {
      init(options: unknown): Promise<[number, string, string]>;
    };
    const endpoint = new Endpoint();
    const post = (data: Record<string, unknown>) =>
      endpoint.init({
        headers: { authorization: "Bearer test-token" },
        method: "POST",
        searchParams: new URLSearchParams(),
        data: { id: task.id, ...data },
      });

    await post({ state: "generating", revision: 2, answer: "完整快照" });
    await post({ state: "generating", revision: 1, answer: "旧快照" });
    await post({ state: "completed", revision: 3, answer: "" });

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ answer: "完整快照" }),
    );
    expect(onImport).toHaveBeenCalledWith(
      expect.objectContaining({ answer: "完整快照" }),
    );
    expect(onStatus).not.toHaveBeenCalledWith("completed", undefined);
  });

  it("forwards a reasoning snapshot before the final answer exists", async () => {
    const onImport = vi.fn();
    const onProgress = vi.fn();
    registerWebPromptHub();
    const task = createWebPromptTask({
      provider: "deepseek",
      prompt: "hello",
      sourceLabel: "Paper · Conversation 1",
      onImport,
      onProgress,
    });
    const Endpoint = Zotero.Server.Endpoints[
      "/zai/web-prompt-hub"
    ] as new () => {
      init(options: unknown): Promise<[number, string, string]>;
    };
    const endpoint = new Endpoint();

    const response = await endpoint.init({
      headers: { authorization: "Bearer test-token" },
      method: "POST",
      searchParams: new URLSearchParams(),
      data: {
        id: task.id,
        state: "generating",
        revision: 1,
        answer: "",
        reasoning: "正在分析用户问题",
      },
    });

    expect(response[0]).toBe(200);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        answer: "",
        reasoning: "正在分析用户问题",
      }),
    );
    expect(onImport).not.toHaveBeenCalled();
  });

  it("removes a cancelled task so late callbacks cannot keep the turn alive", async () => {
    const onStatus = vi.fn();
    registerWebPromptHub();
    const task = createWebPromptTask({
      provider: "custom:chatglm-cn",
      prompt: "你好",
      sourceLabel: "Paper · Conversation 1",
      onImport: vi.fn(),
      onStatus,
    });
    const Endpoint = Zotero.Server.Endpoints[
      "/zai/web-prompt-hub"
    ] as new () => {
      init(options: unknown): Promise<[number, string, string]>;
    };
    const endpoint = new Endpoint();
    const post = (data: Record<string, unknown>) =>
      endpoint.init({
        headers: { authorization: "Bearer test-token" },
        method: "POST",
        searchParams: new URLSearchParams(),
        data: { id: task.id, ...data },
      });

    expect((await post({ state: "cancelled" }))[0]).toBe(200);
    expect(onStatus).toHaveBeenCalledWith("cancelled", undefined);
    expect((await post({ state: "generating", answer: "迟到内容" }))[0]).toBe(
      404,
    );
  });
});
