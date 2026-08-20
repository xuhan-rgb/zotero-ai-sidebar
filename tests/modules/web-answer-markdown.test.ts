// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// `answerNodeMarkdown` converts the web answer DOM to Markdown inside
// `page.evaluate`, so Playwright serializes it and it cannot import anything.
// Run the shipped callback source against a real DOM instead of asserting on
// source text: the leak this guards against is a DOM traversal bug.
const agent = readFileSync(resolve(process.cwd(), "web-agent/agent.mjs"), "utf8");
const evaluateStart = agent.indexOf("return answer.evaluate((root) => {");
const evaluateEnd = agent.indexOf(
  "}, undefined, { timeout: 2_000 });",
  evaluateStart,
);
const converterSource = agent.slice(
  agent.indexOf("{", agent.indexOf("(root) =>", evaluateStart)) + 1,
  agent.lastIndexOf("}", evaluateEnd),
);

const controlRuleStart = converterSource.indexOf(
  '      const role = element.getAttribute("role") || "";',
);
const controlRuleEnd = converterSource.indexOf(
  "      // File download links can carry",
);
const withoutControlRule =
  converterSource.slice(0, controlRuleStart) +
  converterSource.slice(controlRuleEnd);

function convert(source: string, html: string): string {
  document.body.innerHTML = html;
  const run = new Function("root", source) as (root: Element) => string;
  return run(document.body.firstElementChild as Element);
}

// DeepSeek renders a Mermaid block as a card with its own tab strip and
// toolbar. The 2026-08-19 answer stored by the sidebar contained the literal
// text "图表代码下载全屏渲染失败", so the user saw a "下载" that was never a link.
const DEEPSEEK_CHART_CARD = `
  <div class="ds-assistant-message-main-content">
    <p>根据论文内容，我生成了一个端到端自动驾驶流程图。</p>
    <div class="md-code-block">
      <div role="tablist">
        <div role="tab">图表</div>
        <div role="tab">代码</div>
      </div>
      <div class="toolbar">
        <button type="button">下载</button>
        <button type="button">全屏</button>
      </div>
      <div class="render-error">渲染失败</div>
    </div>
    <p>流程说明：视觉编码器提取潜变量。</p>
  </div>`;

// The SVG sync runs the same way: a callback serialized into the page.
const svgFilterStart = agent.indexOf(
  "const markup = await svg.evaluate((element, ordinal) => {",
);
const svgFilterSource = agent.slice(
  agent.indexOf("{", agent.indexOf("(element, ordinal) =>", svgFilterStart)) + 1,
  agent.indexOf("}, images.length + 1).catch(() => \"\");", svgFilterStart),
);

function extractSvg(element: Element, width: number, height: number): string {
  // happy-dom reports a zero-sized box for every node, so state the rendered
  // size the browser would report for this element.
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ width, height }),
  });
  const run = new Function("element", "ordinal", svgFilterSource) as (
    element: Element,
    ordinal: number,
  ) => string;
  return run(element, 1);
}

function svgIn(html: string): Element {
  document.body.innerHTML = html;
  return document.body.querySelector("svg") as Element;
}

