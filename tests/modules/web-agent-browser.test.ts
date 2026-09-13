import { describe, it, expect, vi } from "vitest";
import {
  getWebAgentBrowsers,
  addWebAgentBrowser,
  detectWebAgentBrowser,
  selectWebAgentBrowser,
  webAgentBrowserCandidates,
  type WebAgentInstallerHost,
} from "../../src/modules/web-agent-installer";

function fixture() {
  const files = new Map<string, string>([
    ["/usr/bin/google-chrome", ""],
    ["/usr/bin/microsoft-edge", ""],
    [
      "/data/zai-web-agent-config.json",
      JSON.stringify({
        token: "test",
        nodePath: "/node",
        chromePath: "/usr/bin/google-chrome",
        agentScript: "/agent.mjs",
        profileDir: "/legacy-profile",
        port: 1234,
        callbackUrl: "http://localhost/callback",
        needsRuntimeUpdate: false,
      }),
    ],
  ]);
  const host = {
    platform: "linux",
    homeDir: "/home/a",
    profileDir: "/profile",
    dataDir: "/data",
    env: {},
    exists: async (p: string) => files.has(p),
    readUTF8: async (p: string) => files.get(p)!,
    writeUTF8: async (p: string, v: string) => {
      files.set(p, v);
    },
    randomToken: () => "abc123",
    makeDirectory: vi.fn(),
    setPermissions: vi.fn(async () => {}),
    health: vi.fn(async () => null),
    stop: vi.fn(async () => true),
    delay: vi.fn(),
  } as unknown as WebAgentInstallerHost;
  return { host, files };
}

