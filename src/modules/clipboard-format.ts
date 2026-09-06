import { formatContextMarkdown } from "../context/message-format";
import type { Message } from "../providers/types";
import {
  formatTokenCount,
  messageUsageBreakdown as tokenUsageBreakdown,
} from "./token-usage";

export interface ClipboardConversationState {
  itemID: number | null;
  messages: Message[];
}

export function messageToClipboard(message: Message, includeDebugContext: boolean): string {
  if (!includeDebugContext) {
    return [...formatTurnSourceMarkdown(message), message.content, ""].join("\n");
  }

  const lines = [`## ${message.role === "user" ? "You" : "AI"}`, ""];
  lines.push(...formatContextMarkdown(message));
  lines.push(...formatTurnWireLayoutMarkdown("###", message, 1));
  const imageSummary = formatImageAttachmentSummary(message);
  if (imageSummary) lines.push(imageSummary, "");
  if (message.thinking) {
    lines.push("### 思考过程", "", message.thinking, "");
  }
  lines.push(message.content, "");
  lines.push(...formatTokenUsageMarkdown(message));
  return lines.join("\n");
}

export function formatConversationMarkdown(
  state: ClipboardConversationState,
  includeDebugContext: boolean,
  systemPrompt?: string,
  frontBlock?: string,
): string {
  const item = state.itemID == null ? null : Zotero.Items.get(state.itemID);
  const title = item?.getField("title") || "未选择条目";
  const lines = [
    `# Zotero AI Chat - ${title}`,
    "",
    `- Item ID: ${state.itemID ?? "none"}`,
    `- Exported: ${new Date().toISOString()}`,
    "",
    ...formatItemIntroductionMarkdown(state.itemID, item),
  ];

  if (includeDebugContext && systemPrompt) {
    lines.push(
      "## System Prompt",
      "",
      "```",
      systemPrompt,
      "```",
      "",
    );
  }

  if (includeDebugContext && frontBlock) {
    lines.push(
      "## Front Block",
      "",
      "固定位置：system prompt 之后、对话历史之前。",
      "",
      "```",
      "[Paper full text]",
      frontBlock,
      "```",
      "",
    );
  }

  for (const message of state.messages) {
    lines.push(`## ${message.role === "user" ? "You" : "AI"}`, "");
    if (includeDebugContext) {
      lines.push(...formatContextMarkdown(message));
      lines.push(
        ...formatTurnWireLayoutMarkdown(
          "###",
          message,
          userTurnNumber(state.messages, state.messages.indexOf(message)),
          frontBlock,
        ),
      );
      const imageSummary = formatImageAttachmentSummary(message);
      if (imageSummary) lines.push(imageSummary, "");
      if (message.thinking) {
        lines.push("### 思考过程", "", message.thinking, "");
      }
    } else {
      lines.push(...formatTurnSourceMarkdown(message));
    }
    lines.push(message.content, "");
    if (includeDebugContext) {
      lines.push(...formatTokenUsageMarkdown(message));
    }
  }

  return lines.join("\n");
}

function formatTurnSourceMarkdown(message: Message): string[] {
  if (message.role !== "user") return [];
  const selectedText =
    message.context?.selectedText || message.task?.pdfSelection?.selectedText || "";
  if (!selectedText) return [];
  const pageLabel = message.task?.pdfSelection
    ? pdfSelectionPageLabel(message.task.pdfSelection)
    : "";
  return [`### PDF 选区${pageLabel}`, "", selectedText, ""];
}

function pdfSelectionPageLabel(
  selection: NonNullable<Message["task"]>["pdfSelection"],
): string {
  if (!selection) return "";
  const label = selection.pageLabel ?? String((selection.pageIndex ?? 0) + 1);
  return label ? `（第 ${label} 页）` : "";
}

