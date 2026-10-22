import { afterEach, describe, expect, it, vi } from "vitest";
import { readWebAgentHealth, type WebAgentConfig } from "../../src/modules/web-agent-client";
import { createZoteroWebAgentInstallerHost } from "../../src/modules/web-agent-installer";

afterEach(() => vi.unstubAllGlobals());

describe("Web Agent timers in the Zotero sandbox", () => {
  function sandbox() {
    const timer = { setTimeout: vi.fn(() => 42), clearTimeout: vi.fn() };
    vi.stubGlobal("ChromeUtils", { importESModule: vi.fn(() => timer) });
    vi.stubGlobal("setTimeout", () => { throw new Error("NS_ERROR_NOT_INITIALIZED"); });
    vi.stubGlobal("clearTimeout", () => { throw new Error("NS_ERROR_NOT_INITIALIZED"); });
    return timer;
  }

  it("reads a running Agent's health even when sandbox timers are uninitialized", async () => {
    const timer = sandbox();
    const health = { ok: true, protocolVersion: 26, service: "zotero-ai-sidebar-web-agent", instanceId: "fixture" };
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => health }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await readWebAgentHealth({ port: 1234, token: "fixture", instanceId: "fixture" } as WebAgentConfig)).toEqual(health);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(timer.clearTimeout).toHaveBeenCalledWith(42);
  });

  it("downloads the runtime using Gecko timers and clears the timeout", async () => {
    const timer = sandbox();
    vi.stubGlobal("Zotero", { isLinux: true, DataDirectory: { dir: "/data" }, Profile: { dir: "/profile" } });
    vi.stubGlobal("Services", { dirsvc: { get: () => ({ path: "/home/user" }) } });
    vi.stubGlobal("Ci", { nsIFile: {}, nsIEnvironment: {} });
    vi.stubGlobal("Cc", { "@mozilla.org/process/environment;1": { getService: () => ({ get: () => "" }) } });
    vi.stubGlobal("IOUtils", {});
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer })));
    expect(await createZoteroWebAgentInstallerHost().fetchRuntimeArchive("https://example.invalid/runtime.zip")).toEqual(new Uint8Array([1, 2]));
    expect(timer.clearTimeout).toHaveBeenCalledWith(42);
  });
});