describe("WEB browser choice", () => {
  it("discovers Edge on all supported platforms", () => {
    expect(
      webAgentBrowserCandidates(
        { platform: "linux", homeDir: "/a", env: {} },
        "edge",
      ),
    ).toContain("/usr/bin/microsoft-edge");
    expect(
      webAgentBrowserCandidates(
        { platform: "darwin", homeDir: "/a", env: {} },
        "edge",
      ),
    ).toContain(
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    );
    expect(
      webAgentBrowserCandidates(
        {
          platform: "win32",
          homeDir: "C:\\Users\\A",
          env: { ProgramFiles: "C:\\Program Files" },
        },
        "edge",
      ),
    ).toContain("C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe");
  });
  it("preserves legacy Chrome and its profile when switching back from Edge", async () => {
    const { host, files } = fixture();
    expect((await getWebAgentBrowsers(host)).selected).toBe("chrome");
    await selectWebAgentBrowser("edge", host);
    let config = JSON.parse(files.get("/data/zai-web-agent-config.json")!);
    expect(config.chromePath).toBe("/usr/bin/microsoft-edge");
    expect(config.profileDir).not.toBe("/legacy-profile");
    expect(config.token).toBe("test");
    await selectWebAgentBrowser("chrome", host);
    config = JSON.parse(files.get("/data/zai-web-agent-config.json")!);
    expect(config.profileDir).toBe("/legacy-profile");
  });
  it("does not change configuration when Edge is missing", async () => {
    const { host, files } = fixture();
    files.delete("/usr/bin/microsoft-edge");
    const before = files.get("/data/zai-web-agent-config.json");
    await expect(selectWebAgentBrowser("edge", host)).rejects.toThrow(
      "Microsoft Edge",
    );
    expect(files.get("/data/zai-web-agent-config.json")).toBe(before);
  });
  it("refuses to switch while WEB tasks are active", async () => {
    const { host } = fixture();
    vi.mocked(host.health).mockResolvedValue({
      ok: true,
      active: { deepseek: "task" },
    } as any);
    await expect(selectWebAgentBrowser("edge", host)).rejects.toThrow("任务");
    expect(host.stop).not.toHaveBeenCalled();
  });
  it("updates a custom path on the same browser and preserves it across switches", async () => {
    const { host, files } = fixture();
    files.set("/custom/chrome", "");
    await selectWebAgentBrowser("chrome", host, '"/custom/chrome"');
    expect(JSON.parse(files.get("/data/zai-web-agent-config.json")!).chromePath).toBe("/custom/chrome");
    await selectWebAgentBrowser("edge", host);
    await selectWebAgentBrowser("chrome", host);
    expect(JSON.parse(files.get("/data/zai-web-agent-config.json")!).chromePath).toBe("/custom/chrome");
    await selectWebAgentBrowser("chrome", host, "");
    expect(JSON.parse(files.get("/data/zai-web-agent-config.json")!).chromePath).toBe("/usr/bin/google-chrome");
  });
  it("rejects an invalid custom path without modifying settings", async () => {
    const { host, files } = fixture();
    const before = new Map(files);
    await expect(selectWebAgentBrowser("edge", host, "/missing/edge")).rejects.toThrow("路径不存在");
    expect(files).toEqual(before);
  });
  it("refuses a same-browser path change while tasks are running", async () => {
    const { host, files } = fixture();
    files.set("/custom/chrome", "");
    vi.mocked(host.health).mockResolvedValue({ ok: true, queued: { deepseek: 1 } } as any);
    await expect(selectWebAgentBrowser("chrome", host, "/custom/chrome")).rejects.toThrow("任务");
    expect(files.has("/data/zai-web-browser-chrome-path.txt")).toBe(false);
  });
  it("keeps a custom path before the first runtime installation", async () => {
    const { host, files } = fixture();
    files.delete("/data/zai-web-agent-config.json");
    files.delete("/usr/bin/microsoft-edge");
    files.set("/portable/edge", "");
    await selectWebAgentBrowser("edge", host, "/portable/edge");
    expect((await getWebAgentBrowsers(host)).available.find(x => x.browser === "edge")?.path).toBe("/portable/edge");
  });
  it("saves a user browser with its own identity, path and login profile", async () => {
    const { host, files } = fixture();
    files.set("/portable/browser", "");
    await addWebAgentBrowser("User browser", "/portable/browser", host);
    const choices = await getWebAgentBrowsers(host);
    const entry = choices.available.find(entry => entry.name === "User browser")!;
    expect(choices.selected).toBe(entry.browser);
    expect(entry.path).toBe("/portable/browser");
    const config = JSON.parse(files.get("/data/zai-web-agent-config.json")!);
    expect(config.chromePath).toBe("/portable/browser");
    expect(config.profileDir).not.toBe("/legacy-profile");
    await selectWebAgentBrowser("chrome", host);
    await selectWebAgentBrowser(entry.browser, host);
    expect(JSON.parse(files.get("/data/zai-web-agent-config.json")!).profileDir).toBe(config.profileDir);
  });
  it("persists a custom browser before installing the runtime", async () => {
    const { host, files } = fixture();
    files.delete("/data/zai-web-agent-config.json");
    files.set("/portable/browser", "");
    await addWebAgentBrowser("User browser", "/portable/browser", host);
    expect((await getWebAgentBrowsers(host)).selected).toBe("custom-abc123");
  });
  it("does not save invalid or busy custom-browser additions", async () => {
    const { host, files } = fixture();
    await expect(addWebAgentBrowser("", "/browser", host)).rejects.toThrow("名称");
    await expect(addWebAgentBrowser("User", "/missing", host)).rejects.toThrow("路径不存在");
    files.set("/browser", "");
    vi.mocked(host.health).mockResolvedValue({ ok: true, active: { deepseek: "task" } } as any);
    await expect(addWebAgentBrowser("User", "/browser", host)).rejects.toThrow("任务");
    expect(files.has("/data/zai-web-custom-browsers.json")).toBe(false);
  });
  it("redetects Edge ignoring the saved mistaken path without changing configuration", async () => {
    const { host, files } = fixture();
    files.set("/wrong/file.txt", "");
    await selectWebAgentBrowser("edge", host, "/wrong/file.txt");
    const before = new Map(files);
    expect(await detectWebAgentBrowser("edge", host)).toBe("/usr/bin/microsoft-edge");
    expect(files).toEqual(before);
    await selectWebAgentBrowser("edge", host, "");
    expect(JSON.parse(files.get("/data/zai-web-agent-config.json")!).chromePath).toBe("/usr/bin/microsoft-edge");
  });
  it("selects Edge for a new installation with only Edge available", async () => {
    const { host, files } = fixture();
    files.delete("/usr/bin/google-chrome");
    files.delete("/data/zai-web-agent-config.json");
    expect((await getWebAgentBrowsers(host)).selected).toBe("edge");
    await selectWebAgentBrowser("edge", host);
    expect((await getWebAgentBrowsers(host)).selected).toBe("edge");
  });
});
