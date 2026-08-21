import { describe, expect, it } from "vitest";

import type { Message } from "../../src/providers/types";
import {
  buildWebPrompt,
  completedWebHistory,
} from "../../src/modules/web-prompt-format";

describe("WEB prompt formatting", () => {
  it("requires a first-response download link for file-generation tasks", () => {
    const prompt = buildWebPrompt({
      content: "帮我生成一个 PDF 流程图",
      title: "LAW",
      selectedText: "",
      history: [],
    });
    expect(prompt).toContain("## 文件输出要求");
    expect(prompt).toContain("首次回答中提供可点击的下载链接或网页附件卡片");
    expect(prompt).toContain(
      "生成工具返回 /mnt/data/、/tmp/ 等网页沙盒路径时，不要把路径当作交付结果",
    );
    expect(prompt).toContain("不要只返回本地沙盒路径");
    expect(prompt).toContain("只输出路径视为任务未完成");
  });

  it("does not ask DeepSeek Web for unusable sandbox download links", () => {
    const prompt = buildWebPrompt({
      content: "帮我生成一个 PNG 流程图",
      title: "LAW",
      selectedText: "",
      history: [],
      webProvider: "deepseek",
    });
    expect(prompt).toContain("只有当前网页确实显示真实可下载的文件附件卡片");
    expect(prompt).toContain("严禁输出 sandbox:/、https://sandbox:/、/mnt/data/、/tmp/");
    expect(prompt).toContain("当前网页未提供可下载附件");
    expect(prompt).toContain("Mermaid、SVG、Graphviz DOT");
    expect(prompt).not.toContain("首次回答中提供可点击的下载链接或网页附件卡片");
  });

  it("structures the current task and supplied paper context", () => {
    const prompt = buildWebPrompt({
      content: "解释这个方法为什么需要三维占用预测。",
      title: "OccWorld",
      selectedText: "We predict occupancy in latent space.",
      history: [],
      paperUrl: "https://arxiv.org/abs/2311.16038",
      attachmentKind: "latex",
    });

    expect(prompt).toContain("## 用户问题\n解释这个方法为什么需要三维占用预测。");
    expect(prompt).toContain("## 论文\nOccWorld");
    expect(prompt).toContain(
      "## 参考引用内容（来自 PDF 选区）",
    );
    expect(prompt).toContain(
      "--- 引用内容开始 ---\n\nWe predict occupancy in latent space.\n\n--- 引用内容结束 ---",
    );
    expect(prompt).toContain("不要声称读取了未提供的 PDF 内容");
    expect(prompt).toContain(
      "## 论文链接\nhttps://arxiv.org/abs/2311.16038",
    );
    expect(prompt).toContain("已随本消息附加论文的 LaTeX 主文件");
  });

  it("labels a chat citation separately from a PDF selection", () => {
    const prompt = buildWebPrompt({
      content: "解释",
      title: "Paper",
      selectedText: "前序 AI 回复",
      selectedTextOrigin: "chat",
      history: [],
    });
    expect(prompt).toContain("## 参考引用内容（来自 AI 助手回复）");
    expect(prompt).toContain("用户从 Zotero AI 对话的助手回复中选取的引用");
    expect(prompt).toContain("--- 引用内容开始 ---\n\n前序 AI 回复\n\n--- 引用内容结束 ---");
    expect(prompt).toContain("如果用户明确询问某个名词、术语或方法");
    expect(prompt).toContain("没有出现在“参考引用内容”中，不要强行建立关联");
    expect(prompt).toContain("如果用户省略了询问对象");
    expect(prompt).toContain("请明确说明歧义，不要编造引用关系");
    expect(prompt).not.toContain("当前 PDF 选区");
  });

  it("removes an unfinished WEB task pair from replayed history", () => {
    const history: Message[] = [
      { role: "user", content: "已完成的问题" },
      { role: "assistant", content: "已完成的回答" },
      {
        role: "user",
        content: "尚未完成的问题",
        task: task("web-pending", "ChatGPT Web"),
      },
      {
        role: "assistant",
        content: "已发送到 Prompt Hub，等待导入 ChatGPT 网页回答。",
        task: task("web-pending", "等待网页回答"),
      },
    ];

    expect(completedWebHistory(history).map((message) => message.content)).toEqual([
      "已完成的问题",
      "已完成的回答",
    ]);
    const prompt = buildWebPrompt({
      content: "新问题",
      title: "",
      selectedText: "",
      history,
      paperUrl: "",
      historyAttachmentAvailable: true,
      historyAttachmentName: "context.txt",
    });
    expect(prompt).not.toContain("Prompt Hub");
    expect(prompt).not.toContain("尚未完成的问题");
    expect(prompt).toContain("## 对话引用附件");
    expect(prompt).toContain("请先读取该文件");
    expect(prompt).not.toContain("用户：已完成的问题");
    expect(prompt).not.toContain("助手：已完成的回答");
    expect(prompt).toContain("## 用户问题\n新问题");
  });

  it("describes a PDF attachment without claiming the PDF was unavailable", () => {
    const prompt = buildWebPrompt({
      content: "总结方法。",
      title: "Paper",
      selectedText: "",
      history: [],
      paperUrl: "https://doi.org/10.1000/example",
      attachmentKind: "pdf",
    });

    expect(prompt).toContain("已随本消息附加论文 PDF");
    expect(prompt).not.toContain("不要声称读取了未提供的 PDF 内容");
  });

  it("describes reused paper material without claiming a new upload", () => {
    const prompt = buildWebPrompt({
      content: "继续解释网络结构。",
      title: "Paper",
      selectedText: "",
      history: [],
      paperUrl: "https://arxiv.org/abs/2501.12345",
      attachmentKind: "latex",
      attachmentAlreadyAvailable: true,
    });

    expect(prompt).toContain("前序消息已经附加论文 LaTeX 主文件");
    expect(prompt).toContain("无需重复上传");
    expect(prompt).toContain("本网页对话前序消息附加的 LaTeX");
    expect(prompt).not.toContain("已随本消息附加");
  });

  it("offers the annotation protocol to ordinary WEB tasks and requires it for an explicit annotation task", () => {
    const ordinary = buildWebPrompt({
      content: "总结论文",
      title: "Paper",
      selectedText: "",
      history: [],
    });
    const annotation = buildWebPrompt({
      content: "标注全文重点",
      title: "Paper",
      selectedText: "",
      history: [],
      annotationBatch: true,
      annotationColorGuide: "#2EA8E5 — 定义",
    });

    expect(ordinary).toContain("## 可选 PDF 标注输出约定");
    expect(ordinary).toContain("用户明确要求对 PDF 内容进行标注");
    expect(ordinary).toContain("普通问答、解释、总结、翻译、比较或推导");
    expect(ordinary).toContain("解释某个 PDF 句子或选区");
    expect(ordinary).toContain("原句含义、它在上下文中的作用");
    expect(ordinary).toContain("ZOTERO_ANNOTATIONS_V1");
    expect(annotation).toContain("ZOTERO_ANNOTATIONS_V1");
    expect(annotation).toContain("## Zotero WEB 批量标注输出协议");
    expect(annotation).not.toContain("## 可选 PDF 标注输出约定");
    expect(annotation).toContain("#2EA8E5 — 定义");
  });

  it("asks WEB explain-selection replies for a reusable single annotation draft", () => {
    const prompt = buildWebPrompt({
      content: "解释当前选区",
      title: "Paper",
      selectedText: "Selected PDF passage.",
      history: [],
      annotationSuggestion: true,
      annotationColorGuide: "#2EA8E5 — 定义",
    });

    expect(prompt).toContain("建议注释：");
    expect(prompt).toContain("1–3 条");
    expect(prompt).toContain("建议颜色：#hex");
    expect(prompt).toContain("#2EA8E5 — 定义");
    expect(prompt).not.toContain("## 可选 PDF 标注输出约定");
    expect(prompt).not.toContain("ZOTERO_ANNOTATIONS_V1");
  });

  it("keeps a completed WEB turn", () => {
    const history: Message[] = [
      {
        role: "user",
        content: "问题",
        task: task("web-complete", "DeepSeek Web"),
      },
      {
        role: "assistant",
        content: "回答",
        task: { ...task("web-complete", "网页回答"), completedAt: 10 },
      },
    ];
    expect(completedWebHistory(history)).toEqual(history);
  });
});

function task(id: string, title: string) {
  return {
    id,
    kind: "general" as const,
    title,
    promptPreview: "preview",
    createdAt: 1,
  };
}
