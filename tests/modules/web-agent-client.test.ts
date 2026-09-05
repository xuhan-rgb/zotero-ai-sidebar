import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearWebAgentConfigCache,
  dispatchWebAgentTask,
  hideWebAccount,
  loadWebAgentConfig,
  openWebAccount,
  stopWebAgent,
  webAgentProtocolStatus,
} from "../../src/modules/web-agent-client";

afterEach(() => {
  clearWebAgentConfigCache();
  vi.unstubAllGlobals();
});

describe("Web Agent protocol health", () => {
  it("explains website verification and does not dispatch an unready account", async () => {
    vi.stubGlobal("Zotero", { DataDirectory: { dir: "/data" } });
    vi.stubGlobal("IOUtils", {
      readUTF8: async () =>
        JSON.stringify({
          instanceId: "fixture",
          token: "token",
          nodePath: "/node",
          chromePath: "/chrome",
          agentScript: "/agent.mjs",
          profileDir: "/profile",
          port: 23120,
          callbackUrl: "http://127.0.0.1:23119/callback",
          needsRuntimeUpdate: false,
        }),
    });
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        json: async () =>
          url.endsWith("/health")
            ? {
                ok: true,
                protocolVersion: 24,
                service: "zotero-ai-sidebar-web-agent",
                instanceId: "fixture",
              }
            : {
                ok: true,
                configured: false,
                browserOpen: true,
                verificationRequired: true,
              },
      };
    });
    await expect(
      dispatchWebAgentTask({
        id: "glm-verification",
        provider: "chatglm",
        sessionKey: "glm",
        prompt: "test",
        continuationPrompt: "test",
        paperUrl: "",
        hideBrowser: true,
      }),
    ).rejects.toThrow("网站要求访问验证");
    expect(requests.some((url) => url.endsWith("/tasks"))).toBe(false);
  });

  it.each([true, undefined])(
    "uses the saved update result to block an unapproved package without a ZIP check or network request (%s)",
    async (needsRuntimeUpdate) => {
      vi.stubGlobal("Zotero", { DataDirectory: { dir: "/data" } });
      vi.stubGlobal("IOUtils", {
        readUTF8: async () =>
          JSON.stringify({
            token: "token",
            nodePath: "/node",
            chromePath: "/chrome",
            agentScript: "/agent.mjs",
            profileDir: "/profile",
            port: 23120,
            callbackUrl: "http://127.0.0.1:23119/callback",
            needsRuntimeUpdate,
          }),
      });
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          version: "0.1.0",
          protocolVersion: 24,
          runtimeVersion: "0.8.6",
          configured: true,
        }),
      }));
      vi.stubGlobal("fetch", fetchMock);
      await expect(openWebAccount("deepseek")).rejects.toThrow("配套运行包");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([401, 200])(
    "checks legacy token enforcement before shutdown (unauthenticated HTTP %s)",
    async (status) => {
      const config = { token: "private-token", port: 41357 } as Awaited<
        ReturnType<typeof loadWebAgentConfig>
      >;
      const fetchMock = vi.fn(async (url: string, options: RequestInit) => {
        const authenticated = new Headers(options.headers).has("authorization");
        return {
          ok: authenticated || status === 200,
          status: url.endsWith("/shutdown")
            ? 202
            : authenticated
              ? 200
              : status,
          json: async () => ({
            ok: true,
            version: "0.1.0",
            protocolVersion: 24,
            runtimeVersion: null,
          }),
        };
      });
      vi.stubGlobal("fetch", fetchMock);
      await expect(stopWebAgent(config)).resolves.toBe(status === 401);
      expect(
        fetchMock.mock.calls.filter(([url]) => url.endsWith("/shutdown")),
      ).toHaveLength(status === 401 ? 1 : 0);
    },
  );

  it.each(["ours", "foreign", "old-instance"])(
    "only stops the Agent matching the saved identity (%s)",
    async (service) => {
      const config = {
        token: "private-token",
        instanceId: "our-instance",
        port: 41357,
      } as Awaited<ReturnType<typeof loadWebAgentConfig>>;
      const fetchMock = vi.fn(async (url: string) => ({
        ok: true,
        status: url.endsWith("/shutdown") ? 202 : 200,
        json: async () =>
          service === "foreign"
            ? { ok: true }
            : {
                ok: true,
                protocolVersion: 24,
                service: "zotero-ai-sidebar-web-agent",
                instanceId:
                  service === "ours" ? config.instanceId : "another-instance",
              },
      }));
      vi.stubGlobal("fetch", fetchMock);
      await expect(stopWebAgent(config)).resolves.toBe(service === "ours");
      expect(
        fetchMock.mock.calls.filter(([url]) => url.endsWith("/shutdown")),
      ).toHaveLength(service === "ours" ? 1 : 0);
    },
  );

  it.each([404, 200, 401])(
    "opens accounts on the published port when the old port serves HTTP %s from another plugin",
    async (status) => {
      let savedConfig = {
        needsRuntimeUpdate: false,
        token: "test-token",
        nodePath: "/node",
        chromePath: "/chrome",
        agentScript: "/agent.mjs",
        profileDir: "/profile",
        port: 23120,
        cdpPort: 9224,
        instanceId: "previous-instance",
        callbackUrl: "http://127.0.0.1:23119/callback",
      };
      const exec = vi.fn(async (_path: string, args: string[]) => {
        savedConfig = { ...savedConfig, port: 41357, instanceId: args[2] };
        return true;
      });
      vi.stubGlobal("Zotero", {
        DataDirectory: { dir: "/zotero-data" },
        Utilities: { Internal: { exec } },
      });
      vi.stubGlobal("IOUtils", {
        readUTF8: async () => JSON.stringify(savedConfig),
      });
      const fetchMock = vi.fn(async (url: string) => {
        const address = new URL(url);
        if (address.port === "23120")
          return {
            ok: status === 200,
            status,
            json: async () => ({ ok: true }),
          };
        return {
          ok: true,
          json: async () =>
            address.pathname === "/health"
              ? {
                  ok: true,
                  protocolVersion: 24,
                  service: "zotero-ai-sidebar-web-agent",
                  instanceId: savedConfig.instanceId,
                }
              : {
                  ok: true,
                  provider: "deepseek",
                  browserOpen: true,
                  configured: true,
                },
        };
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        Promise.all([openWebAccount("deepseek"), openWebAccount("deepseek")]),
      ).resolves.toEqual([
        expect.objectContaining({ configured: true }),
        expect.objectContaining({ configured: true }),
      ]);
      expect(exec).toHaveBeenCalledOnce();
      await expect(loadWebAgentConfig()).resolves.toMatchObject({
        port: 41357,
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:41357/browser/open",
        expect.objectContaining({ method: "POST" }),
      );
      expect(
        fetchMock.mock.calls
          .filter(([url]) => url.includes(":23120/"))
          .every(([url]) => url.endsWith("/health")),
      ).toBe(true);
    },
  );

  it("reads the config with native Windows path separators", async () => {
    const readUTF8 = vi.fn(async () =>
      JSON.stringify({
        needsRuntimeUpdate: false,
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
          needsRuntimeUpdate: false,
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
        json: async () => ({
          ok: true,
          protocolVersion: 24,
          runtimeVersion: "0.8.6",
          version: "0.1.0",
        }),
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