function formatTurnWireLayoutMarkdown(
  heading: "###",
  message: Message,
  turn: number,
  currentFrontBlock?: string,
): string[] {
  if (message.role !== "user") return [];
  const context = message.context;
  if (!context) return [];

  const paperFrontBlock = paperFrontBlockRecord(message, currentFrontBlock);
  const currentBlocks = currentUserMessageBlocks(message);
  const toolNames = context.toolCalls?.map((tool) => tool.name) ?? [];
  return [
    `${heading} 发送给模型的信息顺序`,
    "",
    `回合：第 ${turn || "?"} 个用户问题`,
    "1. System Prompt：论文题录/摘要 + Zotero 工具说明 + 配置项。",
    paperFrontBlock
      ? `2. Front Block：[Paper full text]，${paperFrontBlock.chars} 字，固定在 System Prompt 正后方、对话历史之前。`
      : "2. Front Block：无 PDF 全文前置块。",
    "3. Conversation History：本轮之前的对话历史（若未清空且非隔离任务）。",
    `4. Current User Message：${currentBlocks.join(" + ")}。`,
    toolNames.length
      ? `5. Tool Loop：本轮模型调用过 ${toolNames.join(" -> ")}；如果包含 zotero_get_full_pdf，最终回答请求会在工具完成后携带 Front Block。`
      : "5. Tool Loop：本轮未记录 Zotero 工具调用。",
    "",
    paperFrontBlock
      ? `- Front Block 来源：${paperFrontBlock.source}`
      : "- Front Block 来源：无。",
    !paperFrontBlock && currentFrontBlock
      ? "- 说明：虽然导出中有全文缓存，但本轮没有把全文作为 Front Block 发送。"
      : "",
    "- 缓存排查：稳定前缀应主要由 System Prompt + Front Block 构成；同一模型/预设/item 连续请求时，这两段越稳定，cache hit 越容易出现。",
    "",
    ...formatPromptCacheDebugMarkdown(message),
  ];
}

function formatPromptCacheDebugMarkdown(message: Message): string[] {
  const debug = message.context?.promptCacheDebug;
  if (!debug) return [];
  const tools = debug.toolsSent.length
    ? `${debug.toolsSent.length} 个：${debug.toolsSent.join(", ")}`
    : "0 个";
  return [
    "### Cache Debug",
    "",
    `- Provider path: ${debug.requestPath}`,
    `- Endpoint: ${debug.endpoint}`,
    `- Model / Preset: ${debug.model} / ${debug.presetID}`,
    `- prompt_cache_key: ${debug.promptCacheKeySent ? debug.promptCacheKey : "未发送"}${debug.promptCacheKeySent ? "" : `（${debug.promptCacheKey}）`}`,
    `- prompt_cache_retention: ${debug.promptCacheRetention ?? "未发送"}`,
    `- Cache mechanism: ${debug.promptCacheMechanism}`,
    `- Reasoning sent: ${debug.reasoningSent ? "yes" : "no"} (${debug.reasoningDetail})`,
    `- Hashes: system=${debug.systemPromptHash}; front=${debug.frontBlockHash ?? "none"}${debug.frontBlockChars ? ` (${debug.frontBlockChars} chars)` : ""}; tools=${debug.toolsHash}; stable_prefix=${debug.stablePrefixHash}`,
    `- Tools sent: ${tools}`,
    debug.replayContentHash
      ? `- Codex-style replay: enabled; current user wire=${debug.replayContentHash} (${debug.replayContentChars ?? 0} chars)，后续回合会原样复用该用户消息以保持前缀。`
      : "- Codex-style replay: not recorded for this turn；若上一轮没有 replay snapshot，后续请求未必能做到“上一轮完整 input 是下一轮前缀”。",
    "",
  ];
}

