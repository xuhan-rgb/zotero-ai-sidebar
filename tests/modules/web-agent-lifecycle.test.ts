import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { version as addonVersion } from "../../package.json";
import { buildWebAgentRuntimeRelease } from "../../scripts/web-agent-runtime-archive";

const children = new Set<ChildProcess>();
const tempDirs = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...children].map(async (child) => {
      child.kill("SIGTERM");
      const timeout = setTimeout(() => child.kill("SIGKILL"), 3_000);
      try {
        await waitForExit(child);
      } finally {
        clearTimeout(timeout);
      }
    }),
  );
  children.clear();
  await Promise.all(
    [...tempDirs].map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs.clear();
});

describe("Web Agent lifecycle", () => {
  it("writes an automatic-port config from the command-line installer", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "zai-agent-lifecycle-"));
    tempDirs.add(dir);
    const configPath = path.join(dir, "config.json");
    const child = spawn(
      process.execPath,
      [
        path.resolve("web-agent/write-config.mjs"),
        configPath,
        process.execPath,
        "/chrome",
        "/agent.mjs",
        path.join(dir, "profile"),
      ],
      { stdio: "ignore" },
    );
    children.add(child);
    expect(await waitForExit(child)).toBe(0);
    children.delete(child);
    expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({
      port: 0,
      cdpPort: 0,
    });
  });

  it("chooses its own port while another plugin keeps the configured port", async () => {
    const otherRequests: string[] = [];
    const otherPlugin = http.createServer((request, response) => {
      otherRequests.push(request.url!);
      response.end("pong");
    });
    await new Promise<void>((resolve) =>
      otherPlugin.listen(0, "127.0.0.1", resolve),
    );
    const occupiedPort = (otherPlugin.address() as net.AddressInfo).port;
    const dir = await mkdtemp(path.join(os.tmpdir(), "zai-agent-port-"));
    tempDirs.add(dir);
    const configPath = path.join(dir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        token: "port-test-token",
        port: occupiedPort,
        cdpPort: occupiedPort,
        chromePath: "/missing/chrome",
        profileDir: path.join(dir, "profile"),
        callbackUrl: "http://127.0.0.1:1/callback",
      }),
    );
    const child = spawn(
      process.execPath,
      [path.resolve("web-agent/agent.mjs"), configPath, "port-test-instance"],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    children.add(child);
    let stderr = "";
    child.stderr!.on("data", (data) => {
      stderr += data;
    });
    try {
      let config;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (child.exitCode != null) throw new Error(stderr);
        config = JSON.parse(await readFile(configPath, "utf8"));
        if (config.instanceId === "port-test-instance") break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(config.port).not.toBe(occupiedPort);
      expect(config.port).toBeGreaterThan(0);
      const health = await waitForHealth(config.port, "port-test-token");
      expect(health).toMatchObject({
        ok: true,
        instanceId: "port-test-instance",
      });
      expect(otherRequests).toEqual([]);
      // The competing listener must still be usable after Agent startup/shutdown.
      expect(otherPlugin.listening).toBe(true);
      await requestJson(config.port, "/shutdown", "port-test-token", {
        method: "POST",
      });
      await waitForExit(child);
      children.delete(child);
      expect(otherPlugin.listening).toBe(true);
    } finally {
      await new Promise<void>((resolve) => otherPlugin.close(() => resolve()));
    }
  });

  it("starts from the Release ZIP and supports health and authorized shutdown", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "zai-agent-lifecycle-"));
    tempDirs.add(dir);
    const runtimeDir = path.join(dir, "runtime");
    const release = await buildWebAgentRuntimeRelease({
      projectRoot: path.resolve("."),
      releaseVersion: addonVersion,
      protocolVersion: 24,
      repository: "xuhan-rgb/zotero-ai-sidebar",
    });
    for (const [name, value] of Object.entries(unzipSync(release.archive))) {
      const target = path.join(runtimeDir, ...name.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, value);
    }
    const agentScript = path.join(runtimeDir, "agent.mjs");
    const previousPort = 23120;
    const token = "test-token";
    const configPath = path.join(dir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        runtimeSha256: release.sha256,
        token,
        nodePath: process.execPath,
        chromePath: "/missing/chrome",
        agentScript,
        profileDir: path.join(dir, "profile"),
        cdpPort: 0,
        port: previousPort,
        callbackUrl: "http://127.0.0.1:1/callback",
      }),
    );
    const child = spawn(process.execPath, [agentScript, configPath], {
      cwd: runtimeDir,
      stdio: "ignore",
    });
    children.add(child);

    const published = await waitForPublishedConfig(configPath);
    const port = published.port;
    const health = await waitForHealth(port, token);
    expect(health).toMatchObject({
      ok: true,
      protocolVersion: 24,
      runtimeSha256: release.sha256,
    });

    expect(
      (await requestJson(port, "/shutdown", "wrong-token", { method: "POST" }))
        .status,
    ).toBe(401);
    expect((await requestJson(port, "/health", token)).status).toBe(200);
    const response = await requestJson(port, "/shutdown", token, {
      method: "POST",
    });
    expect(response.status).toBe(202);
    await expect(waitForExit(child)).resolves.toBe(0);
    children.delete(child);
    const replacement = net.createServer();
    await new Promise<void>((resolve, reject) => {
      replacement.once("error", reject);
      replacement.listen(port, "127.0.0.1", resolve);
    });
    await new Promise<void>((resolve) => replacement.close(() => resolve()));
  });
});

async function waitForPublishedConfig(
  configPath: string,
): Promise<{ port: number; instanceId: string }> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const config = JSON.parse(await readFile(configPath, "utf8"));
    if (config.instanceId && config.port > 0) return config;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Agent did not publish its listening port");
}

async function waitForHealth(
  port: number,
  token: string,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await requestJson(port, "/health", token);
      if (response.status === 200) return response.body;
    } catch {
      // The process may still be binding its localhost port.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Web Agent did not start");
}

function requestJson(
  port: number,
  requestPath: string,
  token: string,
  options: { method?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: requestPath,
        method: options.method ?? "GET",
        headers: { authorization: `Bearer ${token}` },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: response.statusCode ?? 0,
            body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
          });
        });
      },
    );
    request.once("error", reject);
    request.end();
  });
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode != null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
}
