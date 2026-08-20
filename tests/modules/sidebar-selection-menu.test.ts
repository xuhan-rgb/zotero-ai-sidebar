import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  contextSummaryLine,
  formatUserMessageForApi,
} from "../../src/context/message-format";
import type { Message } from "../../src/providers/types";

const sidebarSource = readFileSync(
  resolve(process.cwd(), "src/modules/sidebar.ts"),
  "utf8",
);

describe("sidebar selected-text menu", () => {
  it("falls back to the recent cached sidebar selection on right click", () => {
    expect(sidebarSource).toContain("sidebarSelectionMenuText(");
    expect(sidebarSource).toContain("sidebar.lastCopySelection");
  });

  it("opens from a right-button press when Zotero suppresses contextmenu", () => {
    expect(sidebarSource).toContain('mousedown", onRightMouseDown, true');
    expect(sidebarSource).toContain("if (event.button !== 2) return");
  });

  it("positions the menu inside the docked AI column", () => {
    expect(sidebarSource).toContain("selectionMenuPosition(event, sidebar)");
    expect(sidebarSource).toContain("sidebar.column.append(menu)");
    expect(sidebarSource).toContain('menu.style.position = "absolute"');
  });

  it("offers note insertion and a cited question", () => {
    expect(sidebarSource).toContain('importBtn.textContent = "加入笔记"');
    expect(sidebarSource).toContain('askBtn.textContent = "提问"');
    expect(sidebarSource).toContain("fullReply: sourceMessage.content");
    expect(sidebarSource).toContain("excerpt,");
    expect(sidebarSource).toContain("sourceAssistantOrdinal:");
    expect(sidebarSource).toContain("sourceQuestionPreview:");
  });

  it("sends the full source reply and focused excerpt", () => {
    const message: Message = {
      role: "user",
      content: "这是什么意思？",
      context: {
        selectedText: "上一条回答中的一段话",
        selectedTextOrigin: "chat",
        quotedChatReply: {
          fullReply: "这是该次 AI 回复的完整内容。上一条回答中的一段话。",
          sourceConversationTitle: "对话 3",
        },
      },
    };

    expect(formatUserMessageForApi(message)).toContain(
      "[Referenced assistant reply — full]\n这是该次 AI 回复的完整内容。上一条回答中的一段话。",
    );
    expect(formatUserMessageForApi(message)).toContain(
      "[Focused excerpt]\n上一条回答中的一段话",
    );
    expect(formatUserMessageForApi(message)).not.toContain(
      "[Selected PDF text]",
    );
    expect(contextSummaryLine(message)).toBe(
      "已随本轮发送对话引用 10 字；完整回复 27 字；未携带其他聊天历史；论文目录未发送，可按需读取论文",
    );
  });

  it("shows the focused excerpt only for WEB question cards", () => {
    const renderer = sidebarSource.slice(
      sidebarSource.indexOf("function renderUserPdfSelectionContext("),
      sidebarSource.indexOf("function renderMessageUsage("),
    );
    expect(renderer).toContain("const webChatCitation =");
    expect(renderer).toContain("isWebPromptUserMessage(message)");
    expect(renderer).toContain(
      "if (webChatCitation) renderMarkdownInto(sourceBody, selectedText)",
    );
    expect(renderer).toContain("renderMarkdownInto(sourceBody, quotedReply)");
  });

  it("does not repeat a WEB citation under the assistant response", () => {
    const renderer = sidebarSource.slice(
      sidebarSource.indexOf("function renderAssistantProcess("),
      sidebarSource.indexOf("function renderMessageImages("),
    );
    expect(renderer).toContain("sourceUser.context.selectedText &&");
    expect(renderer).toContain("!isWebPromptUserMessage(sourceUser)");
  });

  it("labels WEB context, reasoning, answer, and citation source separately", () => {
    expect(sidebarSource).toContain('webContext ? "发送上下文"');
    expect(sidebarSource).toContain('webProvider === "deepseek" ? "DeepSeek 已思考"');
    expect(sidebarSource).toContain('"bubble-answer-label", "回答"');
    expect(sidebarSource).toContain("sourceAssistantOrdinal");
    expect(sidebarSource).toContain("sourceQuestionPreview");
    expect(sidebarSource).toContain("来源回答“");
    expect(sidebarSource).toContain("引用“${excerpt}”");
  });

  it("isolates a cited-reply question from configured chat history", () => {
    expect(sidebarSource).toContain("const isolatedHistory =");
    expect(sidebarSource).toContain("options.isolatedHistory ? [] : history");
    expect(sidebarSource).toContain(
      'userMessage.context?.selectedTextOrigin === "chat"',
    );
  });

  it("tells the user that only this full reply is carried for this turn", () => {
    expect(sidebarSource).toContain("仅本轮携带此回复全文");
    expect(sidebarSource).toContain("不携带其他聊天历史");
    expect(sidebarSource).toContain("论文目录按“原文”开关发送");
  });

  it("keeps the compact arXiv TOC for focused questions", () => {
    const resolver = sidebarSource.slice(
      sidebarSource.indexOf("async function resolvePinnedFullText("),
      sidebarSource.indexOf("async function saveDebugFrontBlockForState("),
    );
    expect(resolver.indexOf("buildArxivTocFrontBlock(itemID)")).toBeGreaterThan(
      -1,
    );
    expect(resolver.indexOf("buildArxivTocFrontBlock(itemID)")).toBeLessThan(
      resolver.indexOf("if (options.suppressPinned) return undefined"),
    );
  });

  it("reports whether the paper directory was attached", () => {
    const message: Message = {
      role: "user",
      content: "核对原文",
      context: {
        selectedText: "重点片段",
        selectedTextOrigin: "chat",
        quotedChatReply: {
          fullReply: "完整 AI 回复",
          sourceConversationTitle: "对话 2",
        },
        fullTextSource: "arxiv_toc",
        fullTextChars: 1719,
      },
    };

    expect(contextSummaryLine(message)).toContain("arXiv 目录 1719 字");
    expect(formatUserMessageForApi(message)).toContain(
      "如果问题需要核对该回复是否符合论文原文",
    );
  });

  it("also reports the attached directory for a PDF selection question", () => {
    const message: Message = {
      role: "user",
      content: "解释这段内容",
      context: {
        selectedText: "PDF 选区",
        selectedTextOrigin: "pdf",
        retrievedPassages: [
          { text: "附近上下文", score: 1, start: 20, end: 25 },
        ],
        fullTextSource: "arxiv_toc",
        fullTextChars: 1719,
      },
    };

    expect(contextSummaryLine(message)).toBe(
      "已随本轮发送 PDF 选区 6 字；自动附带附近上下文 5 字；arXiv 目录 1719 字",
    );
  });
});
