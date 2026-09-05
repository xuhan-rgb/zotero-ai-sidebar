// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearWebAgentConfigCache,
  getWebAccountStatus,
  loadWebAgentConfig,
  readWebAgentHealth,
  startWebAgent,
  stopWebAgent,
  shutdownWebAgent,
  type WebAgentConfig,
} from "../../src/modules/web-agent-client";

const chromePath = process.env.ZAI_TEST_CHROME || "/usr/bin/google-chrome";

afterEach(() => {
  clearWebAgentConfigCache();
  vi.unstubAllGlobals();
});

describe("Web Agent port coexistence", () => {
  it.skipIf(!existsSync(chromePath))(
    "uses its own Chrome and restarts when another plugin claims the released Agent port",
    async () => {
      const dir = await mkdtemp(
        path.join(os.tmpdir(), "zai-port-coexistence-"),
      );
      const configPath = path.join(dir, "zai-web-agent-config.json");
      const profileDir = path.join(dir, "browser-profile");
      await mkdir(profileDir);
      const requests: string[] = [];
      const otherPlugin = http.createServer((request, response) => {
        requests.push(request.url!);
        response.setHeader("content-type", "text/html");
        response.end("<textarea></textarea><button>Send</button>");
      });
      await listen(otherPlugin);
      const otherPort = (otherPlugin.address() as AddressInfo).port;
      await writeFile(
        configPath,
        JSON.stringify({
          runtimeSha256: "a".repeat(64),
          needsRuntimeUpdate: false,
          token: "coexistence-token",
          nodePath: process.execPath,
          chromePath,
          agentScript: path.resolve("web-agent/agent.mjs"),
          profileDir,
          port: otherPort,
          cdpPort: otherPort,
          callbackUrl: `http://127.0.0.1:${otherPort}/callback`,
        }),
      );
      const processes: ChildProcess[] = [];
      let stderr = "";
      const exec = vi.fn(
        (executable: string, args: string[]) =>
          new Promise<boolean>((resolve, reject) => {
            const child = spawn(executable, args, {
              stdio: ["ignore", "ignore", "pipe"],
            });
            processes.push(child);
            child.stderr!.on("data", (data) => {
              stderr += data;
            });
            child.once("error", reject);
            child.once("exit", (code) => resolve(code === 0));
          }),
      );
      vi.stubGlobal("Zotero", {
        DataDirectory: { dir },
        Utilities: { Internal: { exec } },
      });
      vi.stubGlobal("IOUtils", {
        readUTF8: (file: string) => readFile(file, "utf8"),
      });
      let config: WebAgentConfig | undefined;
      try {
        config = await loadWebAgentConfig();
        await startWebAgent(config);
        expect(config.port).not.toBe(otherPort);
        expect(requests.every((url) => url === "/health")).toBe(true);
        const url = `http://127.0.0.1:${otherPort}/`;
        const account = await getWebAccountStatus(
          "custom:coexistence",
          config,
          {
            id: "coexistence",
            name: "Local test",
            template: "chatgpt-like",
            homeUrl: url,
            newConversationUrl: url,
            selectors: {
              composer: ["textarea"],
              send: ["button"],
              stop: [".stop"],
              answers: [".answer"],
              attachmentPreviews: [],
              attachmentUploading: [],
            },
          },
        );
        expect(account).toMatchObject({ configured: true, browserOpen: true });
        const health = await fetch(`http://127.0.0.1:${config.port}/health`, {
          headers: { authorization: `Bearer ${config.token}` },
        }).then((response) => response.json());
        expect(health).toMatchObject({
          browserConnected: true,
          browserMode: "headless",
        });
        const [cdpPort] = (
          await readFile(path.join(profileDir, "DevToolsActivePort"), "utf8")
        ).split("\n");
        expect(Number(cdpPort)).not.toBe(otherPort);

        // A healthy Agent is reused, without spawning another process or changing ports.
        const firstPort = config.port;
        await startWebAgent(config);
        expect(exec).toHaveBeenCalledOnce();
        expect(config.port).toBe(firstPort);
        expect(await stopWebAgent(config)).toBe(true);
        await waitForExit(processes[0]);
        await expect(
          fetch(`http://127.0.0.1:${cdpPort}/json/version`),
        ).rejects.toThrow();
        expect((await fetch(url)).ok).toBe(true);

        // Start the other plugin after the Agent exits, taking its previous port.
        await close(otherPlugin);
        await listen(otherPlugin, firstPort);
        await startWebAgent(config);
        expect(config.port).not.toBe(firstPort);
        expect(await readWebAgentHealth(config)).toMatchObject({ ok: true });
        expect((await fetch(`http://127.0.0.1:${firstPort}/`)).ok).toBe(true);
        expect(exec).toHaveBeenCalledTimes(2);
        await shutdownWebAgent();
        await waitForExit(processes[1]);
        expect(await readWebAgentHealth(config)).toBeNull();
        expect((await fetch(`http://127.0.0.1:${firstPort}/`)).ok).toBe(true);
      } catch (error) {
        throw new Error(`${String(error)}\nAgent stderr: ${stderr}`, {
          cause: error,
        });
      } finally {
        if (config) await stopWebAgent(config);
        for (const child of processes) {
          if (child.exitCode == null) {
            child.kill("SIGTERM");
            await waitForExit(child);
          }
        }
        await close(otherPlugin);
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

function listen(server: http.Server, port = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode != null || child.signalCode != null) return;
  const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
  try {
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    expect(child.exitCode).toBe(0);
  } finally {
    clearTimeout(timeout);
  }
}
