import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  inspectWebAgentInstallation,
  selectWebAgentNode,
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
    ["/usr/bin/node", ""],
    ["/usr/bin/google-chrome", ""],
    ["/usr/bin/xclip", ""],
  ]);
  const versions = new Map([["/usr/bin/node", "v12.22.9"]]);
  const children = new Map<string, string[]>();
  const host = {
    platform: "linux",
    homeDir: "/home/ashed",
    profileDir: "/profile",
    dataDir: "/data",
    env: { PATH: "/usr/bin:/bin" },
    exists: async (p: string) => files.has(p),
    readUTF8: async (p: string) => files.get(p)!,
    writeUTF8: vi.fn(async (p: string, value: string) => {
      files.set(p, value);
    }),
    listChildren: vi.fn(async (p: string) => children.get(p) ?? []),
    probeNodeVersion: vi.fn(async (p: string) => versions.get(p) ?? null),
    health: vi.fn(async () => null),
    stop: vi.fn(async () => true),
    delay: vi.fn(),
    setPermissions: vi.fn(async () => {}),
  } as unknown as WebAgentInstallerHost;
  return { host, files, versions, children };
}
function config(nodePath = "/old/node") {
  return {
    token: "test",
    nodePath,
    chromePath: "/usr/bin/google-chrome",
    agentScript: "/agent.mjs",
    profileDir: "/profile/browser",
    port: 1234,
    callbackUrl: "http://localhost/callback",
  };
}
describe("Node discovery and manual selection", () => {
  it("discovers NVM Node when the desktop PATH only exposes unsupported system Node", async () => {
    const { host, files, versions, children } = fixture();
    const dir = "/home/ashed/.nvm/versions/node/v24.0.0";
    children.set("/home/ashed/.nvm/versions/node", [dir]);
    files.set(dir + "/bin/node", "");
    versions.set(dir + "/bin/node", "v24.0.0");
    expect(await inspectWebAgentInstallation(host)).toMatchObject({
      nodePath: dir + "/bin/node",
      nodeVersion: "24.0.0",
      missing: [],
    });
  });
  it("scans the config NVM directory and prefers a newer valid version numerically", async () => {
    const { host, files, versions, children } = fixture();
    const root = "/home/ashed/.config/nvm/versions/node";
    const dirs = [root + "/v9.0.0", root + "/v20.9.0", root + "/v24.1.0"];
    children.set(root, dirs);
    for (const dir of dirs) {
      files.set(dir + "/bin/node", "");
      versions.set(dir + "/bin/node", dir.split("/").at(-1)!);
    }
    expect((await inspectWebAgentInstallation(host)).nodePath).toBe(
      root + "/v24.1.0/bin/node",
    );
  });
  it("checks custom NVM_DIR even when another NVM root cannot be read", async () => {
    const { host, files, versions } = fixture();
    host.env.NVM_DIR = "/custom/nvm";
    const dir = "/custom/nvm/versions/node/v22.10.0";
    files.set(dir + "/bin/node", "");
    versions.set(dir + "/bin/node", "v22.10.0");
    vi.mocked(host.listChildren!).mockImplementation(async (root) => {
      if (root === "/custom/nvm/versions/node") return [dir];
      throw new Error("unreadable directory");
    });
    expect((await inspectWebAgentInstallation(host)).nodePath).toBe(
      dir + "/bin/node",
    );
  });
  it("replaces an obsolete saved Node with the discovered NVM executable before starting the Agent", async () => {
    const { host, files, versions, children } = fixture();
    const dir = "/home/ashed/.nvm/versions/node/v24.0.0";
    children.set("/home/ashed/.nvm/versions/node", [dir]);
    files.set(dir + "/bin/node", "");
    versions.set(dir + "/bin/node", "v24.0.0");
    files.set(
      "/data/zai-web-agent-config.json",
      JSON.stringify(config("/usr/bin/node")),
    );
    await inspectWebAgentInstallation(host);
    expect(
      JSON.parse(files.get("/data/zai-web-agent-config.json")!).nodePath,
    ).toBe(dir + "/bin/node");
  });
  it("preserves a working saved Node without scanning for an upgrade", async () => {
    const { host, files, versions } = fixture();
    files.set("/saved/node", "");
    versions.set("/saved/node", "v20.19.6");
    files.set(
      "/data/zai-web-agent-config.json",
      JSON.stringify(config("/saved/node")),
    );
    expect((await inspectWebAgentInstallation(host)).nodePath).toBe(
      "/saved/node",
    );
    expect(host.listChildren).not.toHaveBeenCalled();
  });
  it.each(["/portable/bin/node", "/portable/bin", "/portable"])(
    "accepts a Node executable or containing directory: %s",
    async (input) => {
      const { host, files, versions } = fixture();
      files.set("/portable/bin/node", "");
      versions.set("/portable/bin/node", "v24.0.0");
      const result = await selectWebAgentNode(input, host);
      expect(result).toMatchObject({
        path: "/portable/bin/node",
        version: "24.0.0",
      });
      expect(files.get("/data/zai-web-node-path.txt")).toBe(
        "/portable/bin/node",
      );
      expect((await inspectWebAgentInstallation(host)).nodePath).toBe(
        "/portable/bin/node",
      );
    },
  );
  it("does not execute install.sh or change settings when the selection is invalid", async () => {
    const { host, files } = fixture();
    files.set("/home/ashed/.nvm/install.sh", "installer");
    const before = new Map(files);
    await expect(
      selectWebAgentNode("/home/ashed/.nvm/install.sh", host),
    ).rejects.toThrow("install.sh");
    expect(host.probeNodeVersion).not.toHaveBeenCalled();
    expect(files).toEqual(before);
    await expect(selectWebAgentNode("/usr/bin/node", host)).rejects.toThrow(
      "20+",
    );
    expect(files).toEqual(before);
  });
  it("updates an existing configuration only after validating the new executable", async () => {
    const { host, files, versions } = fixture();
    files.set("/data/zai-web-agent-config.json", JSON.stringify(config()));
    files.set("/new/node", "");
    versions.set("/new/node", "v22.0.0");
    await selectWebAgentNode("/new/node", host);
    expect(
      JSON.parse(files.get("/data/zai-web-agent-config.json")!),
    ).toMatchObject({ nodePath: "/new/node", token: "test", port: 0 });
  });
  it("refuses to replace Node during active WEB work", async () => {
    const { host, files, versions } = fixture();
    files.set("/data/zai-web-agent-config.json", JSON.stringify(config()));
    files.set("/new/node", "");
    versions.set("/new/node", "v22.0.0");
    vi.mocked(host.health).mockResolvedValue({
      ok: true,
      active: { deepseek: "task" },
    });
    const before = new Map(files);
    await expect(selectWebAgentNode("/new/node", host)).rejects.toThrow("任务");
    expect(files).toEqual(before);
  });
  it("accepts a Windows Node directory", async () => {
    const { host, files, versions } = fixture();
    host.platform = "win32";
    host.homeDir = "C:\\Users\\Ada";
    host.dataDir = "C:\\Users\\Ada\\Zotero";
    files.set("C:\\Program Files\\nodejs\\node.exe", "");
    versions.set("C:\\Program Files\\nodejs\\node.exe", "v24.0.0");
    expect(
      await selectWebAgentNode('"C:\\Program Files\\nodejs"', host),
    ).toMatchObject({ path: "C:\\Program Files\\nodejs\\node.exe" });
  });
});
