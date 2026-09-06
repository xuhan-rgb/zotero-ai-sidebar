// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const chromePath = process.env.ZAI_TEST_CHROME || "/usr/bin/google-chrome";

describe("Z.ai account and attachment flow", () => {
  it.skipIf(!existsSync(chromePath))(
    "allows guest text chat but waits for login before uploading files",
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "zai-account-test-"));
      let signedIn = false;
      let hydrated = true;
      let uploads = 0;
      let submissions = 0;
      let occupied: http.Server | undefined;
      let occupiedPort = 0;
      const callbacks: Record<string, unknown>[] = [];
      const fixture = http.createServer(async (request, response) => {
        if (request.url?.startsWith("/occupy?")) {
          if (!occupied) {
            occupiedPort = Number(
              new URL(request.url, "http://local").searchParams.get("port"),
            );
            occupied = http.createServer((_req, res) =>
              res.end("foreign-service"),
            );
            await new Promise<void>((resolve) =>
              occupied!.listen(occupiedPort, "127.0.0.1", resolve),
            );
            occupiedPort = (occupied.address() as AddressInfo).port;
          }
          response.end("ok");
        } else if (request.url === "/other-provider") {
          response.setHeader("content-type", "text/html; charset=utf-8");
          response.end("<p>Login required</p>");
        } else if (request.url === "/callback") {
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          callbacks.push(JSON.parse(Buffer.concat(chunks).toString()));
          response.end("ok");
        } else if (request.url === "/state") {
          response.end(JSON.stringify({ signedIn, hydrated }));
        } else if (request.url === "/upload") {
          uploads++;
          response.end("ok");
        } else if (request.url === "/submit") {
          submissions++;
          response.end("Z.ai test reply");
        } else {
          response.setHeader("content-type", "text/html; charset=utf-8");
          // The public Z.ai frontend marks #chat-container with data-guest,
          // while still exposing #chat-input to guests. No real site is used.
          response.end(`<!doctype html><meta charset="utf-8">
            <div id="chat-container" data-guest="true">
              <div class="messageInputContainer">
                <input type="file" multiple hidden>
                <textarea id="chat-input"></textarea>
                <button id="send-message-button">Send</button>
              </div>
            </div>
            <script>
              const container = document.querySelector('#chat-container');
              const composer = document.querySelector('textarea');
              setInterval(async () => {
                const state = await (await fetch('/state')).json();
                if (state.hydrated) container.dataset.guest = String(!state.signedIn);
                else delete container.dataset.guest;
              }, 50);
              document.querySelector('input').onchange = async event => {
                if (container.dataset.guest !== 'false') {
                  const dialog = document.createElement('div');
                  dialog.setAttribute('role', 'dialog');
                  dialog.style.cssText = 'width:400px;height:180px';
                  dialog.textContent = '解锁你的洞察 登录即可分析您的文件';
                  document.body.append(dialog);
                  return;
                }
                await fetch('/upload');
                for (const file of event.target.files) {
                  const card = document.createElement('button');
                  card.className = 'relative group';
                  card.textContent = file.name;
                  document.querySelector('.messageInputContainer').append(card);
                }
              };
              document.querySelector('#send-message-button').onclick = async () => {
                if (!composer.value.trim()) return;
                composer.value = '';
                const answer = await (await fetch('/submit')).text();
                container.insertAdjacentHTML('beforeend',
                  '<div class="chat-assistant"><div id="response-content-container"><p>' +
                  answer + '</p></div></div><button class="copy-response-button">Copy</button>');
              };
            </script>`);
        }
      });
      await new Promise<void>((resolve) =>
        fixture.listen(0, "127.0.0.1", resolve),
      );
      const url = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}`;
      const configPath = path.join(dir, "config.json");
      const preloadPath = path.join(dir, "mock-site.mjs");
      const attachmentPath = path.join(dir, "context.txt");
      const browserLauncher = path.join(dir, "chrome.mjs");
      const launchesPath = path.join(dir, "launches.jsonl");
      let child: ChildProcess | undefined;
      let port = 0;
      let errors = "";
      const request = async (route: string, body?: unknown) => {
        const response = await fetch(`http://127.0.0.1:${port}${route}`, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            authorization: "Bearer test-token",
            "content-type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const result = await response.json();
        expect(response.ok, JSON.stringify(result)).toBe(true);
        return result;
      };
      const status = () => request("/browser/status?provider=zai");
      try {
        // Simulate a port race at the browser process boundary. The competing
        // service stays alive in this test process while Chrome retries.
        await writeFile(
          browserLauncher,
          `#!${process.execPath}
          import { appendFileSync } from 'node:fs';
          import { spawn } from 'node:child_process';
          const args = process.argv.slice(2);
          appendFileSync(${JSON.stringify(launchesPath)}, JSON.stringify({ args, pid: process.pid }) + '\\n');
          const debugPort = args.find(arg => arg.startsWith('--remote-debugging-port=')).split('=')[1];
          await fetch(${JSON.stringify(url)} + '/occupy?port=' + debugPort);
          const chrome = spawn(${JSON.stringify(chromePath)}, [...args, '--headless=new', '--disable-background-networking']);
          chrome.stderr.pipe(process.stderr);
          chrome.on('exit', code => process.exit(code || 0));
          process.on('SIGTERM', () => chrome.kill('SIGTERM'));
        `,
        );
        await chmod(browserLauncher, 0o700);
        await writeFile(attachmentPath, "Local test context");
        await writeFile(
          configPath,
          JSON.stringify({
            token: "test-token",
            port: 0,
            chromePath: browserLauncher,
            profileDir: path.join(dir, "profile"),
            callbackUrl: `${url}/callback`,
          }),
        );
        // Intercept at the network boundary of an isolated headless profile.
        // Every browser request goes to the local fixture, never to Z.ai.
        await writeFile(
          preloadPath,
          `
          import { chromium } from ${JSON.stringify(pathToFileURL(path.resolve("web-agent/node_modules/playwright-core/index.mjs")).href)};
          const connect = chromium.connectOverCDP.bind(chromium);
          chromium.connectOverCDP = async (...args) => {
            const browser = await connect(...args);
            await browser.contexts()[0].route('**/*', async route => {
              const target = new URL(route.request().url());
              const response = await fetch(${JSON.stringify(url)} + target.pathname + target.search);
              await route.fulfill({ status: response.status,
                headers: Object.fromEntries(response.headers),
                body: Buffer.from(await response.arrayBuffer()) });
            });
            return browser;
          };`,
        );
        child = spawn(
          process.execPath,
          [
            "--import",
            preloadPath,
            path.resolve("web-agent/agent.mjs"),
            configPath,
          ],
          {
            stdio: ["ignore", "ignore", "pipe"],
          },
        );
        child.stderr!.on("data", (data) => {
          errors += data;
        });
        await expect
          .poll(async () => {
            if (child!.exitCode != null) throw new Error(errors);
            port = JSON.parse(await readFile(configPath, "utf8")).port;
            return port;
          })
          .toBeGreaterThan(0);

        // A guest can chat, but this is not an authenticated upload session.
        expect(await status()).toMatchObject({
          configured: true,
          browserOpen: true,
          guest: true,
        });
        const launches = async () =>
          (await readFile(launchesPath, "utf8"))
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        expect(
          await request("/browser/open", { provider: "zai" }),
        ).toMatchObject({
          configured: true,
          guest: true,
          browserOpen: true,
        });
        const started = await launches();
        expect(started).toHaveLength(2);
        for (const launch of started) {
          expect(launch.args).toContain(
            `--user-data-dir=${path.join(dir, "profile")}`,
          );
          expect(launch.args).not.toContain("--remote-debugging-port=0");
          expect(launch.args).not.toContain("--headless=new");
        }
        expect(
          await (await fetch(`http://127.0.0.1:${occupiedPort}`)).text(),
        ).toBe("foreign-service");
        // Login becomes visible in the same open page without closing Chrome.
        signedIn = true;
        await expect
          .poll(status)
          .toMatchObject({ configured: true, guest: false, browserOpen: true });
        expect(await status()).not.toHaveProperty("manualLogin");
        expect(await request("/health")).toMatchObject({
          browserConnected: true,
        });
        expect(await launches()).toHaveLength(2);
        signedIn = false;
        await expect
          .poll(status)
          .toMatchObject({ configured: true, guest: true });
        expect(
          await request("/browser/hide", { provider: "zai" }),
        ).toMatchObject({
          configured: true,
          guest: true,
          browserOpen: true,
          hidden: true,
        });
        expect(await launches()).toHaveLength(2);
        await request("/tasks", {
          id: "zai-guest-text",
          provider: "zai",
          sessionKey: "zai:guest",
          prompt: "Hello",
          continuationPrompt: "Hello",
          hideBrowser: true,
        });
        await expect
          .poll(() => callbacks, { timeout: 20_000 })
          .toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                id: "zai-guest-text",
                state: "completed",
                answer: "Z.ai test reply",
              }),
            ]),
          );
        expect(uploads).toBe(0);
        expect(submissions).toBe(1);
        signedIn = true;
        await expect
          .poll(status)
          .toMatchObject({ configured: true, guest: false });
        hydrated = false;
        await expect.poll(status).toMatchObject({ configured: false });
        signedIn = false;
        hydrated = true;
        await request("/tasks", {
          id: "zai-login-upload",
          provider: "zai",
          sessionKey: "zai:test",
          prompt: "Hello",
          continuationPrompt: "Hello",
          hideBrowser: true,
          contextAttachment: {
            kind: "text",
            path: attachmentPath,
            name: "context.txt",
            mimeType: "text/plain",
          },
        });
        await expect
          .poll(() => callbacks)
          .toEqual(
            expect.arrayContaining([
              expect.objectContaining({ state: "needs_login" }),
            ]),
          );
        expect(uploads).toBe(0);
        expect(submissions).toBe(1);
        expect(
          await request("/browser/open", { provider: "zai" }),
        ).toMatchObject({ guest: true });
        expect(await launches()).toHaveLength(2);
        signedIn = true;
        await expect
          .poll(() => callbacks, { timeout: 20_000 })
          .toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                id: "zai-login-upload",
                state: "completed",
                answer: "Z.ai test reply",
              }),
            ]),
          );
        expect(uploads).toBe(1);
        expect(submissions).toBe(2);
        expect(
          callbacks.some(
            (event) => event.state === "failed" || event.pageNotice,
          ),
        ).toBe(false);
        await expect
          .poll(async () => (await request("/health")).active)
          .toEqual({});
        expect(await launches()).toHaveLength(2);
        const saved = JSON.parse(await readFile(configPath, "utf8"));
        expect(saved.profileDir).toBe(path.join(dir, "profile"));
        // Exercise cross-provider task protection against a local website.
        // No third-party origin is needed for this browser-transition check.
        await request("/tasks", {
          id: "other-provider",
          provider: "custom:other-provider",
          customProvider: {
            id: "other-provider",
            name: "Other local provider",
            template: "chatgpt-like",
            homeUrl: `${url}/other-provider`,
            newConversationUrl: `${url}/other-provider`,
            selectors: {
              composer: ["textarea"],
              send: ["button"],
              answers: [".answer"],
            },
          },
          sessionKey: "other",
          prompt: "Hello",
          continuationPrompt: "Hello",
          hideBrowser: true,
        });
        await expect
          .poll(() => callbacks, { timeout: 10_000 })
          .toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                id: "other-provider",
                state: "needs_login",
              }),
            ]),
          );
        const before = (await launches()).length;
        const busy = await fetch(`http://127.0.0.1:${port}/browser/open`, {
          method: "POST",
          headers: {
            authorization: "Bearer test-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ provider: "zai" }),
        });
        expect(busy.ok).toBe(false);
        expect((await busy.json()).error).toContain("其他 WEB 任务");
        expect(await launches()).toHaveLength(before);
        expect(await request("/health")).toMatchObject({
          active: { "custom:other-provider": "other-provider" },
        });
        await request("/tasks/cancel", { id: "other-provider" });
      } finally {
        if (child && child.exitCode == null && child.signalCode == null) {
          await request("/shutdown", {}).catch(() => child!.kill("SIGTERM"));
          await expect.poll(() => child!.exitCode, { timeout: 10_000 }).toBe(0);
        }
        if (occupied) {
          occupied.closeAllConnections();
          await new Promise<void>((resolve) =>
            occupied!.close(() => resolve()),
          );
        }
        fixture.closeAllConnections();
        await new Promise<void>((resolve) => fixture.close(() => resolve()));
        await rm(dir, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
      }
    },
    40_000,
  );
});
