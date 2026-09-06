// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const chromePath = process.env.ZAI_TEST_CHROME || "/usr/bin/google-chrome";

describe.skipIf(!existsSync(chromePath) || !process.env.DISPLAY)(
  "Web Agent manual verification",
  () => {
    let dir: string;
    let child: ChildProcess;
    let fixture: http.Server;
    let port: number;
    let customProvider: Record<string, unknown>;
    let ready: boolean;
    let callbacks: Record<string, unknown>[];
    let submissions: number;
    let navigations: number;
    let quoteVerification: boolean;
    let verificationFailed: boolean;

    beforeEach(async () => {
      ready = false;
      callbacks = [];
      submissions = 0;
      navigations = 0;
      quoteVerification = false;
      verificationFailed = false;
      fixture = http.createServer(async (request, response) => {
        if (request.url === "/callback") {
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          callbacks.push(JSON.parse(Buffer.concat(chunks).toString()));
          response.end("ok");
        } else if (request.url === "/ready") {
          response.end(JSON.stringify(ready));
        } else if (request.url === "/submit") {
          submissions++;
          response.end("Local verification test reply");
        } else {
          if (request.url === "/" || request.url?.startsWith("/main/"))
            navigations++;
          response.setHeader("content-type", "text/html; charset=utf-8");
          // This is a local state fixture, with no CAPTCHA or security service.
          response.end(`<!doctype html><meta charset="utf-8">
          <main>${ready ? "" : `<h1>访问验证</h1><p>${verificationFailed ? "验证失败，请刷新" : "请按住滑块，拖动到最右边"}</p>`}</main>
          <script>
            const timer = setInterval(async () => {
              if (!await (await fetch('/ready')).json()) return;
              clearInterval(timer);
              document.querySelector('main').innerHTML =
                '<textarea></textarea><button>发送</button>' +
                ${JSON.stringify(quoteVerification ? "<blockquote><h2>访问验证</h2><p>请按住滑块，拖动到最右边</p></blockquote>" : "")};
              document.querySelector('button').onclick = async () => {
                const answer = await (await fetch('/submit')).text();
                const phase = document.createElement('p');
                phase.textContent = '思考结束';
                document.querySelector('main').append(phase);
                const node = document.createElement('div');
                node.className = 'answer';
                node.textContent = answer;
                document.querySelector('main').append(node);
                document.querySelector('textarea').value = '';
              };
            }, 100);
          </script>`);
        }
      });
      await new Promise<void>((resolve) =>
        fixture.listen(0, "127.0.0.1", resolve),
      );
      const url = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}`;
      customProvider = {
        id: "verification-fixture",
        name: "Local verification test",
        template: "chatgpt-like",
        homeUrl: "https://chatglm.cn/",
        newConversationUrl: "https://chatglm.cn/",
        selectors: {
          composer: ["textarea"],
          send: ["button"],
          stop: [".stop"],
          answers: [".answer"],
          attachmentPreviews: [],
          attachmentUploading: [],
        },
      };
      dir = await mkdtemp(path.join(os.tmpdir(), "zai-verification-"));
      // Mock the website at the network boundary in this isolated test profile.
      // No requests reach GLM or any other external website.
      const preloadPath = path.join(dir, "mock-website.mjs");
      await writeFile(
        preloadPath,
        `import { chromium } from ${JSON.stringify(pathToFileURL(path.resolve("web-agent/node_modules/playwright-core/index.mjs")).href)};
        const connect = chromium.connectOverCDP.bind(chromium);
        chromium.connectOverCDP = async (...args) => {
          const browser = await connect(...args);
          await browser.contexts()[0].route('**/*', async route => {
            const requested = new URL(route.request().url());
            const response = await fetch(${JSON.stringify(url)} + requested.pathname + requested.search);
            await route.fulfill({ status: response.status,
              headers: Object.fromEntries(response.headers),
              body: Buffer.from(await response.arrayBuffer()) });
          });
          return browser;
        };`,
      );
      const configPath = path.join(dir, "config.json");
      await writeFile(
        configPath,
        JSON.stringify({
          token: "fixture-token",
          port: 0,
          chromePath,
          profileDir: path.join(dir, "profile"),
          callbackUrl: `${url}/callback`,
        }),
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
      let errors = "";
      child.stderr!.on("data", (data) => {
        errors += data;
      });
      await expect
        .poll(async () => {
          if (child.exitCode != null) throw new Error(errors);
          const config = JSON.parse(await readFile(configPath, "utf8"));
          port = config.port;
          return port;
        })
        .toBeGreaterThan(0);
    });

    afterEach(async () => {
      if (child?.exitCode == null && child?.signalCode == null) {
        await request("/shutdown", {}).catch(() => child.kill("SIGTERM"));
        await expect.poll(() => child.exitCode, { timeout: 10_000 }).toBe(0);
      }
      fixture?.closeAllConnections();
      await new Promise<void>((resolve) => fixture?.close(() => resolve()));
      if (dir)
        await rm(dir, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
    });

    async function request(route: string, body?: unknown) {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: "Bearer fixture-token",
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      expect(response.ok).toBe(true);
      return response.json();
    }

    function status() {
      return request(
        `/browser/status?${new URLSearchParams({
          provider: "custom:verification-fixture",
          customProvider: JSON.stringify(customProvider),
        })}`,
      );
    }

    it("reports the access-verification page and becomes ready when the page is usable", async () => {
      expect(await status()).toMatchObject({
        browserOpen: true,
        configured: false,
        verificationRequired: true,
      });
      ready = true;
      await expect
        .poll(status)
        .toMatchObject({ configured: true, verificationRequired: false });
      expect(submissions).toBe(0);
    }, 30_000);

    it.each(["chatglm", "custom:verification-fixture"])(
      "reports failed GLM verification without treating it as ordinary login (%s)",
      async (provider) => {
        verificationFailed = true;
        expect(
          await request(
            `/browser/status?${new URLSearchParams({
              provider,
              customProvider: JSON.stringify(customProvider),
            })}`,
          ),
        ).toMatchObject({
          configured: false,
          verificationRequired: true,
        });
        expect(submissions).toBe(0);
        expect(navigations).toBe(1);
      },
      30_000,
    );

    it.each(["https://example.test/", "https://chatglm.cn.example.test/"])(
      "does not apply GLM verification handling to %s",
      async (url) => {
        customProvider.homeUrl = url;
        customProvider.newConversationUrl = url;
        expect(await status()).toMatchObject({
          configured: false,
          verificationRequired: false,
        });
      },
      30_000,
    );

    it("does not mistake quoted verification instructions in a usable chat for a challenge", async () => {
      quoteVerification = true;
      ready = true;
      await expect
        .poll(status)
        .toMatchObject({ configured: true, verificationRequired: false });
    }, 30_000);

    it("keeps ordinary background tasks headless when no verification is required", async () => {
      ready = true;
      customProvider.homeUrl = "https://example.test/";
      customProvider.newConversationUrl = "https://example.test/";
      await request("/tasks", {
        id: "ordinary-background",
        provider: "custom:verification-fixture",
        customProvider,
        sessionKey: "ordinary-background",
        prompt: "Local test",
        continuationPrompt: "Local test",
        hideBrowser: true,
      });
      await expect
        .poll(() => callbacks.find((event) => event.state === "completed"), {
          timeout: 20_000,
        })
        .toMatchObject({ answer: "Local verification test reply" });
      expect(await request("/health")).toMatchObject({
        browserMode: "headless",
      });
      expect(submissions).toBe(1);
    }, 30_000);

    it
      .skipIf(!process.env.DISPLAY)
      .each(["chatglm", "custom:verification-fixture"])(
      "uses visible Chrome from the first GLM account check, before any challenge (%s)",
      async (provider) => {
        ready = true;
        await expect
          .poll(() =>
            request(
              `/browser/status?${new URLSearchParams({
                provider,
                customProvider: JSON.stringify(customProvider),
              })}`,
            ),
          )
          .toMatchObject({ configured: true });
        expect(await request("/health")).toMatchObject({
          browserMode: "visible",
        });
        expect(navigations).toBe(1);
        expect(submissions).toBe(0);
      },
      30_000,
    );

    it.skipIf(!process.env.DISPLAY)(
      "keeps a ready GLM session when hiding it and sending a background task without a prior challenge",
      async () => {
        ready = true;
        await request("/browser/open", {
          provider: "custom:verification-fixture",
          customProvider,
        });
        await expect.poll(status).toMatchObject({ configured: true });
        expect(
          await request("/browser/hide", {
            provider: "custom:verification-fixture",
            customProvider,
          }),
        ).toMatchObject({ browserOpen: true, configured: true, hidden: true });
        const before = navigations;
        await expect.poll(status).toMatchObject({ configured: true });
        expect(navigations).toBe(before);
        await request("/tasks", {
          id: "glm-no-challenge",
          provider: "custom:verification-fixture",
          customProvider,
          sessionKey: "glm-no-challenge",
          prompt: "Local test",
          continuationPrompt: "Local test",
          hideBrowser: true,
        });
        await expect
          .poll(() => callbacks, {
            timeout: 20_000,
          })
          .toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                state: "completed",
                answer: "Local verification test reply",
              }),
            ]),
          );
        expect(await request("/health")).toMatchObject({
          browserMode: "visible",
        });
        expect(submissions).toBe(1);
      },
      30_000,
    );

    it.skipIf(!process.env.DISPLAY)(
      "keeps a visible task page intact while checking account status",
      async () => {
        await request("/tasks", {
          id: "visible-verification",
          provider: "custom:verification-fixture",
          customProvider,
          sessionKey: "visible-session",
          prompt: "Local test",
          continuationPrompt: "Local test",
          hideBrowser: false,
        });
        await expect
          .poll(
            () => callbacks.some((event) => event.state === "needs_login"),
            { timeout: 10_000 },
          )
          .toBe(true);
        const before = navigations;
        expect(await status()).toMatchObject({
          configured: false,
          verificationRequired: true,
        });
        expect(await request("/health")).toMatchObject({
          browserMode: "visible",
        });
        expect(navigations).toBe(before);
        expect(callbacks.some((event) => event.state === "failed")).toBe(false);
        await request("/tasks/cancel", { id: "visible-verification" });
        await expect
          .poll(() => callbacks.some((event) => event.state === "cancelled"))
          .toBe(true);
        await expect
          .poll(async () => (await request("/health")).active)
          .toEqual({});
        expect(submissions).toBe(0);
      },
      30_000,
    );

    it.skipIf(!process.env.DISPLAY)(
      "shows a blocked background task, waits, and submits only once after manual readiness",
      async () => {
        await request("/tasks", {
          id: "background-verification",
          provider: "custom:verification-fixture",
          customProvider,
          sessionKey: "background-session",
          prompt: "Local test",
          continuationPrompt: "Local test",
          hideBrowser: true,
        });
        await expect
          .poll(
            () => callbacks.some((event) => event.state === "needs_login"),
            { timeout: 10_000 },
          )
          .toBe(true);
        expect(await request("/health")).toMatchObject({
          browserMode: "visible",
        });
        expect(submissions).toBe(0);
        const before = navigations;
        expect(await status()).toMatchObject({ verificationRequired: true });
        expect(navigations).toBe(before);
        ready = true;
        await expect
          .poll(() => callbacks.find((event) => event.state === "completed"), {
            timeout: 20_000,
          })
          .toMatchObject({ answer: "Local verification test reply" });
        expect(submissions).toBe(1);
        expect(navigations).toBe(before);
        expect(callbacks.some((event) => event.state === "failed")).toBe(false);
      },
      30_000,
    );

    it.skipIf(!process.env.DISPLAY)(
      "keeps unfinished verification open when account setup is closed",
      async () => {
        await request("/browser/open", {
          provider: "custom:verification-fixture",
          customProvider,
        });
        expect(
          await request("/browser/hide", {
            provider: "custom:verification-fixture",
            customProvider,
          }),
        ).toMatchObject({
          configured: false,
          browserOpen: true,
          hidden: false,
          verificationRequired: true,
        });
        expect(await request("/health")).toMatchObject({
          browserMode: "visible",
        });
        ready = true;
        await expect.poll(status).toMatchObject({ configured: true });
      },
      30_000,
    );

    it.skipIf(!process.env.DISPLAY)(
      "preserves the verified browser when returning to background conversations",
      async () => {
        await request("/browser/open", {
          provider: "custom:verification-fixture",
          customProvider,
        });
        ready = true;
        await expect.poll(status).toMatchObject({ configured: true });
        const before = navigations;
        expect(
          await request("/browser/hide", {
            provider: "custom:verification-fixture",
            customProvider,
          }),
        ).toMatchObject({
          configured: true,
          browserOpen: true,
          hidden: true,
        });
        expect(await status()).toMatchObject({ configured: true });
        expect(navigations).toBe(before);
        await request("/tasks", {
          id: "verified-background",
          provider: "custom:verification-fixture",
          customProvider,
          sessionKey: "verified-background",
          prompt: "Local test",
          continuationPrompt: "Local test",
          hideBrowser: true,
        });
        await expect
          .poll(() => callbacks.find((event) => event.state === "completed"), {
            timeout: 20_000,
          })
          .toMatchObject({ answer: "Local verification test reply" });
        expect(await request("/health")).toMatchObject({
          browserMode: "visible",
        });
        expect(submissions).toBe(1);
      },
      30_000,
    );

    it.skipIf(!process.env.DISPLAY)(
      "does not carry GLM session preservation into another provider's background task",
      async () => {
        await request("/browser/open", {
          provider: "custom:verification-fixture",
          customProvider,
        });
        ready = true;
        await expect.poll(status).toMatchObject({ configured: true });
        await request("/browser/hide", {
          provider: "custom:verification-fixture",
          customProvider,
        });
        expect(await request("/health")).toMatchObject({
          browserMode: "visible",
        });
        const otherProvider = {
          ...customProvider,
          id: "other-fixture",
          homeUrl: "https://example.test/",
          newConversationUrl: "https://example.test/",
        };
        await request("/tasks", {
          id: "other-background",
          provider: "custom:other-fixture",
          customProvider: otherProvider,
          sessionKey: "other-background",
          prompt: "Local test",
          continuationPrompt: "Local test",
          hideBrowser: true,
        });
        await expect
          .poll(() => callbacks.find((event) => event.state === "completed"), {
            timeout: 20_000,
          })
          .toMatchObject({ answer: "Local verification test reply" });
        expect(await request("/health")).toMatchObject({
          browserMode: "headless",
        });
        expect(submissions).toBe(1);
      },
      30_000,
    );
  },
);