function paperFrontBlockRecord(
  message: Message,
  currentFrontBlock?: string,
): { chars: number; source: string } | null {
  const context = message.context;
  if (!context?.fullTextChars) return null;
  if (
    context.planMode === "reader_pdf_text" ||
    context.planMode === "remote_paper"
  ) {
    return null;
  }
  const toolTriggered = context.toolCalls?.some(
    (tool) => tool.name === "zotero_get_full_pdf" && tool.status === "completed",
  );
  return {
    chars: context.fullTextChars,
    source: currentFrontBlock
      ? "当前 paper-cache 前置块（正文在上方/下方 Front Block 调试段可展开）"
      : toolTriggered
        ? "zotero_get_full_pdf 工具触发；正文用于请求但不写入聊天历史。"
        : "手动“原文”前置块或已缓存的发送记录；正文不写入聊天历史。",
  };
}

function currentUserMessageBlocks(message: Message): string[] {
  const context = message.context;
  const blocks: string[] = [];
  if (context?.promptCacheLedger) blocks.push("Previous context ledger");
  if (context?.selectedText) blocks.push("Selected PDF text");
  if (context?.annotations?.length) blocks.push("Zotero annotations");
  if (context?.retrievedPassages?.length) blocks.push("Retrieved PDF passages");
  if (message.images?.length) blocks.push(`${message.images.length} image(s)`);
  blocks.push("User question");
  return blocks;
}

function userTurnNumber(messages: Message[], index: number): number {
  let turn = 0;
  for (let i = 0; i <= index; i++) {
    if (messages[i].role === "user") turn += 1;
  }
  return turn;
}

function formatTokenUsageMarkdown(message: Message): string[] {
  if (!message.usage) return [];
  const breakdown = tokenUsageBreakdown(message.usage);
  const cacheHit = breakdown.cacheReturned
    ? formatTokenCount(breakdown.cacheHit)
    : "服务端未返回";
  const cacheRate =
    breakdown.cacheRate == null ? "服务端未返回" : `${breakdown.cacheRate}%`;
  return [
    "### Token 使用",
    "",
    `- Input raw: ${formatTokenCount(breakdown.rawInput)}`,
    `- Input cache hit: ${cacheHit}`,
    `- Input cache miss: ${formatTokenCount(breakdown.cacheMiss)}`,
    `- Output: ${formatTokenCount(breakdown.output)}`,
    `- Cache hit rate: ${cacheRate}`,
    `- Token total: ${formatTokenCount(breakdown.total)}（仅供核对，不作为计价汇总）`,
    `- 统计口径: ${breakdown.mode}`,
    "",
  ];
}

function formatItemIntroductionMarkdown(
  itemID: number | null,
  item: Zotero.Item | false | null | undefined,
): string[] {
  if (itemID == null || !item) return [];
  const authors = item
    .getCreators()
    .map((creator) =>
      [creator.firstName, creator.lastName].filter(Boolean).join(" "),
    )
    .filter(Boolean);
  const fields = [
    ["标题", item.getField("title")],
    ["作者", authors.join(", ")],
    ["年份", parseYearString(item.getField("date"))],
    ["期刊/会议", item.getField("publicationTitle") || item.getField("conferenceName")],
    ["DOI", item.getField("DOI")],
    ["URL", item.getField("url")],
  ].filter(([, value]) => String(value ?? "").trim().length > 0);
  const tags = item
    .getTags()
    .map((tag) => tag.tag)
    .filter(Boolean);
  const abstract = item.getField("abstractNote")?.trim();
  const lines = ["## PDF 介绍", ""];
  for (const [label, value] of fields) {
    lines.push(`- ${label}: ${value}`);
  }
  if (tags.length) lines.push(`- 标签: ${tags.join(", ")}`);
  if (abstract) {
    lines.push("", "### 摘要", "", abstract);
  }
  lines.push("", "## 对话记录", "");
  return lines;
}

function parseYearString(date: string): string {
  return date.match(/\b(18|19|20|21)\d{2}\b/)?.[0] ?? "";
}

function formatImageAttachmentSummary(message: Message): string {
  if (!message.images?.length) return "";
  const lines = ["### 截图附件"];
  message.images.forEach((image, index) => {
    lines.push(
      `- ${index + 1}. ${image.name} (${image.mediaType}, ${formatBytes(image.size)})`,
    );
  });
  return lines.join("\n");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
