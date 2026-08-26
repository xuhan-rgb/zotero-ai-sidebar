import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearWebAgentConfigCache,
  hideWebAccount,
  loadWebAgentConfig,
  webAgentProtocolStatus,
} from "../../src/modules/web-agent-client";

afterEach(() => {
  clearWebAgentConfigCache();
  vi.unstubAllGlobals();
});

describe("Web Agent protocol health", () => {
  it("reads the config with native Windows path separators", async () => {
    const readUTF8 = vi.fn(async () =>
      JSON.stringify({
        token: "test-token",
        nodePath: "C:\\Program Files\\nodejs\\node.exe",
        chromePath:
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        agentScript: "C:\\runtime\\agent.mjs",
        profileDir: "C:\\profile",
        port: 23120,
        callbackUrl: "http://127.0.0.1:23119/callback",
      }),
    );
    vi.stubGlobal("Zotero", {
      isWin: true,
      DataDirectory: { dir: "C:\\Users\\admin\\Zotero" },
    });
    vi.stubGlobal("IOUtils", { readUTF8 });

    await expect(loadWebAgentConfig()).resolves.toMatchObject({ port: 23120 });
    expect(readUTF8).toHaveBeenCalledWith(
      "C:\\Users\\admin\\Zotero\\zai-web-agent-config.json",
    );
  });

  it("distinguishes the current agent from a stale running process", () => {
    expect(webAgentProtocolStatus({ ok: true, protocolVersion: 24 })).toBe(
      "current",
    );
    expect(webAgentProtocolStatus({ ok: true, protocolVersion: 23 })).toBe(
      "stale",
    );
    expect(webAgentProtocolStatus({ ok: true, protocolVersion: 1 })).toBe(
      "stale",
    );
    expect(webAgentProtocolStatus({ ok: true })).toBe("stale");
    expect(webAgentProtocolStatus(null)).toBe("offline");
  });

  it("sends an authenticated hide request when account configuration closes", async () => {
    vi.stubGlobal("Zotero", { DataDirectory: { dir: "/zotero-data" } });
    vi.stubGlobal("IOUtils", {
      readUTF8: vi.fn(async () =>
        JSON.stringify({
          token: "test-token",
          nodePath: "/node",
          chromePath: "/chrome",
          agentScript: "/agent.mjs",
          profileDir: "/profile",
          port: 23120,
          callbackUrl: "http://127.0.0.1:23119/callback",
        }),
      ),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, protocolVersion: 24 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          provider: "deepseek",
          browserOpen: true,
          configured: true,
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(hideWebAccount("deepseek")).resolves.toMatchObject({
      configured: true,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:23120/browser/hide",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ provider: "deepseek" }),
      }),
    );
  });
});