describe("rendered SVG sync", () => {
  it("skips toolbar icons that live inside a control", () => {
    const icon = svgIn(
      `<div class="toolbar">
         <button type="button">下载
           <svg viewBox="0 0 24 24"><path d="M12 3v12"></path></svg>
         </button>
       </div>`,
    );

    // Even at chart size an icon inside a control is never answer content.
    expect(extractSvg(icon, 400, 300)).toBe("");
  });

  it("skips the icon-sized placeholder shown next to 渲染失败", () => {
    const placeholder = svgIn(
      `<div class="render-error">
         <svg viewBox="0 0 48 48"><path d="M4 4h40v40H4z"></path></svg>
         <span>渲染失败</span>
       </div>`,
    );

    expect(extractSvg(placeholder, 48, 48)).toBe("");
  });

  it("skips a large but structureless decorative SVG", () => {
    const decoration = svgIn(
      `<div><svg viewBox="0 0 400 300"><path d="M0 0h400v300H0z"></path></svg></div>`,
    );

    expect(extractSvg(decoration, 400, 300)).toBe("");
  });

  it("keeps a rendered chart and strips its scripts and external refs", () => {
    const nodes = Array.from({ length: 6 }, (_, index) =>
      `<g><rect x="${index * 40}" y="0" width="30" height="20"></rect>` +
      `<text x="${index * 40}" y="15">节点 ${index}</text></g>`,
    ).join("");
    const chart = svgIn(
      `<div class="md-code-block">
         <svg viewBox="0 0 400 300" onclick="steal()">
           <image href="https://tracker.example.com/pixel.png"></image>
           ${nodes}
         </svg>
       </div>`,
    );
    // happy-dom's parser swallows the rest of an SVG after an inline
    // <script>, so attach it through the DOM instead of the markup string.
    const script = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "script",
    );
    script.textContent = "steal()";
    chart.append(script);

    const markup = extractSvg(chart, 720, 480);

    expect(markup).toContain("节点 0");
    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("onclick");
    expect(markup).not.toContain("tracker.example.com");
  });
});

describe("web answer DOM to Markdown", () => {
  it("keeps chart card controls out of the answer body", () => {
    const markdown = convert(converterSource, DEEPSEEK_CHART_CARD);

    expect(markdown).toContain("端到端自动驾驶流程图");
    expect(markdown).toContain("视觉编码器提取潜变量");
    expect(markdown).not.toContain("下载");
    expect(markdown).not.toContain("全屏");
    expect(markdown).not.toContain("图表");
    expect(markdown).not.toContain("代码");
  });

  it("proves the control rule is what stops the leak", () => {
    // Without the rule the same DOM reproduces the reported answer text.
    const leaked = convert(withoutControlRule, DEEPSEEK_CHART_CARD);

    expect(controlRuleStart).toBeGreaterThan(0);
    expect(leaked.replace(/\s+/g, "")).toContain("图表代码下载全屏渲染失败");
  });

  it("still imports a real download anchor that is styled as a button", () => {
    const markdown = convert(
      converterSource,
      `<div class="answer">
         <p>文件已生成：
           <a role="button" href="https://example.com/files/flowchart.pdf">flowchart.pdf</a>
         </p>
       </div>`,
    );

    expect(markdown).toContain(
      "[flowchart.pdf](https://example.com/files/flowchart.pdf)",
    );
  });

  it("leaves a placeholder only where a synced chart stood", () => {
    const markdown = convert(
      converterSource,
      `<div class="answer">
         <p>流程图如下：</p>
         <div class="card"><svg data-zai-chart="1" viewBox="0 0 10 10"></svg></div>
         <p>使用说明：</p>
         <div class="toolbar"><svg viewBox="0 0 24 24"></svg></div>
       </div>`,
    );

    expect(markdown).toContain("[[zai-web-chart:1]]");
    expect(markdown.match(/\[\[zai-web-chart:/g)).toHaveLength(1);
    // The placeholder must sit between the two paragraphs, not at the end.
    expect(markdown.indexOf("流程图如下")).toBeLessThan(
      markdown.indexOf("[[zai-web-chart:1]]"),
    );
    expect(markdown.indexOf("[[zai-web-chart:1]]")).toBeLessThan(
      markdown.indexOf("使用说明"),
    );
  });

  it("keeps a sandbox anchor as plain text because Zotero cannot open it", () => {
    const markdown = convert(
      converterSource,
      `<div class="answer">
         <p><a href="sandbox:/mnt/data/chart.png">chart.png</a></p>
       </div>`,
    );

    expect(markdown).toContain("chart.png");
    expect(markdown).not.toContain("sandbox:");
    expect(markdown).not.toContain("](");
  });
});
