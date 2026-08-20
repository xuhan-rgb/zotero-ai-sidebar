// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { renderMarkdownInto } from "../../src/modules/markdown-render";
import {
  hasWebChartPlaceholder,
  stripWebChartPlaceholders,
  webChartImage,
  webChartPlaceholderOrdinal,
} from "../../src/modules/web-chart-placeholder";

const sidebar = readFileSync(
  resolve(process.cwd(), "src/modules/sidebar.ts"),
  "utf8",
);
const agent = readFileSync(
  resolve(process.cwd(), "web-agent/agent.mjs"),
  "utf8",
);

const IMAGES = [
  {
    id: "web-svg-1-0",
    name: "DeepSeek 图表 1.svg",
    mediaType: "image/svg+xml",
    dataUrl: "data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C/svg%3E",
    size: 12,
  },
];

describe("web chart placeholder", () => {
  it("recognizes only a standalone placeholder block", () => {
    expect(webChartPlaceholderOrdinal("[[zai-web-chart:1]]")).toBe(1);
    expect(webChartPlaceholderOrdinal("  [[zai-web-chart:12]] ")).toBe(12);
    expect(webChartPlaceholderOrdinal("见 [[zai-web-chart:1]] 图")).toBeNull();
    expect(webChartPlaceholderOrdinal("[[zai-web-chart:0]]")).toBeNull();
    expect(webChartPlaceholderOrdinal("普通段落")).toBeNull();
  });

  it("strips placeholders from text copied out of the answer", () => {
    expect(
      stripWebChartPlaceholders("图表如下\n\n[[zai-web-chart:1]]\n\n使用说明"),
    ).toBe("图表如下\n\n使用说明");
    expect(hasWebChartPlaceholder("图表如下\n\n[[zai-web-chart:1]]")).toBe(true);
    expect(stripWebChartPlaceholders("没有图表")).toBe("没有图表");
  });

  it("maps a 1-based ordinal onto the synced image list", () => {
    expect(webChartImage(IMAGES, 1)).toBe(IMAGES[0]);
    expect(webChartImage(IMAGES, 2)).toBeUndefined();
    expect(webChartImage(undefined, 1)).toBeUndefined();
  });

  it("renders the placeholder as its own block the sidebar can replace", () => {
    // The replacement scans `p, li`, so the renderer must not fold the
    // placeholder into surrounding prose.
    const host = document.createElement("div");
    renderMarkdownInto(
      host,
      "## Mermaid 流程图\n\n[[zai-web-chart:1]]\n\n## 使用说明\n\n将以上代码复制到编辑器。",
    );

    const blocks = Array.from(host.querySelectorAll("p, li"));
    const placeholder = blocks.filter(
      (block) => webChartPlaceholderOrdinal(block.textContent || "") === 1,
    );

    expect(placeholder).toHaveLength(1);
    // It sits between the two headings, not at the end of the message.
    const order = Array.from(host.children).map((child) => child.tagName);
    expect(order.indexOf("P")).toBeLessThan(order.lastIndexOf("H2"));
  });

  it("paints charts in place and keeps unplaced images in the tray", () => {
    expect(sidebar).toContain("function installWebChartImages(");
    expect(sidebar).toContain('el(doc, "figure", "message-chart")');
    expect(sidebar).toContain("block.replaceWith(figure)");
    expect(sidebar).toContain(
      "renderMessageImages(doc, root, message.images, placedCharts)",
    );
    expect(sidebar).toContain("!placedCharts?.has(index + 1)");
    expect(sidebar).toContain(
      "stripWebChartPlaceholders(message.content)",
    );
  });

  it("marks synced charts in the page and re-converts the answer", () => {
    expect(agent).toContain('element.setAttribute("data-zai-chart", String(ordinal))');
    expect(agent).toContain('const chart = element.getAttribute("data-zai-chart")');
    expect(agent).toContain("`\\n\\n[[zai-web-chart:${chart}]]\\n\\n`");
    expect(agent).toContain("async function answerMarkdownSnapshot(");
    // The chart sync has to run before the answer is converted again, and the
    // download links have to be appended after that.
    expect(agent.indexOf("const renderedImages = await extractRenderedSvgImages(")).
      toBeLessThan(agent.indexOf("result.answer = await materializeAnswerDownloads("));
    expect(agent).toContain("if (replaced) result.answer = replaced;");
  });

  it("keeps Mermaid labels by no longer deleting foreignObject", () => {
    expect(agent).toContain('clone.querySelectorAll("script").forEach');
    expect(agent).not.toContain('querySelectorAll("script, foreignObject")');
    expect(agent).toContain("htmlLabels: true");
    expect(agent).toContain("/^(href|xlink:href|src)$/i");
  });
});
