import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import {
  checkWebAgentAfterXpiUpdate,
  installLocalWebAgentRuntime,
  repairWebAgentInstallation,
  inspectWebAgentInstallation,
  type WebAgentInstallerHost,
  type WebAgentRuntimeRelease,
} from "../../src/modules/web-agent-installer";

const configPath = "/data/zai-web-agent-config.json";
const expectedSha = "a".repeat(64);
const release = {
  sha256: expectedSha,
  protocolVersion: 24,
} as WebAgentRuntimeRelease;

function installation() {
  const saved = {
    runtimeVersion: "0.8.4",
    runtimeSha256: expectedSha,
    checkedXpiVersion: "0.8.6",
    needsRuntimeUpdate: false,
    token: "private-token",
    nodePath: "/node",
    chromePath: "/chrome",
    agentScript: "/runtime/agent.mjs",
    profileDir: "/browser-profile",
    port: 41001,
    callbackUrl: "http://127.0.0.1:23119/zai/web-prompt-hub",
  };
  const files = new Map<string, string>([[configPath, JSON.stringify(saved)]]);
  const host = {
    platform: "linux",
    homeDir: "/home/test",
    dataDir: "/data",
    profileDir: "/profile",
    env: {},
    exists: async (path: string) =>
      files.has(path) ||
      ["/node", "/chrome", "/runtime/agent.mjs", "/usr/bin/xclip"].includes(
        path,
      ),
    readUTF8: async (path: string) => {
      const raw = files.get(path);
      if (!raw) throw new Error("missing");
      return raw;
    },
    writeUTF8: vi.fn(async (path: string, value: string) => {
      files.set(path, value);
    }),
    probeNodeVersion: async () => "v20.19.6",
    health: async () => ({
      ok: true,
      protocolVersion: 24,
      runtimeSha256: saved.runtimeSha256,
    }),
    start: vi.fn(async () => true),
    fetchRuntimeArchive: vi.fn(async () => {
      throw new Error("must not access release downloads");
    }),
    sha256: vi.fn(async (data: Uint8Array) =>
      createHash("sha256").update(data).digest("hex"),
    ),
  } as unknown as WebAgentInstallerHost;
  return { host, files, saved };
}

describe("Web Agent package update checks", () => {
  it("reuses a matching healthy package during an explicit update without downloading or hashing it again", async () => {
    const { host } = installation();
    await expect(
      repairWebAgentInstallation(host, release),
    ).resolves.toMatchObject({ state: "ready" });
    expect(host.fetchRuntimeArchive).not.toHaveBeenCalled();
    expect(host.sha256).not.toHaveBeenCalled();
    expect(host.start).not.toHaveBeenCalled();
  });

  it.each(["online", "local"])(
    "rejects an unmatched %s ZIP before changing the running Agent",
    async (source) => {
      const archive = zipSync({
        "agent.mjs": new TextEncoder().encode("// bundled runtime"),
        "runtime-manifest.json": new TextEncoder().encode(
          JSON.stringify({ protocolVersion: 24 }),
        ),
        "node_modules/playwright-core/package.json": new TextEncoder().encode(
          "{}",
        ),
      });
      const expected: WebAgentRuntimeRelease = {
        protocolVersion: 24,
        assetName: "zai-web-agent-runtime.zip",
        downloadUrl: "https://example.invalid/current-xpi/runtime.zip",
        releaseUrl: "https://example.invalid/current-xpi",
        sha256: createHash("sha256").update(archive).digest("hex"),
        size: archive.length,
      };
      const wrong = archive.slice();
      wrong[wrong.length - 1] ^= 1;
      const { host, files, saved } = installation();
      // Local selection must still be checked when the existing installation is ready.
      saved.runtimeSha256 =
        source === "local" ? expected.sha256 : "b".repeat(64);
      files.set(configPath, JSON.stringify(saved));
      host.fetchRuntimeArchive = vi.fn(async () => wrong);
      host.read = vi.fn(async () => wrong);
      host.write = vi.fn(async () => undefined);
      host.stop = vi.fn(async () => true);
      await expect(
        source === "local"
          ? installLocalWebAgentRuntime(
              "/downloads/runtime.zip",
              host,
              expected,
            )
          : repairWebAgentInstallation(host, expected),
      ).rejects.toThrow("SHA-256 校验失败");
      expect(host.sha256).toHaveBeenCalledOnce();
      expect(host.write).not.toHaveBeenCalled();
      expect(host.stop).not.toHaveBeenCalled();
      expect(host.start).not.toHaveBeenCalled();
      expect(JSON.parse(files.get(configPath)!)).toMatchObject({
        token: saved.token,
        profileDir: saved.profileDir,
      });
      if (source === "local")
        expect(host.fetchRuntimeArchive).not.toHaveBeenCalled();
    },
  );

  it.each([expectedSha, "b".repeat(64), undefined])(
    "checks installed package metadata once after an XPI update (installed %s)",
    async (installedSha) => {
      const { host, files, saved } = installation();
      files.set(
        configPath,
        JSON.stringify({ ...saved, runtimeSha256: installedSha }),
      );
      await checkWebAgentAfterXpiUpdate(host, release, "0.8.7");
      expect(JSON.parse(files.get(configPath)!)).toMatchObject({
        checkedXpiVersion: "0.8.7",
        needsRuntimeUpdate: installedSha !== expectedSha,
      });
      await checkWebAgentAfterXpiUpdate(host, release, "0.8.7");
      expect(host.writeUTF8).toHaveBeenCalledTimes(1);
      await expect(inspectWebAgentInstallation(host)).resolves.toMatchObject({
        state: installedSha === expectedSha ? "ready" : "repairable",
      });
      expect(host.sha256).not.toHaveBeenCalled();
      expect(host.fetchRuntimeArchive).not.toHaveBeenCalled();
      expect(host.start).not.toHaveBeenCalled();
    },
  );

  it("does not install or start an Agent on XPI startup when WEB has never been installed", async () => {
    const { host, files } = installation();
    files.clear();
    await checkWebAgentAfterXpiUpdate(host, release, "0.8.7");
    expect(host.writeUTF8).not.toHaveBeenCalled();
    expect(host.fetchRuntimeArchive).not.toHaveBeenCalled();
    expect(host.start).not.toHaveBeenCalled();
  });

  it("does not compare ZIP identities or contact the release server during ordinary inspection", async () => {
    const { host, files, saved } = installation();
    saved.runtimeSha256 = "b".repeat(64);
    files.set(configPath, JSON.stringify(saved));
    await expect(inspectWebAgentInstallation(host)).resolves.toMatchObject({
      state: "ready",
      action: "none",
      message: "Web Agent 已就绪",
    });
    expect(host.sha256).not.toHaveBeenCalled();
    expect(host.fetchRuntimeArchive).not.toHaveBeenCalled();
    expect(host.writeUTF8).not.toHaveBeenCalled();
  });
});
