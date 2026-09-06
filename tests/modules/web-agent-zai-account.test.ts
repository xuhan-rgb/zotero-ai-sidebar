// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const chromePath = process.env.ZAI_TEST_CHROME || "/usr/bin/google-chrome";

describe("Z.ai account and attachment flow", () => {
  it.skipIf(!existsSync(chromePath))(
    "waits for login before uploading, then submits and returns the reply once",
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "zai-account-test-"));
      let signedIn = false;
      let hydrated = true;
      let uploads = 0;
      let submissions = 0;
      const callbacks: Record<string, unknown>[] = [];
      const fixture = http.createServer(async (request, response) => {
        if (request.url === "/callback") {
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
          response.end("Signed-in Z.ai reply");
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
        expect(response.ok).toBe(true);
        return response.json();
      };
      const status = () => request("/browser/status?provider=zai");
      try {
        await writeFile(attachmentPath, "Local test context");
        await writeFile(
          configPath,
          JSON.stringify({
            token: "test-token",
            port: 0,
            chromePath,
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

        // Reproduces the reported bug: editable input does not mean logged in.
        expect(await status()).toMatchObject({
          configured: false,
          browserOpen: true,
        });
        signedIn = true;
        await expect.poll(status).toMatchObject({ configured: true });
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
        expect(submissions).toBe(0);
        signedIn = true;
        await expect
          .poll(() => callbacks, { timeout: 20_000 })
          .toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                state: "completed",
                answer: "Signed-in Z.ai reply",
              }),
            ]),
          );
        expect(uploads).toBe(1);
        expect(submissions).toBe(1);
        expect(
          callbacks.some(
            (event) => event.state === "failed" || event.pageNotice,
          ),
        ).toBe(false);
      } finally {
        if (child && child.exitCode == null && child.signalCode == null) {
          await request("/shutdown", {}).catch(() => child!.kill("SIGTERM"));
          await expect.poll(() => child!.exitCode, { timeout: 10_000 }).toBe(0);
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
