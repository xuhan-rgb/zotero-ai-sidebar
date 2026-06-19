import { describe, expect, it } from "vitest";
import { stripSummarySectionHTML } from "../../src/modules/note-html-utils";

const strip = (html: string) => stripSummarySectionHTML(html, document);

// Mirror the real persisted shape: each appended block is
//   <hr> + <h2>AI 总结 时间戳</h2> + <h2>沉浸阅读对话总结（N 段）</h2> + body
const summaryBlock = (time: string, body: string) =>
  `<hr><h2>AI 总结 ${time}</h2><h2>沉浸阅读对话总结（1 段）</h2>${body}`;

describe("stripSummarySectionHTML", () => {
  it("returns input unchanged when no summary marker is present", () => {
    const html = "<p>我的笔记</p><hr><h2>AI 总结 05:00</h2><p>别的写入内容</p>";
    expect(strip(html)).toBe(html);
  });

  it("removes the whole summary block, including its <hr> and AI 总结 wrapper", () => {
    const html =
      "<h1>AI 笔记</h1><p>我的笔记</p>" + summaryBlock("05:27", "<p>总结内容</p>");
    const out = strip(html);
    expect(out).toContain("我的笔记");
    expect(out).not.toContain("AI 总结");
    expect(out).not.toContain("沉浸阅读对话总结");
    expect(out).not.toContain("总结内容");
  });

  it("removes multiple stacked summary blocks", () => {
    const html =
      "<p>笔记</p>" +
      summaryBlock("05:26", "<p>旧一</p>") +
      summaryBlock("05:27", "<p>旧二</p>");
    const out = strip(html);
    expect(out).toContain("笔记");
    expect(out).not.toContain("沉浸阅读对话总结");
    expect(out).not.toContain("旧一");
    expect(out).not.toContain("旧二");
  });

  it("keeps other (non-summary) AI 总结 blocks intact", () => {
    const html =
      summaryBlock("05:00", "<p>旧总结</p>") +
      "<hr><h2>AI 总结 06:00</h2><p>其它写入笔记内容</p>";
    const out = strip(html);
    expect(out).not.toContain("沉浸阅读对话总结");
    expect(out).not.toContain("旧总结");
    expect(out).toContain("其它写入笔记内容");
  });

  it("does not delete user content that merely mentions the phrase inline", () => {
    const html = "<p>我在写沉浸阅读对话总结相关的笔记</p>";
    // No <hr>-delimited block → nothing removed.
    expect(strip(html)).toBe(html);
  });

  it("returns empty input unchanged", () => {
    expect(strip("")).toBe("");
  });
});
