// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const { chromium } = createRequire(import.meta.url)(
  "../../web-agent/node_modules/playwright-core",
);
const chromePath = process.env.ZAI_TEST_CHROME || "/usr/bin/google-chrome";
const conversationURL = (cid: string) =>
  `https://chatglm.cn/main/alltoolsdetail?t=fixture&cid=${cid}&lang=zh`;

async function fixtureAgent(
  options: { publishURL?: boolean; rename?: boolean } = {},
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zai-conversation-test-"));
  const callbacks: Record<string, any>[] = [];
  const submissions: { cid: string; prompt: string }[] = [];
  const titles = new Map<string, string>();
  const renames: { conversation_id: string; title: string }[] = [];
  const threads = new Map<string, string[]>([
    ["manual-thread", ["Other paper"]],
  ]);
  const failures = new Map<string, number | "redirect" | "deleted" | "empty">();
  let uploads = 0;
  let nextID = 0;
  let uploadGate: Promise<void> | undefined;
  const site = http.createServer(async (request, response) => {
    const url = new URL(request.url!, "http://local");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    if (url.pathname === "/callback") {
      callbacks.push(JSON.parse(Buffer.concat(chunks).toString()));
      response.end("ok");
    } else if (url.pathname === "/submit") {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const cid = body.cid || `thread-${++nextID}`;
      submissions.push({ cid, prompt: body.prompt });
      const messages = threads.get(cid) || [];
      messages.push(`Reply ${messages.length + 1}: ${body.prompt}`);
      threads.set(cid, messages);
      response.end(JSON.stringify({ cid, answer: messages.at(-1) }));
    } else if (url.pathname.endsWith("/conversation/modify_title")) {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      renames.push(body);
      titles.set(body.conversation_id, body.title);
      response.end(JSON.stringify({ status: 0 }));
    } else if (url.pathname === "/upload") {
      uploads++;
      await uploadGate;
      response.end("ok");
    } else {
      const cid = url.searchParams.get("cid") || "";
      response.setHeader("content-type", "text/html; charset=utf-8");
      const failure = failures.get(cid);
      if (failure === "redirect") {
        response.writeHead(302, {
          location: "https://chatglm.cn/main/alltoolsdetail?lang=zh",
        });
        response.end();
        return;
      }
      if (failure && failure !== "empty") {
        response.statusCode = typeof failure === "number" ? failure : 200;
        response.end(
          `<div role="alert">${failure === "deleted" ? "此对话已被删除" : "暂时无法访问，请重新登录或稍后重试"}</div><textarea></textarea><button aria-label="发送">Send</button>`,
        );
        return;
      }
      response.end(`<!doctype html><meta charset="utf-8">
        <a href="${conversationURL("manual-thread")}">Other conversation</a>
        <main></main><textarea></textarea>
        <input type="file" multiple><button aria-label="发送">Send</button>
        ${options.rename ? `<aside id="aside-history-list"><div class="history-item selected"><div class="title"></div><div class="option">...</div><div class="operate" hidden><div class="operate-item">重命名</div><div class="operate-item">删除对话</div></div></div></aside><div class="changename_inner" hidden><textarea placeholder="输入名称"></textarea><div class="sure">确认</div><div class="cancel">取消</div></div>` : ""}
        <script>
          let cid = ${JSON.stringify(cid)};
          const composer = document.querySelector('textarea');
          const titleNode = document.querySelector('.title');
          if (titleNode) {
            titleNode.textContent = ${JSON.stringify(titles.get(cid) || "Auto title")};
            const editor = document.querySelector('.changename_inner');
            document.querySelector('.option').onclick = () => document.querySelector('.operate').hidden = false;
            document.querySelector('.operate-item').onclick = () => {
              document.querySelector('.operate').hidden = true;
              editor.hidden = false;
              editor.querySelector('textarea').value = titleNode.textContent;
            };
            editor.querySelector('.cancel').onclick = () => editor.hidden = true;
            editor.querySelector('.sure').onclick = async () => {
              const title = editor.querySelector('textarea').value;
              await fetch('/chatglm/mainchat-api/conversation/modify_title', { method: 'POST', body: JSON.stringify({ conversation_id: cid, title }) });
              titleNode.textContent = title;
              editor.hidden = true;
            };
          }
          function answer(text) {
            const node = document.createElement('div');
            node.className = 'markdown-body';
            node.textContent = text;
            document.querySelector('main').insertAdjacentHTML('beforeend', '<p>思考结束</p>');
            document.querySelector('main').append(node);
            document.querySelector('main').insertAdjacentHTML('beforeend', '<button aria-label="Copy">Copy</button>');
          }
          ${JSON.stringify(failure === "empty" ? [] : threads.get(cid) || [])}.forEach(answer);
          document.querySelector('a').onclick = event => {
            event.preventDefault();
            cid = 'manual-thread';
            history.pushState({}, '', event.currentTarget.href);
            document.querySelector('main').replaceChildren();
            answer('Other paper');
          };
          document.querySelector('input').onchange = async event => {
            await fetch('/upload', { method: 'POST' });
            for (const file of event.target.files) {
              const card = document.createElement('div');
              card.className = 'file-item';
              card.textContent = file.name;
              document.body.append(card);
            }
          };
          document.querySelector('[aria-label="发送"]').onclick = async () => {
            if (!composer.value.trim()) return;
            const result = await (await fetch('/submit', {
              method: 'POST', body: JSON.stringify({ cid, prompt: composer.value })
            })).json();
            cid = result.cid;
            if (${options.publishURL !== false}) history.replaceState({}, '', '/main/alltoolsdetail?t=fixture&cid=' + cid + '&lang=zh');
            composer.value = '';
            answer(result.answer);
          };
        </script>`);
    }
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  const configPath = path.join(dir, "config.json");
  const preload = path.join(dir, "local-site.mjs");
  const launcher = path.join(dir, "chrome.mjs");
  const attachmentPath = path.join(dir, "paper.txt");
  await writeFile(attachmentPath, "Local paper material");
  await writeFile(
    launcher,
    `#!${process.execPath}
    import { spawn } from 'node:child_process';
    const child = spawn(${JSON.stringify(chromePath)}, [
      ...process.argv.slice(2), '--headless=new', '--disable-background-networking'
    ]);
    child.on('exit', code => process.exit(code || 0));
    process.on('SIGTERM', () => child.kill('SIGTERM'));
  `,
  );
  await chmod(launcher, 0o700);
  await writeFile(
    configPath,
    JSON.stringify({
      token: "test-token",
      port: 0,
      chromePath: launcher,
      profileDir: path.join(dir, "profile"),
      callbackUrl: `${base}/callback`,
    }),
  );
  // Exercise the real Agent against a local website in a private headless
  // profile. Every page request is intercepted; no real accounts are used.
  await writeFile(
    preload,
    `
    import { chromium } from ${JSON.stringify(pathToFileURL(path.resolve("web-agent/node_modules/playwright-core/index.mjs")).href)};
    const connect = chromium.connectOverCDP.bind(chromium);
    chromium.connectOverCDP = async (...args) => {
      const browser = await connect(...args);
      await browser.contexts()[0].route('**/*', async route => {
        const req = route.request();
        const url = new URL(req.url());
        const response = await fetch(${JSON.stringify(base)} + url.pathname + url.search, {
          method: req.method(), body: req.postDataBuffer() || undefined,
          redirect: 'manual'
        });
        await route.fulfill({ status: response.status,
          headers: Object.fromEntries(response.headers),
          body: Buffer.from(await response.arrayBuffer()) });
      });
      return browser;
    };
  `,
  );
  let child: ChildProcess;
  let browser: any;
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
  const start = async () => {
    child = spawn(
      process.execPath,
      ["--import", preload, path.resolve("web-agent/agent.mjs"), configPath],
      {
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    child.stderr!.on("data", (data) => {
      errors += data;
    });
    await expect
      .poll(
        async () => {
          if (child.exitCode != null) throw new Error(errors);
          const saved = JSON.parse(await readFile(configPath, "utf8"));
          port = saved.port;
          if (!port) return false;
          try {
            return (await request("/health")).instanceId === saved.instanceId;
          } catch {
            return false;
          }
        },
        { timeout: 10_000 },
      )
      .toBe(true);
  };
  const stop = async () => {
    if (child && child.exitCode == null && child.signalCode == null) {
      await request("/shutdown", {}).catch(() => child.kill("SIGTERM"));
      await expect.poll(() => child.exitCode, { timeout: 10_000 }).toBe(0);
    }
    browser = undefined;
  };
  const pages = async () => {
    if (!browser) {
      const endpoint = (
        await readFile(path.join(dir, "profile", "DevToolsActivePort"), "utf8")
      )
        .trim()
        .split("\n");
      browser = await chromium.connectOverCDP(
        `ws://127.0.0.1:${endpoint[0]}${endpoint[1]}`,
      );
    }
    return browser.contexts()[0].pages();
  };
  const send = async (
    id: string,
    paper = "paper-a",
    provider = "chatglm",
    paperTitle?: string,
  ) => {
    await request("/tasks", {
      id,
      provider,
      sessionKey: paper,
      paperTitle,
      ...(provider.startsWith("custom:")
        ? {
            customProvider: {
              id: provider.slice(7),
              name: "Local alternative",
              template: "chatgpt-like",
              homeUrl: "https://chatglm.cn/",
              newConversationUrl: "https://chatglm.cn/",
              selectors: {
                composer: ["textarea"],
                send: ["button[aria-label='发送']"],
                answers: [".markdown-body"],
              },
            },
          }
        : {}),
      prompt: `Full paper: ${id}`,
      continuationPrompt: id,
      hideBrowser: true,
      attachment: {
        kind: "text",
        path: attachmentPath,
        name: "paper.txt",
        mimeType: "text/plain",
      },
    });
    await expect
      .poll(
        () =>
          callbacks.find(
            (event) =>
              event.id === id &&
              ["completed", "failed", "cancelled"].includes(event.state),
          ),
        { timeout: 20_000 },
      )
      .toBeTruthy();
    return callbacks.find(
      (event) =>
        event.id === id &&
        ["completed", "failed", "cancelled"].includes(event.state),
    )!;
  };
  await start();
  return {
    send,
    pages,
    submissions,
    titles,
    renames,
    threads,
    failures,
    callbacks,
    request,
    start,
    stop,
    uploads: () => uploads,
    pauseUploads: () => {
      let release!: () => void;
      uploadGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    close: async () => {
      await stop();
      site.closeAllConnections();
      await new Promise<void>((resolve) => site.close(() => resolve()));
      await rm(dir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    },
  };
}

describe.skipIf(!existsSync(chromePath))(
  "paper to WEB conversation binding",
  () => {
    it("names the website conversation after the paper once and preserves later manual names", async () => {
      const agent = await fixtureAgent({ rename: true });
      try {
        expect(
          await agent.send("named", "paper-a", "chatglm", "论文 A: Test Paper"),
        ).toMatchObject({ state: "completed" });
        const cid = agent.submissions[0].cid;
        expect(agent.renames).toEqual([
          { conversation_id: cid, title: "论文 A: Test Paper" },
        ]);
        agent.titles.set(cid, "My manual title");
        await agent.stop();
        await agent.start();
        expect(
          await agent.send(
            "follow-up",
            "paper-a",
            "chatglm",
            "论文 A: Test Paper",
          ),
        ).toMatchObject({ state: "completed" });
        expect(agent.renames).toHaveLength(1);
        expect(agent.titles.get(cid)).toBe("My manual title");
        expect(agent.submissions.at(-1)?.cid).toBe(cid);
      } finally {
        await agent.close();
      }
    }, 45_000);

    it("reuses one task tab when switching between papers without sharing their conversations", async () => {
      const agent = await fixtureAgent();
      try {
        expect(await agent.send("first-a")).toMatchObject({
          state: "completed",
        });
        const originalA = agent.submissions[0].cid;
        const page = (await agent.pages()).find((page: any) =>
          page.url().includes(`cid=${originalA}`),
        );
        expect(await agent.send("first-b", "paper-b")).toMatchObject({
          state: "completed",
        });
        const originalB = agent.submissions[1].cid;
        expect(originalB).not.toBe(originalA);
        expect(
          (await agent.pages()).filter((page: any) =>
            page.url().startsWith("https://chatglm.cn/"),
          ),
        ).toHaveLength(1);
        expect(page.url()).toContain(`cid=${originalB}`);
        expect(await agent.send("again-a")).toMatchObject({
          state: "completed",
        });
        expect(await agent.send("again-b", "paper-b")).toMatchObject({
          state: "completed",
        });
        expect(agent.submissions).toEqual([
          { cid: originalA, prompt: "Full paper: first-a" },
          { cid: originalB, prompt: "Full paper: first-b" },
          { cid: originalA, prompt: "again-a" },
          { cid: originalB, prompt: "again-b" },
        ]);
        expect(agent.uploads()).toBe(2);
        expect(
          (await agent.pages()).filter((page: any) =>
            page.url().startsWith("https://chatglm.cn/"),
          ),
        ).toEqual([page]);
      } finally {
        await agent.close();
      }
    }, 45_000);

    it("waits for the current paper's task before reusing its tab for a queued paper", async () => {
      const agent = await fixtureAgent();
      const release = agent.pauseUploads();
      try {
        const first = agent.send("queued-a");
        await expect.poll(agent.uploads, { timeout: 10_000 }).toBe(1);
        const second = agent.send("queued-b", "paper-b");
        await expect
          .poll(async () => (await agent.request("/health")).queued.chatglm)
          .toBe(1);
        expect(agent.uploads()).toBe(1);
        expect(agent.submissions).toHaveLength(0);
        release();
        expect(await first).toMatchObject({ state: "completed" });
        expect(await second).toMatchObject({ state: "completed" });
        expect(agent.submissions.map((item) => item.prompt)).toEqual([
          "Full paper: queued-a",
          "Full paper: queued-b",
        ]);
        expect(agent.submissions[0].cid).not.toBe(agent.submissions[1].cid);
        expect(
          (await agent.pages()).filter((page: any) =>
            page.url().includes("chatglm.cn"),
          ),
        ).toHaveLength(1);
      } finally {
        release();
        await agent.close();
      }
    }, 45_000);

    it("returns to the paper's conversation after manual navigation without re-uploading its paper", async () => {
      const agent = await fixtureAgent();
      try {
        expect(await agent.send("first")).toMatchObject({ state: "completed" });
        const original = agent.submissions[0].cid;
        const page = (await agent.pages()).find((page: any) =>
          page.url().includes(`cid=${original}`),
        );
        await page.getByRole("link", { name: "Other conversation" }).click();
        expect(await agent.send("follow-up")).toMatchObject({
          state: "completed",
        });
        expect(agent.submissions).toEqual([
          { cid: original, prompt: "Full paper: first" },
          { cid: original, prompt: "follow-up" },
        ]);
        expect(agent.uploads()).toBe(1);
      } finally {
        await agent.close();
      }
    }, 45_000);

    it("keeps separate paper bindings and upload state across closed tabs and Agent restarts", async () => {
      const agent = await fixtureAgent();
      try {
        expect(await agent.send("first-a")).toMatchObject({
          state: "completed",
        });
        expect(await agent.send("first-b", "paper-b")).toMatchObject({
          state: "completed",
        });
        const originalA = agent.submissions[0].cid;
        const originalB = agent.submissions[1].cid;
        expect(originalB).not.toBe(originalA);
        for (const page of await agent.pages()) await page.close();
        expect(await agent.send("closed-tab-a")).toMatchObject({
          state: "completed",
        });
        expect(agent.submissions.at(-1)).toEqual({
          cid: originalA,
          prompt: "closed-tab-a",
        });
        await agent.stop();
        await agent.start();
        expect(await agent.send("restarted-b", "paper-b")).toMatchObject({
          state: "completed",
        });
        expect(await agent.send("restarted-a")).toMatchObject({
          state: "completed",
        });
        expect(agent.submissions.slice(-2)).toEqual([
          { cid: originalB, prompt: "restarted-b" },
          { cid: originalA, prompt: "restarted-a" },
        ]);
        expect(agent.uploads()).toBe(2);
      } finally {
        await agent.close();
      }
    }, 60_000);

    it("preserves a binding on unavailable, redirected or empty pages instead of creating a new conversation", async () => {
      const agent = await fixtureAgent();
      try {
        expect(await agent.send("original")).toMatchObject({
          state: "completed",
        });
        const original = agent.submissions[0].cid;
        for (const failure of [500, 401, 404, "redirect", "empty"] as const) {
          agent.failures.set(original, failure);
          for (const page of await agent.pages()) await page.close();
          expect(await agent.send(`unavailable-${failure}`)).toMatchObject({
            state: "failed",
          });
          expect(agent.submissions).toHaveLength(1);
        }
        agent.failures.delete(original);
        expect(await agent.send("recovered")).toMatchObject({
          state: "completed",
        });
        expect(agent.submissions.at(-1)).toEqual({
          cid: original,
          prompt: "recovered",
        });
        expect(agent.uploads()).toBe(1);
      } finally {
        await agent.close();
      }
    }, 90_000);

    it.each([410, "deleted"] as const)(
      "rebinds and re-uploads only when deletion is explicit (%s)",
      async (failure) => {
        const agent = await fixtureAgent();
        try {
          expect(await agent.send("original")).toMatchObject({
            state: "completed",
          });
          const original = agent.submissions[0].cid;
          agent.failures.set(original, failure);
          for (const page of await agent.pages()) await page.close();
          expect(await agent.send("replacement")).toMatchObject({
            state: "completed",
          });
          const replacement = agent.submissions[1].cid;
          expect(replacement).not.toBe(original);
          expect(agent.submissions[1].prompt).toBe("Full paper: replacement");
          expect(await agent.send("continue-replacement")).toMatchObject({
            state: "completed",
          });
          expect(agent.submissions.at(-1)).toEqual({
            cid: replacement,
            prompt: "continue-replacement",
          });
          expect(agent.uploads()).toBe(2);
        } finally {
          await agent.close();
        }
      },
      45_000,
    );

    it("stops if the user changes conversations while an attachment is being prepared", async () => {
      const agent = await fixtureAgent();
      const release = agent.pauseUploads();
      try {
        const result = agent.send("preparing");
        await expect.poll(agent.uploads, { timeout: 10_000 }).toBe(1);
        const page = (await agent.pages()).find((page: any) =>
          page.url().includes("chatglm.cn"),
        );
        await page.getByRole("link", { name: "Other conversation" }).click();
        release();
        expect(await result).toMatchObject({ state: "failed" });
        expect(agent.submissions).toHaveLength(0);
      } finally {
        release();
        await agent.close();
      }
    }, 40_000);

    it("does not create another conversation after a sent question has no restorable URL", async () => {
      const agent = await fixtureAgent({ publishURL: false });
      try {
        // The website answered, but supplied no address that can be reopened.
        expect(await agent.send("no-url")).toMatchObject({
          state: "completed",
        });
        await agent.stop();
        await agent.start();
        expect(await agent.send("do-not-duplicate")).toMatchObject({
          state: "failed",
        });
        expect(agent.submissions).toHaveLength(1);
        expect(agent.uploads()).toBe(1);
      } finally {
        await agent.close();
      }
    }, 45_000);

    it("separates providers for the same paper and retains concurrent writes after restart", async () => {
      const agent = await fixtureAgent();
      try {
        expect(await agent.send("warm", "warm-up")).toMatchObject({
          state: "completed",
        });
        const results = await Promise.all([
          agent.send("glm-first", "shared-paper"),
          agent.send("alternate-first", "shared-paper", "custom:alternate"),
        ]);
        for (const result of results)
          expect(result).toMatchObject({ state: "completed" });
        const glm = agent.submissions.find(
          (item) => item.prompt === "Full paper: glm-first",
        )!.cid;
        const alternate = agent.submissions.find(
          (item) => item.prompt === "Full paper: alternate-first",
        )!.cid;
        expect(alternate).not.toBe(glm);
        expect(
          (await agent.pages()).filter((page: any) =>
            page.url().includes("chatglm.cn"),
          ),
        ).toHaveLength(2);
        await agent.stop();
        await agent.start();
        expect(await agent.send("glm-again", "shared-paper")).toMatchObject({
          state: "completed",
        });
        expect(
          await agent.send(
            "alternate-again",
            "shared-paper",
            "custom:alternate",
          ),
        ).toMatchObject({ state: "completed" });
        expect(agent.submissions.slice(-2)).toEqual([
          { cid: glm, prompt: "glm-again" },
          { cid: alternate, prompt: "alternate-again" },
        ]);
        expect(agent.uploads()).toBe(3);
      } finally {
        await agent.close();
      }
    }, 60_000);
  },
);
