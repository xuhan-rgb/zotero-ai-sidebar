import { describe, expect, it } from "vitest";

import {
  hasWebAnnotationProtocol,
  parseWebAnnotationBatch,
  webAnnotationTaskQuestion,
  webOptionalAnnotationProtocolInstructions,
  webAnnotationProtocolInstructions,
} from "../../src/modules/web-annotation-batch";

describe("WEB annotation batch protocol", () => {
  it("extracts a strict manifest and removes it from the visible answer", () => {
    const answer = [
      "已选出两条重点句。",
      "",
      "---ZOTERO_ANNOTATIONS_V1---",
      JSON.stringify({
        annotations: [
          {
            quote: "The first exact PDF sentence.",
            comment: "定义：核心概念。",
            color: "#2EA8E5",
          },
          {
            quote: "The second exact PDF sentence.",
            comment: "结果：报告主要发现。",
            color: "#ff6666",
          },
        ],
      }),
      "---END_ZOTERO_ANNOTATIONS---",
    ].join("\n");

    const parsed = parseWebAnnotationBatch(answer);

    expect(parsed.body).toBe("已选出两条重点句。");
    expect(parsed.error).toBeNull();
    expect(parsed.annotations).toEqual([
      {
        quote: "The first exact PDF sentence.",
        comment: "定义：核心概念。",
        color: "#2ea8e5",
      },
      {
        quote: "The second exact PDF sentence.",
        comment: "结果：报告主要发现。",
        color: "#ff6666",
      },
    ]);
  });

  it("accepts DeepSeek's symmetric V1 end marker", () => {
    const answer = [
      "已按要求选择重点原句。",
      "---ZOTERO_ANNOTATIONS_V1---",
      JSON.stringify({
        annotations: [
          {
            quote: "The exact sentence returned by DeepSeek.",
            comment: "方法：值得标注。",
            color: "#5fb236",
          },
        ],
      }),
      "---END_ZOTERO_ANNOTATIONS_V1---",
    ].join("\n");

    expect(hasWebAnnotationProtocol(answer)).toBe(true);
    expect(parseWebAnnotationBatch(answer)).toEqual({
      body: "已按要求选择重点原句。",
      error: null,
      annotations: [
        {
          quote: "The exact sentence returned by DeepSeek.",
          comment: "方法：值得标注。",
          color: "#5fb236",
        },
      ],
    });
  });

  it("accepts a standalone annotations JSON block when DeepSeek omits both markers", () => {
    const answer = [
      "json",
      "",
      "```",
      JSON.stringify({
        annotations: [
          {
            quote: "A verbatim sentence from the supplied PDF.",
            comment: "定义：核心原句。",
            color: "#2ea8e5",
          },
        ],
      }),
      "```",
    ].join("\n");

    expect(hasWebAnnotationProtocol(answer)).toBe(true);
    expect(parseWebAnnotationBatch(answer)).toEqual({
      body: "",
      error: null,
      annotations: [
        {
          quote: "A verbatim sentence from the supplied PDF.",
          comment: "定义：核心原句。",
          color: "#2ea8e5",
        },
      ],
    });
  });

  it("does not treat an annotations JSON example inside a normal answer as a draft", () => {
    const answer = [
      "下面只是格式示例，不是本轮标注结果。",
      "```json",
      '{"annotations":[{"quote":"example","comment":"example"}]}',
      "```",
    ].join("\n");

    expect(hasWebAnnotationProtocol(answer)).toBe(false);
    expect(parseWebAnnotationBatch(answer)).toEqual({
      body: answer,
      annotations: [],
      error: null,
    });
  });

  it("leaves ordinary WEB answers untouched", () => {
    const answer = "普通回答，包含原文、注释和颜色，但没有协议块。";
    expect(parseWebAnnotationBatch(answer)).toEqual({
      body: answer,
      annotations: [],
      error: null,
    });
  });

  it("detects a complete annotation protocol in an otherwise ordinary WEB answer", () => {
    expect(
      hasWebAnnotationProtocol(
        "回答\n---ZOTERO_ANNOTATIONS_V1---\n{}\n---END_ZOTERO_ANNOTATIONS---",
      ),
    ).toBe(true);
    expect(hasWebAnnotationProtocol("---ZOTERO_ANNOTATIONS_V1---\n{}"))
      .toBe(false);
  });

  it("reports malformed manifests without inventing annotations", () => {
    const answer = [
      "生成完成。",
      "---ZOTERO_ANNOTATIONS_V1---",
      "{not-json}",
      "---END_ZOTERO_ANNOTATIONS---",
    ].join("\n");
    const parsed = parseWebAnnotationBatch(answer);
    expect(parsed.body).toBe("生成完成。");
    expect(parsed.annotations).toEqual([]);
    expect(parsed.error).toContain("JSON");
  });

  it("builds WEB-only instructions with configured color choices", () => {
    const prompt = webAnnotationProtocolInstructions(
      "#2EA8E5 — 定义\n#FF6666 — 结果",
    );
    expect(prompt).toContain("---ZOTERO_ANNOTATIONS_V1---");
    expect(prompt).toContain('"quote"');
    expect(prompt).toContain("#2EA8E5 — 定义");
    expect(prompt).toContain("不要调用 Zotero 工具");
    expect(prompt).toContain("不得跨越独立公式");
    expect(prompt).toContain("从该标题开始，到下一个同级或更高级标题之前结束");
    expect(prompt).toContain("不得从摘要或其他章节补足数量");
    expect(prompt).toContain("不要使用 Markdown 代码围栏");
  });

  it("uses a WEB task that never asks the webpage to call local tools", () => {
    const task = webAnnotationTaskQuestion();
    expect(task).toContain("选择最值得在 PDF 中标注的重点原句");
    expect(task).not.toContain("zotero_annotate_passage");
    expect(task).not.toContain("zotero_get_reader_pdf_text");
  });

  it("offers sentence explanation and annotation output without forcing ordinary answers into the protocol", () => {
    const prompt = webOptionalAnnotationProtocolInstructions("#2EA8E5 — 定义");
    expect(prompt).toContain("解释某个 PDF 句子或选区");
    expect(prompt).toContain("仅当用户同时要求标注");
    expect(prompt).toContain("普通问答、解释、总结、翻译、比较或推导不要输出");
    expect(prompt).toContain("从该标题开始，到下一个同级或更高级标题之前结束");
    expect(prompt).toContain("不得从摘要或其他章节补足数量");
    expect(prompt).toContain("不要使用 Markdown 代码围栏");
    expect(prompt).toContain("---ZOTERO_ANNOTATIONS_V1---");
    expect(prompt).toContain("#2EA8E5 — 定义");
  });
});
