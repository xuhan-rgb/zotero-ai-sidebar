import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { version as addonVersion } from "../../package.json";

import {
  installLocalWebAgentRuntime,
  inspectWebAgentInstallation,
  repairWebAgentInstallation,
  webAgentExecutableCandidates,
  type WebAgentInstallerHost,
} from "../../src/modules/web-agent-installer";

describe("Web Agent installation", () => {
  it("discovers native Node and Chrome locations on Linux, macOS, and Windows", () => {
    expect(
      webAgentExecutableCandidates({
        platform: "linux",
        homeDir: "/home/ada",
        env: {},
      }),
    ).toEqual({
      node: [
        "/home/ada/.local/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
      ],
      chrome: [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/snap/bin/chromium",
      ],
      clipboard: ["/usr/bin/xclip", "/usr/local/bin/xclip"],
    });

    expect(
      webAgentExecutableCandidates({
        platform: "darwin",
        homeDir: "/Users/ada",
        env: {},
      }),
    ).toEqual({
      node: [
        "/Users/ada/.local/bin/node",
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
      ],
      chrome: [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Users/ada/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      ],
      clipboard: [],
    });

    expect(
      webAgentExecutableCandidates({
        platform: "win32",
        homeDir: "C:\\Users\\Ada",
        env: {
          LOCALAPPDATA: "C:\\Users\\Ada\\AppData\\Local",
          ProgramFiles: "C:\\Program Files",
          "ProgramFiles(x86)": "C:\\Program Files (x86)",
        },
      }),
    ).toEqual({
      node: [
        "C:\\Program Files\\nodejs\\node.exe",
        "C:\\Program Files (x86)\\nodejs\\node.exe",
        "C:\\Users\\Ada\\AppData\\Local\\Programs\\nodejs\\node.exe",
        "C:\\Users\\Ada\\.local\\bin\\node.exe",
      ],
      chrome: [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Users\\Ada\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
      ],
      clipboard: [],
    });
  });

  it("prefers executables exposed by PATH for version-manager installs", () => {
    const candidates = webAgentExecutableCandidates({
      platform: "linux",
      homeDir: "/home/ada",
      env: {
        PATH: "/home/ada/.nvm/versions/node/v22.23.1/bin:/usr/bin",
      },
    });

    expect(candidates.node[0]).toBe(
      "/home/ada/.nvm/versions/node/v22.23.1/bin/node",
    );
    expect(candidates.chrome).toContain("/usr/bin/google-chrome");
  });

  it("offers a first-time install instead of throwing when config is missing", async () => {
    const existing = new Set([
      "/home/ada/.local/bin/node",
      "/usr/bin/google-chrome",
      "/usr/bin/xclip",
    ]);
    const host: WebAgentInstallerHost = {
      platform: "linux",
      homeDir: "/home/ada",
      dataDir: "/home/ada/Zotero",
      profileDir: "/home/ada/.zotero/profile",
      env: {},
      exists: async (path) => existing.has(path),
      readUTF8: async () => {
        throw new Error("missing");
      },
      probeNodeVersion: async (path) =>
        path === "/home/ada/.local/bin/node" ? "v22.23.1" : null,
      health: async () => null,
    };

    await expect(inspectWebAgentInstallation(host)).resolves.toMatchObject({
      state: "repairable",
      action: "install",
      message: "尚未安装 Web Agent，可以在线下载并安装",
      nodePath: "/home/ada/.local/bin/node",
      nodeVersion: "22.23.1",
      chromePath: "/usr/bin/google-chrome",
      clipboardPath: "/usr/bin/xclip",
      configPresent: false,
      missing: [],
    });
  });

  it("blocks before writing a partial install when only Node 12 is available", async () => {
    const existing = new Set([
      "/usr/bin/node",
      "/usr/bin/google-chrome",
      "/usr/bin/xclip",
    ]);
    const host = {
      platform: "linux" as const,
      homeDir: "/home/ada",
      dataDir: "/home/ada/Zotero",
      profileDir: "/home/ada/.zotero/profile",
      env: {},
      exists: async (path: string) => existing.has(path),
      readUTF8: async () => {
        throw new Error("missing");
      },
      probeNodeVersion: async (path: string) =>
        path === "/usr/bin/node" ? "v12.22.9" : null,
      health: async () => null,
    } as WebAgentInstallerHost;

    await expect(inspectWebAgentInstallation(host)).resolves.toMatchObject({
      state: "blocked",
      action: "install",
      message: "缺少系统依赖：Node.js 20+",
      missing: ["Node.js 20+"],
      configPresent: false,
    });
  });

  it("keeps an older protocol-compatible runtime available while offering an upgrade", async () => {
    const config = {
      runtimeVersion: "0.8.4",
      token: "e".repeat(64),
      nodePath: "/home/ada/.local/bin/node",
      chromePath: "/usr/bin/google-chrome",
      agentScript: "/home/ada/runtime-0.8.4/agent.mjs",
      profileDir: "/home/ada/browser-profile",
      port: 23120,
      callbackUrl: "http://127.0.0.1:23119/zai/web-prompt-hub",
    };
    const existing = new Set([
      "/home/ada/Zotero/zai-web-agent-config.json",
      config.nodePath,
      config.chromePath,
      config.agentScript,
      "/usr/bin/xclip",
    ]);
    const host = {
      platform: "linux" as const,
      homeDir: "/home/ada",
      dataDir: "/home/ada/Zotero",
      profileDir: "/home/ada/.zotero/profile",
      env: {},
      exists: async (path: string) => existing.has(path),
      readUTF8: async () => JSON.stringify(config),
      probeNodeVersion: async (path: string) =>
        path === config.nodePath ? "v22.23.1" : null,
      health: async () => ({
        ok: true,
        protocolVersion: 24,
        runtimeVersion: "0.8.4",
      }),
    } as WebAgentInstallerHost;

    await expect(inspectWebAgentInstallation(host)).resolves.toMatchObject({
      state: "compatible",
      action: "upgrade",
      message: `Web Agent 0.8.4 可继续使用，建议升级到 ${addonVersion}`,
      configPresent: true,
      missing: [],
    });
  });

  it("downloads the matching release runtime and verifies its health before reporting ready", async () => {
    const files = new Map<string, Uint8Array | string>();
    const existing = new Set([
      "/home/ada/.local/bin/node",
      "/usr/bin/google-chrome",
      "/usr/bin/xclip",
    ]);
    let started = false;
    let startedConfig: Record<string, unknown> | undefined;
    const runtimeArchive = zipSync({
      "agent.mjs": new TextEncoder().encode("// bundled agent"),
      "runtime-manifest.json": new TextEncoder().encode(
        JSON.stringify({
          runtimeVersion: addonVersion,
          protocolVersion: 24,
        }),
      ),
      "node_modules/playwright-core/package.json": new TextEncoder().encode(
        JSON.stringify({ name: "playwright-core", version: "1.62.1" }),
      ),
    });
    const release = {
      runtimeVersion: addonVersion,
      protocolVersion: 24,
      assetName: "zai-web-agent-runtime.zip",
      downloadUrl: `https://github.com/xuhan-rgb/zotero-ai-sidebar/releases/download/v${addonVersion}/zai-web-agent-runtime.zip`,
      releaseUrl: `https://github.com/xuhan-rgb/zotero-ai-sidebar/releases/tag/v${addonVersion}`,
      sha256: createHash("sha256").update(runtimeArchive).digest("hex"),
      size: runtimeArchive.byteLength,
    };
    const host: WebAgentInstallerHost = {
      platform: "linux",
      homeDir: "/home/ada",
      dataDir: "/home/ada/Zotero",
      profileDir: "/home/ada/.zotero/profile",
      env: {},
      exists: async (path) => existing.has(path) || files.has(path),
      readUTF8: async (path) => {
        const value = files.get(path);
        if (typeof value === "string") return value;
        if (value) return new TextDecoder().decode(value);
        throw new Error("missing");
      },
      probeNodeVersion: async (path) =>
        path === "/home/ada/.local/bin/node" ? "v22.23.1" : null,
      health: async (config) =>
        started && config === startedConfig
          ? {
              ok: true,
              protocolVersion: 24,
              runtimeVersion: addonVersion,
            }
          : null,
      fetchRuntimeArchive: async (url) => {
        expect(url).toBe(release.downloadUrl);
        return runtimeArchive;
      },
      sha256: async (value) => createHash("sha256").update(value).digest("hex"),
      makeDirectory: async () => undefined,
      write: async (path, value) => {
        files.set(path, value);
      },
      writeUTF8: async (path, value) => {
        files.set(path, value);
      },
      setPermissions: async () => undefined,
      randomToken: () => "a".repeat(64),
      stop: async () => true,
      start: async (config) => {
        startedConfig = config;
        started = true;
        return true;
      },
      delay: async () => undefined,
    };

    await expect(
      repairWebAgentInstallation(host, release),
    ).resolves.toMatchObject({
      state: "ready",
      action: "none",
      nodeVersion: "22.23.1",
    });
    expect(startedConfig).toMatchObject({
      runtimeVersion: addonVersion,
      nodePath: "/home/ada/.local/bin/node",
      chromePath: "/usr/bin/google-chrome",
      agentScript: `/home/ada/.zotero/profile/zai-web-agent/runtime-${addonVersion}/agent.mjs`,
      profileDir: "/home/ada/.zotero/profile/zai-web-agent/browser-profile",
      token: "a".repeat(64),
      port: 23120,
    });
    expect(
      files.has(
        `/home/ada/.zotero/profile/zai-web-agent/runtime-${addonVersion}/node_modules/playwright-core/package.json`,
      ),
    ).toBe(true);
    expect(
      JSON.parse(
        String(files.get("/home/ada/Zotero/zai-web-agent-config.json")),
      ),
    ).toMatchObject({
      runtimeVersion: addonVersion,
      agentScript: `/home/ada/.zotero/profile/zai-web-agent/runtime-${addonVersion}/agent.mjs`,
    });
  });

  it("installs a browser-downloaded runtime selected from disk", async () => {
    const runtimeArchive = zipSync({
      "agent.mjs": new TextEncoder().encode("// downloaded agent"),
      "runtime-manifest.json": new TextEncoder().encode(
        JSON.stringify({
          runtimeVersion: addonVersion,
          protocolVersion: 24,
        }),
      ),
      "node_modules/playwright-core/package.json": new TextEncoder().encode(
        JSON.stringify({ name: "playwright-core", version: "1.62.1" }),
      ),
    });
    const release = {
      runtimeVersion: addonVersion,
      protocolVersion: 24,
      assetName: "zai-web-agent-runtime.zip",
      downloadUrl: "https://example.invalid/zai-web-agent-runtime.zip",
      releaseUrl: "https://example.invalid/releases/tag/test",
      sha256: createHash("sha256").update(runtimeArchive).digest("hex"),
      size: runtimeArchive.byteLength,
    };
    const files = new Map<string, Uint8Array | string>();
    const existing = new Set([
      "/home/ada/.local/bin/node",
      "/usr/bin/google-chrome",
      "/usr/bin/xclip",
    ]);
    let started = false;
    const host = {
      platform: "linux" as const,
      homeDir: "/home/ada",
      dataDir: "/home/ada/Zotero",
      profileDir: "/home/ada/.zotero/profile",
      env: {},
      exists: async (path: string) => existing.has(path) || files.has(path),
      readUTF8: async () => {
        throw new Error("missing");
      },
      read: async (path: string) => {
        expect(path).toBe("/home/ada/Downloads/zai-web-agent-runtime.zip");
        return runtimeArchive;
      },
      probeNodeVersion: async (path: string) =>
        path === "/home/ada/.local/bin/node" ? "v22.23.1" : null,
      health: async () =>
        started
          ? {
              ok: true,
              protocolVersion: 24,
              runtimeVersion: addonVersion,
            }
          : null,
      fetchRuntimeArchive: async () => {
        throw new Error("network must not be used");
      },
      sha256: async (value: Uint8Array) =>
        createHash("sha256").update(value).digest("hex"),
      makeDirectory: async () => undefined,
      write: async (path: string, value: Uint8Array) => {
        files.set(path, value);
      },
      writeUTF8: async (path: string, value: string) => {
        files.set(path, value);
      },
      setPermissions: async () => undefined,
      randomToken: () => "b".repeat(64),
      stop: async () => true,
      start: async () => {
        started = true;
        return true;
      },
      delay: async () => undefined,
    } as WebAgentInstallerHost;

    await expect(
      installLocalWebAgentRuntime(
        "/home/ada/Downloads/zai-web-agent-runtime.zip",
        host,
        release,
      ),
    ).resolves.toMatchObject({ state: "ready", action: "none" });
  });

  it("restores the previous runtime when the downloaded upgrade fails its health check", async () => {
    const configPath = "/home/ada/Zotero/zai-web-agent-config.json";
    const previousConfig = {
      runtimeVersion: "0.8.4",
      token: "c".repeat(64),
      nodePath: "/home/ada/.local/bin/node",
      chromePath: "/usr/bin/google-chrome",
      agentScript: "/home/ada/runtime-0.8.4/agent.mjs",
      profileDir: "/home/ada/browser-profile",
      cdpPort: 9224,
      port: 23120,
      callbackUrl: "http://127.0.0.1:23119/zai/web-prompt-hub",
    };
    const previousRaw = `${JSON.stringify(previousConfig, null, 2)}\n`;
    const runtimeArchive = zipSync({
      "agent.mjs": new TextEncoder().encode("// broken upgrade"),
      "runtime-manifest.json": new TextEncoder().encode(
        JSON.stringify({
          runtimeVersion: addonVersion,
          protocolVersion: 24,
        }),
      ),
      "node_modules/playwright-core/package.json": new TextEncoder().encode(
        JSON.stringify({ name: "playwright-core", version: "1.62.1" }),
      ),
    });
    const release = {
      runtimeVersion: addonVersion,
      protocolVersion: 24,
      assetName: "zai-web-agent-runtime.zip",
      downloadUrl: "https://example.invalid/zai-web-agent-runtime.zip",
      releaseUrl: "https://example.invalid/releases/tag/test",
      sha256: createHash("sha256").update(runtimeArchive).digest("hex"),
      size: runtimeArchive.byteLength,
    };
    const files = new Map<string, Uint8Array | string>([
      [configPath, previousRaw],
    ]);
    const existing = new Set([
      previousConfig.nodePath,
      previousConfig.chromePath,
      previousConfig.agentScript,
      "/usr/bin/xclip",
    ]);
    const started: Array<Record<string, unknown>> = [];
    const host = {
      platform: "linux" as const,
      homeDir: "/home/ada",
      dataDir: "/home/ada/Zotero",
      profileDir: "/home/ada/.zotero/profile",
      env: {},
      exists: async (path: string) => existing.has(path) || files.has(path),
      read: async () => runtimeArchive,
      readUTF8: async (path: string) => {
        const value = files.get(path);
        if (typeof value === "string") return value;
        throw new Error("missing");
      },
      probeNodeVersion: async (path: string) =>
        path === previousConfig.nodePath ? "v22.23.1" : null,
      health: async (config: Record<string, unknown>) =>
        config.agentScript === previousConfig.agentScript
          ? {
              ok: true,
              protocolVersion: 24,
              runtimeVersion: "0.8.4",
            }
          : null,
      fetchRuntimeArchive: async () => runtimeArchive,
      sha256: async (value: Uint8Array) =>
        createHash("sha256").update(value).digest("hex"),
      makeDirectory: async () => undefined,
      write: async (path: string, value: Uint8Array) => {
        files.set(path, value);
      },
      writeUTF8: async (path: string, value: string) => {
        files.set(path, value);
      },
      setPermissions: async () => undefined,
      randomToken: () => "d".repeat(64),
      stop: async () => true,
      start: async (config: Record<string, unknown>) => {
        started.push(config);
        return true;
      },
      delay: async () => undefined,
    } as WebAgentInstallerHost;

    await expect(repairWebAgentInstallation(host, release)).rejects.toThrow(
      "健康检查未通过",
    );
    expect(files.get(configPath)).toBe(previousRaw);
    expect(started).toHaveLength(2);
    expect(started[1]).toMatchObject(previousConfig);
  });
});
