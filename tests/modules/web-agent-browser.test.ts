import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  getWebAgentBrowsers,
  addWebAgentBrowser,
  removeWebAgentBrowser,
  detectWebAgentBrowser,
  selectWebAgentBrowser,
  webAgentBrowserCandidates,
  inspectWebAgentInstallation,
  type WebAgentInstallerHost,
} from "../../src/modules/web-agent-installer";

beforeEach(() => {
  vi.stubGlobal("Cc", {
    "@mozilla.org/intl/ospreferences;1": {
      getService: () => ({ systemLocales: ["zh-CN"] }),
    },
  });
  vi.stubGlobal("Ci", { mozIOSPreferences: {} });
});
afterEach(() => vi.unstubAllGlobals());

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
    sha256: async (value: Uint8Array) => createHash("sha256").update(value).digest("hex"),
  } as unknown as WebAgentInstallerHost;
  return { host, files };
}

describe("WEB browser choice", () => {
  it("reuses the signed-in profile when switching from a custom Firefox alias to built-in Firefox", async () => {
    const { host, files } = fixture();
    files.set("/usr/bin/firefox", "");
    await addWebAgentBrowser("firefox", "/usr/bin/firefox", host);
    const existingProfile = JSON.parse(files.get("/data/zai-web-agent-config.json")!).profileDir;
    await selectWebAgentBrowser("firefox", host);
    expect(JSON.parse(files.get("/data/zai-web-agent-config.json")!).profileDir).toBe(existingProfile);
  });

  it("keeps the Firefox program and login profile when removing its duplicate custom entry", async () => {
    const { host, files } = fixture();
    files.set("/usr/bin/firefox", "");
    await addWebAgentBrowser("firefox", "/usr/bin/firefox", host);
    const profile = JSON.parse(files.get("/data/zai-web-agent-config.json")!).profileDir;
    await removeWebAgentBrowser("custom-abc123", host);
    const updated = JSON.parse(files.get("/data/zai-web-agent-config.json")!);
    expect(updated.browser).toBe("firefox");
    expect(updated.chromePath).toBe("/usr/bin/firefox");
    expect(updated.profileDir).toBe(profile);
  });

  it("keeps a newly added custom Firefox profile separate from the built-in profile", async () => {
    const { host, files } = fixture();
    files.set("/usr/bin/firefox", "");
    await selectWebAgentBrowser("firefox", host);
    const originalProfile = JSON.parse(files.get("/data/zai-web-agent-config.json")!).profileDir;
    await addWebAgentBrowser("Separate Firefox", "/usr/bin/firefox", host);
    expect(JSON.parse(files.get("/data/zai-web-agent-config.json")!).profileDir).not.toBe(originalProfile);
  });

  it("removes an inactive custom entry without changing the active browser or its files", async () => {
    const { host, files } = fixture();
    files.set("/portable/browser", "browser-binary");
    await addWebAgentBrowser("User browser", "/portable/browser", host);
    await selectWebAgentBrowser("chrome", host);
    const config = files.get("/data/zai-web-agent-config.json");
    vi.mocked(host.health).mockResolvedValue({ ok: true, active: { deepseek: "task" } } as any);
    await removeWebAgentBrowser("custom-abc123", host);
    expect((await getWebAgentBrowsers(host)).available.some(x => x.browser === "custom-abc123")).toBe(false);
    expect(files.get("/data/zai-web-agent-config.json")).toBe(config);
    expect(files.get("/portable/browser")).toBe("browser-binary");
  });

  it("switches to an available browser when removing the selected custom browser", async () => {
    const { host, files } = fixture();
    files.set("/portable/browser", "");
    await addWebAgentBrowser("User browser", "/portable/browser", host);
    const profileDir = JSON.parse(files.get("/data/zai-web-agent-config.json")!).profileDir;
    files.set(profileDir + "/cookies.sqlite", "login-data");
    await removeWebAgentBrowser("custom-abc123", host);
    expect((await getWebAgentBrowsers(host)).selected).toBe("chrome");
    expect(files.get("/data/zai-web-browser.txt")).toBe("chrome");
    expect(files.get(profileDir + "/cookies.sqlite")).toBe("login-data");
  });

  it("blocks removal of the selected custom browser while tasks are queued", async () => {
    const { host, files } = fixture();
    files.set("/portable/browser", "");
    await addWebAgentBrowser("User browser", "/portable/browser", host);
    const before = new Map(files);
    vi.mocked(host.health).mockResolvedValue({ ok: true, queued: { deepseek: 1 } } as any);
    await expect(removeWebAgentBrowser("custom-abc123", host)).rejects.toThrow("任务");
    expect(files).toEqual(before);
  });

  it("protects built-in browsers from removal", async () => {
    const { host, files } = fixture();
    const before = new Map(files);
    for (const browser of ["chrome", "edge", "firefox"])
      await expect(removeWebAgentBrowser(browser, host)).rejects.toThrow("自定义");
    expect(files).toEqual(before);
  });

  it("keeps the selected entry when no replacement browser is available", async () => {
    const { host, files } = fixture();
    files.set("/portable/browser", "");
    await addWebAgentBrowser("User browser", "/portable/browser", host);
    files.delete("/usr/bin/google-chrome");
    files.delete("/usr/bin/microsoft-edge");
    const before = new Map(files);
    await expect(removeWebAgentBrowser("custom-abc123", host)).rejects.toThrow("其他可用浏览器");
    expect(files).toEqual(before);
  });

  it("updates the selected preference when removing an entry before runtime installation", async () => {
    const { host, files } = fixture();
    files.delete("/data/zai-web-agent-config.json");
    files.set("/portable/browser", "");
    await addWebAgentBrowser("User browser", "/portable/browser", host);
    await removeWebAgentBrowser("custom-abc123", host);
    expect((await getWebAgentBrowsers(host)).selected).toBe("chrome");
    expect(files.get("/data/zai-web-browser.txt")).toBe("chrome");
  });

  it("uses the current user's native Firefox instead of a missing saved path", async () => {
    const { host, files } = fixture();
    host.homeDir = "/home/another-user";
    const native = "/home/another-user/.local/opt/firefox/firefox";
    files.set(native, "");
    files.set("/data/zai-web-browser-firefox-path.txt", "/home/old-user/.local/opt/firefox/firefox");
    const entry = (await getWebAgentBrowsers(host)).available.find(x => x.browser === "firefox")!;
    expect(entry.path).toBe(native);
    expect(entry.customPath).toBe(native);
  });

  it("skips the Ubuntu Snap launcher when a native Firefox is installed", async () => {
    const { host, files } = fixture();
    files.set("/usr/bin/firefox", "#!/bin/sh\nexec /snap/bin/firefox \"$@\"\n");
    files.set("/opt/firefox/firefox", "");
    expect(await detectWebAgentBrowser("firefox", host)).toBe("/opt/firefox/firefox");
  });

  it("accepts Snap Firefox and assigns a stable profile under the current user's Snap common directory", async () => {
    const { host, files } = fixture();
    files.set("/usr/bin/firefox", "#!/bin/sh\nexec /snap/bin/firefox \"$@\"\n");
    files.set("/snap/bin/firefox", "");
    expect(await detectWebAgentBrowser("firefox", host)).toBe("/usr/bin/firefox");
    await selectWebAgentBrowser("firefox", host, "/usr/bin/firefox");
    const config = JSON.parse(files.get("/data/zai-web-agent-config.json")!);
    expect(config.firefoxSnap).toBe(true);
    expect(config.profileDir).toMatch(/^\/home\/a\/snap\/firefox\/common\/zotero-ai-sidebar\//);
    await selectWebAgentBrowser("chrome", host);
    await selectWebAgentBrowser("firefox", host);
    expect(JSON.parse(files.get("/data/zai-web-agent-config.json")!).profileDir).toBe(config.profileDir);
  });

  it("repairs an old Snap Firefox configuration whose profile is inside the hidden Zotero directory", async () => {
    const { host, files } = fixture();
    const config = JSON.parse(files.get("/data/zai-web-agent-config.json")!);
    files.set("/data/zai-web-agent-config.json", JSON.stringify({ ...config, browser: "firefox", chromePath: "/usr/bin/firefox" }));
    files.set("/usr/bin/firefox", "#!/bin/sh\nexec /snap/bin/firefox \"$@\"\n");
    files.set("/node", "");
    files.set("/usr/bin/xclip", "");
    host.probeNodeVersion = async () => "v24.0.0";
    const report = await inspectWebAgentInstallation(host);
    expect(report.state).not.toBe("blocked");
    expect(report.missing).not.toContain("Firefox");
    const updated = JSON.parse(files.get("/data/zai-web-agent-config.json")!);
    expect(updated.firefoxSnap).toBe(true);
    expect(updated.profileDir).toMatch(/^\/home\/a\/snap\/firefox\/common\//);
  });

  it("detects usable Firefox on a fresh computer with only Snap Firefox", async () => {
    const { host, files } = fixture();
    files.delete("/data/zai-web-agent-config.json");
    files.delete("/usr/bin/google-chrome");
    files.delete("/usr/bin/microsoft-edge");
    files.set("/snap/bin/firefox", "");
    const choices = await getWebAgentBrowsers(host);
    expect(choices.selected).toBe("firefox");
    expect(choices.available.find(x => x.browser === "firefox")).toMatchObject({ path: "/snap/bin/firefox", firefoxSnap: true });
  });

  it("keeps native and Snap Firefox profiles separate when switching installation types", async () => {
    const { host, files } = fixture();
    files.set("/opt/firefox/firefox", "");
    files.set("/snap/bin/firefox", "");
    await selectWebAgentBrowser("firefox", host, "/opt/firefox/firefox");
    const native = JSON.parse(files.get("/data/zai-web-agent-config.json")!).profileDir;
    await selectWebAgentBrowser("firefox", host, "/snap/bin/firefox");
    const snap = JSON.parse(files.get("/data/zai-web-agent-config.json")!).profileDir;
    expect(snap).not.toBe(native);
    expect((await getWebAgentBrowsers(host)).available.find(entry => entry.browser === "firefox")).toMatchObject({ path: "/snap/bin/firefox", firefoxSnap: true });
    await selectWebAgentBrowser("firefox", host, "/opt/firefox/firefox");
    expect(JSON.parse(files.get("/data/zai-web-agent-config.json")!).profileDir).toBe(native);
    await selectWebAgentBrowser("firefox", host, "/snap/bin/firefox");
    expect(JSON.parse(files.get("/data/zai-web-agent-config.json")!).profileDir).toBe(snap);
  });

  it("keeps valid existing Firefox profiles when applying a local executable", async () => {
    const { host, files } = fixture();
    const config = JSON.parse(files.get("/data/zai-web-agent-config.json")!);
    files.set("/data/zai-web-agent-config.json", JSON.stringify({ ...config, browser: "firefox", chromePath: "/usr/bin/firefox", profileDir: "/existing/custom/firefox-profile" }));
    files.set("/usr/bin/firefox", "");
    files.set("/existing/custom/firefox-profile", "");
    await selectWebAgentBrowser("firefox", host);
    expect(JSON.parse(files.get("/data/zai-web-agent-config.json")!).profileDir).toBe("/existing/custom/firefox-profile");
  });

  it("builds per-user Firefox candidates from Windows and macOS environment directories", () => {
    expect(webAgentBrowserCandidates({ platform: "win32", homeDir: "D:\\Users\\New", env: { LOCALAPPDATA: "D:\\Users\\New\\AppData\\Local" } }, "firefox"))
      .toContain("D:\\Users\\New\\AppData\\Local\\Mozilla Firefox\\firefox.exe");
    expect(webAgentBrowserCandidates({ platform: "darwin", homeDir: "/Users/new-user", env: {} }, "firefox"))
      .toContain("/Users/new-user/Applications/Firefox.app/Contents/MacOS/firefox");
  });

  it("redetects custom Firefox and relocates a missing profile from another computer", async () => {
    const { host, files } = fixture();
    host.homeDir = "/home/new-user";
    host.profileDir = "/home/new-user/.zotero/new-profile";
    const native = "/home/new-user/.local/opt/firefox/firefox";
    files.set(native, "");
    files.set("/node", "");
    files.set("/usr/bin/xclip", "");
    files.set("/agent.mjs", "");
    host.probeNodeVersion = async () => "v24.0.0";
    const configPath = "/data/zai-web-agent-config.json";
    const config = JSON.parse(files.get(configPath)!);
    Object.assign(config, {
      browser: "custom-firefox", chromePath: "/home/old-user/firefox/firefox",
      profileDir: "/home/old-user/.zotero/old-profile/browser-profile",
    });
    files.set(configPath, JSON.stringify(config));
    files.set("/data/zai-web-custom-browsers.json", JSON.stringify([
      { browser: "custom-firefox", name: "Firefox", customPath: config.chromePath },
    ]));
    vi.mocked(host.health).mockResolvedValue({ ok: true, protocolVersion: 26 });
    vi.mocked(host.health).mockResolvedValueOnce(null);
    await inspectWebAgentInstallation(host);
    const updated = JSON.parse(files.get(configPath)!);
    expect(updated.chromePath).toBe(native);
    expect(updated.profileDir).toBe("/home/new-user/.zotero/new-profile/zai-web-agent/browser-profile-custom-firefox");
    expect(updated.token).toBe("test");
    expect(JSON.parse(files.get("/data/zai-web-custom-browsers.json")!)[0].customPath).toBe(native);
  });

  it("discovers Firefox and keeps its login profile separate from Chrome", async () => {
    const { host, files } = fixture();
    files.set("/usr/bin/firefox", "");
    expect(await detectWebAgentBrowser("firefox", host)).toBe("/usr/bin/firefox");
    await selectWebAgentBrowser("firefox", host);
    const config = JSON.parse(files.get("/data/zai-web-agent-config.json")!);
    expect(config.browser).toBe("firefox");
    expect(config.chromePath).toBe("/usr/bin/firefox");
    expect(config.profileDir).not.toBe("/legacy-profile");
    expect((await getWebAgentBrowsers(host)).selected).toBe("firefox");
    await selectWebAgentBrowser("chrome", host);
    expect(JSON.parse(files.get("/data/zai-web-agent-config.json")!).profileDir).toBe("/legacy-profile");
  });

  it("finds Firefox on Windows and macOS", () => {
    expect(webAgentBrowserCandidates({ platform: "win32", homeDir: "C:\\Users\\A", env: { ProgramFiles: "C:\\Program Files" } }, "firefox"))
      .toContain("C:\\Program Files\\Mozilla Firefox\\firefox.exe");
    expect(webAgentBrowserCandidates({ platform: "darwin", homeDir: "/a", env: {} }, "firefox"))
      .toContain("/Applications/Firefox.app/Contents/MacOS/firefox");
  });

  it("selects Firefox automatically when it is the only installed browser", async () => {
    const { host, files } = fixture();
    files.delete("/data/zai-web-agent-config.json");
    files.delete("/usr/bin/google-chrome");
    files.delete("/usr/bin/microsoft-edge");
    files.set("/usr/bin/firefox", "");
    expect((await getWebAgentBrowsers(host)).selected).toBe("firefox");
  });

  it("does not change configuration when Firefox is missing", async () => {
    const { host, files } = fixture();
    const before = new Map(files);
    await expect(selectWebAgentBrowser("firefox", host)).rejects.toThrow("Firefox");
    expect(files).toEqual(before);
  });

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
