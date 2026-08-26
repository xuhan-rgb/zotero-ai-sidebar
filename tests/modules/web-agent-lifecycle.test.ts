import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  for (const child of children) child.kill("SIGTERM");
  children.clear();
  await Promise.all(
    [...tempDirs].map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs.clear();
});

describe("Web Agent lifecycle", () => {
  it("starts from the Release ZIP and supports health and authorized shutdown", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "zai-agent-lifecycle-"));
    tempDirs.add(dir);
    const runtimeDir = path.join(dir, "runtime");
    const release = await buildWebAgentRuntimeRelease({
      projectRoot: path.resolve("."),
      runtimeVersion: addonVersion,
      protocolVersion: 24,
      repository: "xuhan-rgb/zotero-ai-sidebar",
    });
    for (const [name, value] of Object.entries(unzipSync(release.archive))) {
      const target = path.join(runtimeDir, ...name.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, value);
    }
    const agentScript = path.join(runtimeDir, "agent.mjs");
    const port = await availablePort();
    const token = "test-token";
    const configPath = path.join(dir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        runtimeVersion: "test-runtime",
        token,
        nodePath: process.execPath,
        chromePath: "/missing/chrome",
        agentScript,
        profileDir: path.join(dir, "profile"),
        cdpPort: port + 1,
        port,
        callbackUrl: "http://127.0.0.1:1/callback",
      }),
    );
    const child = spawn(process.execPath, [agentScript, configPath], {
      cwd: runtimeDir,
      stdio: "ignore",
    });
    children.add(child);

    const health = await waitForHealth(port, token);
    expect(health).toMatchObject({
      ok: true,
      protocolVersion: 24,
      runtimeVersion: "test-runtime",
    });

    const response = await requestJson(port, "/shutdown", token, {
      method: "POST",
    });
    expect(response.status).toBe(202);
    await expect(waitForExit(child)).resolves.toBe(0);
    children.delete(child);
  });
});

async function availablePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
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
