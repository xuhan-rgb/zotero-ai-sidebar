import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createWebPromptTask,
  registerWebPromptHub,
  unregisterWebPromptHub,
} from "../../src/modules/web-prompt-hub";

describe("Web Prompt Hub", () => {
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

  it("serves a local task page and imports its answer once submitted", async () => {
    const onImport = vi.fn();
    registerWebPromptHub();
    const task = createWebPromptTask({
      provider: "chatgpt",
      prompt: "Explain <method>.",
      sourceLabel: "Paper · Conversation 1",
      onImport,
    });
    expect(task.url).toContain("http://127.0.0.1:23119/zai/web-prompt-hub?id=");

    const Endpoint = Zotero.Server.Endpoints[
      "/zai/web-prompt-hub"
    ] as new () => {
      init(options: unknown): Promise<[number, string, string]>;
    };
    expect((Endpoint as any).prototype.supportedMethods).toEqual([
      "GET",
      "POST",
    ]);
    expect((Endpoint as any).prototype.permitBookmarklet).toBe(true);
    expect(
      (Endpoint as any).prototype.allowRequestsFromUnsafeWebContent,
    ).toBe(true);
    const endpoint = new Endpoint();
    const page = await endpoint.init({
      method: "GET",
      searchParams: new URLSearchParams({ id: task.id }),
      data: null,
    });
    expect(page[0]).toBe(200);
    expect(page[2]).toContain("ChatGPT Web");
    expect(page[2]).toContain("Explain \\u003cmethod>.");

    const imported = await endpoint.init({
      method: "POST",
      searchParams: new URLSearchParams(),
      data: { id: task.id, answer: "Imported answer" },
    });
    expect(imported[0]).toBe(200);
    expect(onImport).toHaveBeenCalledWith({ answer: "Imported answer" });
  });

  it("accepts authenticated Web Agent status and answer callbacks", async () => {
    const onImport = vi.fn();
    const onStatus = vi.fn();
    const onProgress = vi.fn();
    registerWebPromptHub();
    const task = createWebPromptTask({
      provider: "deepseek",
      prompt: "Explain the method.",
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

    const unauthorized = await endpoint.init({
      headers: { authorization: "Bearer wrong" },
      method: "POST",
      searchParams: new URLSearchParams(),
      data: { id: task.id, state: "generating" },
    });
    expect(unauthorized[0]).toBe(401);

    const generating = await endpoint.init({
      headers: { authorization: "Bearer test-token" },
      method: "POST",
      searchParams: new URLSearchParams(),
      data: { id: task.id, state: "generating" },
    });
    expect(generating[0]).toBe(200);
    expect(onStatus).toHaveBeenCalledWith("generating", undefined);

    const progress = await endpoint.init({
      headers: { authorization: "Bearer test-token" },
      method: "POST",
      searchParams: new URLSearchParams(),
      data: {
        id: task.id,
        state: "generating",
        answer: "Partial DeepSeek answer",
        reasoning: "Partial DeepSeek reasoning",
      },
    });
    expect(progress[0]).toBe(200);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        answer: "Partial DeepSeek answer",
        reasoning: "Partial DeepSeek reasoning",
      }),
    );

    const uploading = await endpoint.init({
      headers: { authorization: "Bearer test-token" },
      method: "POST",
      searchParams: new URLSearchParams(),
      data: { id: task.id, state: "uploading_attachment" },
    });
    expect(uploading[0]).toBe(200);
    expect(onStatus).toHaveBeenCalledWith("uploading_attachment", undefined);

    const completed = await endpoint.init({
      headers: { authorization: "Bearer test-token" },
      method: "POST",
      searchParams: new URLSearchParams(),
      data: {
        id: task.id,
        state: "completed",
        answer: "DeepSeek answer",
        reasoning: "DeepSeek reasoning",
      },
    });
    expect(completed[0]).toBe(200);
    expect(onImport).toHaveBeenCalledWith(
      expect.objectContaining({
        answer: "DeepSeek answer",
        reasoning: "DeepSeek reasoning",
      }),
    );
    expect(onStatus).not.toHaveBeenCalledWith("completed", undefined);
  });

  it("offers Kimi on the manual Web Prompt Hub page", async () => {
    registerWebPromptHub();
    const task = createWebPromptTask({
      provider: "kimi",
      prompt: "Hello Kimi",
      sourceLabel: "Paper · Conversation 1",
      onImport: vi.fn(),
    });
    const Endpoint = Zotero.Server.Endpoints[
      "/zai/web-prompt-hub"
    ] as new () => {
      init(options: unknown): Promise<[number, string, string]>;
    };
    const page = await new Endpoint().init({
      method: "GET",
      searchParams: new URLSearchParams({ id: task.id }),
      data: null,
    });
    expect(page[2]).toContain('kimi:"Kimi Web"');
    expect(page[2]).toContain('kimi:"https://www.kimi.com/"');
  });

  it("forwards the abnormal page-content marker to the importer", async () => {
    const onImport = vi.fn();
    registerWebPromptHub();
    const task = createWebPromptTask({
      provider: "chatglm",
      prompt: "Explain the method.",
      sourceLabel: "Paper · Conversation 1",
      onImport,
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
      data: {
        id: task.id,
        state: "completed",
        answer: "本次回答已被终止",
        pageNotice: true,
      },
    });

    expect(completed[0]).toBe(200);
    expect(onImport).toHaveBeenCalledWith(
      expect.objectContaining({
        answer: "本次回答已被终止",
        pageNotice: true,
      }),
    );
  });
});
