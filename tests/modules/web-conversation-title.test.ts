// @vitest-environment node
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { renameWebConversation } from "../../web-agent/conversation-title.mjs";

const { chromium } = createRequire(import.meta.url)(
  "../../web-agent/node_modules/playwright-core",
);
const chromePath = process.env.ZAI_TEST_CHROME || "/usr/bin/google-chrome";
let browser: any;

afterEach(async () => {
  await browser?.close();
});

async function fixture() {
  browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
  });
  const page = await browser.newPage();
  const writes: { url: string; body: unknown }[] = [];
  let reject = false;
  await page.route("**/*", async (route: any) => {
    const req = route.request();
    if (req.method() === "POST") {
      writes.push({ url: req.url(), body: req.postDataJSON() });
      await route.fulfill({
        status: reject ? 500 : 200,
        contentType: "application/json",
        body: "{}",
      });
    } else {
      // Z.ai's public frontend renders a selected history button, opens the
      // title input on double-click, then posts { chat: { title } } on Enter.
      await route.fulfill({
        contentType: "text/html",
        body: `
        <button data-selected="true"><span class="title">Auto title</span><span class="chatItemMenu"></span></button>
        <input id="chat-title-input-thread-a" hidden>
        <script>
          const row = document.querySelector('button');
          const input = document.querySelector('input');
          row.ondblclick = () => { row.hidden = true; input.hidden = false; input.value = row.textContent; };
          input.onkeydown = async event => {
            if (event.key === 'Escape') { input.hidden = true; row.hidden = false; }
            if (event.key !== 'Enter') return;
            const response = await fetch('/api/v1/chats/thread-a', { method: 'POST', body: JSON.stringify({ chat: { title: input.value } }) });
            if (response.ok) row.querySelector('.title').textContent = input.value;
            input.hidden = true; row.hidden = false;
          };
        </script>`,
      });
    }
  });
  await page.goto("https://chat.z.ai/c/thread-a");
  return {
    page,
    writes,
    reject: (value: boolean) => {
      reject = value;
    },
  };
}

describe.skipIf(!existsSync(chromePath))("website conversation names", () => {
  it("saves a paper title through Z.ai's rename control and confirms its response", async () => {
    const { page, writes } = await fixture();
    expect(
      await renameWebConversation(
        page,
        "zai",
        page.url(),
        '论文 A: "VINS-Mono"',
      ),
    ).toBe(true);
    expect(writes).toEqual([
      {
        url: "https://chat.z.ai/api/v1/chats/thread-a",
        body: { chat: { title: '论文 A: "VINS-Mono"' } },
      },
    ]);
    expect(await page.locator(".title").textContent()).toBe(
      '论文 A: "VINS-Mono"',
    );
  });

  it("does not report a rejected rename as saved and allows a later retry", async () => {
    const site = await fixture();
    site.reject(true);
    expect(
      await renameWebConversation(site.page, "zai", site.page.url(), "Paper A"),
    ).toBe(false);
    expect(await site.page.locator(".title").textContent()).toBe("Auto title");
    site.reject(false);
    expect(
      await renameWebConversation(site.page, "zai", site.page.url(), "Paper A"),
    ).toBe(true);
    expect(site.writes).toHaveLength(2);
  });

  it("does not rename another conversation after manual navigation", async () => {
    const { page, writes } = await fixture();
    const bound = page.url();
    await page.goto("https://chat.z.ai/c/other-thread");
    expect(await renameWebConversation(page, "zai", bound, "Paper A")).toBe(
      false,
    );
    expect(writes).toHaveLength(0);
  });

  it("leaves the website alone when there is no paper title or supported rename control", async () => {
    const { page, writes } = await fixture();
    expect(await renameWebConversation(page, "zai", page.url(), "  ")).toBe(
      false,
    );
    expect(
      await renameWebConversation(
        page,
        "custom:example",
        page.url(),
        "Paper A",
      ),
    ).toBe(false);
    await page.locator("button").evaluate((node: HTMLElement) => node.remove());
    expect(
      await renameWebConversation(page, "zai", page.url(), "Paper A"),
    ).toBe(false);
    expect(writes).toHaveLength(0);
  });
});
