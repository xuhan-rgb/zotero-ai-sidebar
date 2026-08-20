import { chromium } from "../web-agent/node_modules/playwright-core/index.mjs";

const homeOnly = process.argv.includes("--home");
const requestedMode = process.argv
  .find((argument) => argument.startsWith("--mode="))
  ?.slice("--mode=".length);

const context = await chromium.launchPersistentContext(
  "/home/qwer/.local/share/zotero-ai-sidebar/browser-profile",
  {
    executablePath: "/usr/bin/google-chrome",
    headless: false,
    viewport: { width: 1500, height: 1000 },
  },
);

let page = context.pages().find((candidate) =>
  candidate.url().includes("chat.deepseek.com"),
);
if (!page) {
  page = context.pages()[0] ?? (await context.newPage());
  await page.goto("https://chat.deepseek.com/", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
}
await page.bringToFront();
await page.waitForTimeout(5_000);

if (requestedMode) {
  const labels = {
    fast: "快速模式",
    expert: "专家模式",
    vision: "识图模式",
  };
  const label = labels[requestedMode];
  if (!label) throw new Error(`Unknown mode: ${requestedMode}`);
  await page
    .locator("[role='radiogroup'] [role='radio']")
    .filter({ hasText: label })
    .filter({ visible: true })
    .first()
    .click();
  await page.waitForTimeout(2_000);
}

if (!homeOnly && (await page.locator(".ds-markdown").count()) === 0) {
  const conversation = page.getByText("LAW论文整理", { exact: true }).first();
  if ((await conversation.count()) > 0) {
    await conversation.click();
    await page.waitForTimeout(5_000);
  }
}

const nodes = page.locator(
  '.ds-markdown, [class*="ds-markdown"], [class*="markdown"]:not([contenteditable="true"])',
);
const count = await nodes.count();
const start = Math.max(0, count - 8);
const result = [];
for (let index = start; index < count; index += 1) {
  result.push(
    await nodes.nth(index).evaluate((root, nodeIndex) => {
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const describe = (element) => ({
        tag: element.tagName.toLowerCase(),
        class: element.getAttribute("class") || "",
        role: element.getAttribute("role") || "",
        ariaExpanded: element.getAttribute("aria-expanded") || "",
        text: clean(element.textContent).slice(0, 180),
        controls: [...element.querySelectorAll("button, summary, [role='button']")]
          .map((control) => clean(control.textContent))
          .filter(Boolean)
          .slice(0, 8),
        children: [...element.children].slice(0, 12).map((child) => ({
          tag: child.tagName.toLowerCase(),
          class: child.getAttribute("class") || "",
          text: clean(child.textContent).slice(0, 100),
        })),
      });
      const ancestors = [];
      let current = root;
      for (let depth = 0; current && depth < 9; depth += 1) {
        ancestors.push(describe(current));
        current = current.parentElement;
      }
      const rect = root.getBoundingClientRect();
      return {
        index: nodeIndex,
        text: clean(root.textContent).slice(0, 500),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        ancestors,
      };
    }, index),
  );
}

const messageTree = (await page.locator(".ds-message").count())
  ? await page.locator(".ds-message").last().evaluate((root) => {
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const walk = (element, depth = 0) => ({
    tag: element.tagName.toLowerCase(),
    class: element.getAttribute("class") || "",
    text: clean(element.textContent).slice(0, 160),
    children:
      depth >= 5
        ? []
        : [...element.children].map((child) => walk(child, depth + 1)),
  });
  return walk(root);
    })
  : null;
const controls = await page
  .locator("textarea, [contenteditable='true'], button, [role='button']")
  .evaluateAll((elements) =>
    elements
      .map((element, index) => ({
        index,
        tag: element.tagName.toLowerCase(),
        class: element.getAttribute("class") || "",
        text: String(element.textContent || "").replace(/\s+/g, " ").trim(),
        placeholder: element.getAttribute("placeholder") || "",
        ariaLabel: element.getAttribute("aria-label") || "",
        ariaPressed: element.getAttribute("aria-pressed") || "",
        contenteditable: element.getAttribute("contenteditable") || "",
        disabled: element.hasAttribute("disabled"),
      }))
      .filter(
        (item) =>
          item.placeholder ||
          item.contenteditable === "true" ||
          /快速模式|专家模式|识图模式|深度思考|智能搜索|发送/.test(item.text),
      ),
  );
const modeControls = [];
for (const label of ["快速模式", "专家模式", "识图模式", "深度思考", "智能搜索"]) {
  const matches = page.getByText(label, { exact: true });
  for (let index = 0; index < (await matches.count()); index += 1) {
    modeControls.push(
      await matches.nth(index).evaluate((element, text) => {
        const ancestors = [];
        let current = element;
        for (let depth = 0; current && depth < 5; depth += 1) {
          ancestors.push({
            tag: current.tagName.toLowerCase(),
            class: current.getAttribute("class") || "",
            role: current.getAttribute("role") || "",
            ariaPressed: current.getAttribute("aria-pressed") || "",
            tabindex: current.getAttribute("tabindex") || "",
            text: String(current.textContent || "").replace(/\s+/g, " ").trim(),
          });
          current = current.parentElement;
        }
        return { label: text, ancestors };
      }, label),
    );
  }
}

await page.screenshot({ path: "/tmp/deepseek-dom-inspection.png", fullPage: false });
process.stdout.write(
  `${JSON.stringify({ url: page.url(), count, controls, modeControls, messageTree, nodes: result }, null, 2)}\n`,
);
await context.close();
