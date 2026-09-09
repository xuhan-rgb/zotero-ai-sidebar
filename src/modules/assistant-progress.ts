import type { Message } from "../providers/types";
import { findPreviousUserIndex } from "./chat-message-index";
import { el } from "./dom-utils";

export type AssistantProgressStage =
  | "starting"
  | "building_context"
  | "waiting_model"
  | "thinking"
  | "using_tool"
  | "writing";

interface AssistantProgressState {
  activeAssistantIndex?: number;
  activeAssistantStage?: AssistantProgressStage;
  activeAssistantDetail?: string;
  sending: boolean;
  messages: Message[];
}

export interface AssistantProgress {
  label: string;
  detail: string;
}

export function assistantProgressFor(
  state: AssistantProgressState,
  index: number,
  message: Message,
): AssistantProgress | null {
  if (message.role !== "assistant" || state.activeAssistantIndex !== index)
    return null;
  if (!state.sending) return null;

  const sourceUser =
    state.messages[findPreviousUserIndex(state.messages, index)];
  const latestTool = latestToolTrace(sourceUser);
  if (latestTool?.status === "started") {
    const localZoteroTool = latestTool.name.startsWith("zotero_");
    return {
      label: localZoteroTool ? "正在调用 Zotero 工具" : "正在使用联网工具",
      detail: latestTool.summary || latestTool.name,
    };
  }

  const stage = state.activeAssistantStage ?? "starting";
  const hasThinking = !!message.thinking?.trim();
  const hasContent = !!message.content.trim();
  const selectedText = sourceUser?.context?.selectedText;
  const readingRoute = sourceUser?.task?.kind === "reading_route";

  switch (stage) {
    case "building_context":
      return {
        label: readingRoute ? "正在准备阅读路线" : "正在整理上下文",
        detail:
          state.activeAssistantDetail ||
          (readingRoute
            ? "正在准备题录、PDF 正文和阅读路线工具上下文"
            : selectedText
              ? `已带入 PDF 选区 ${selectedText.length} 字`
              : "正在准备系统提示和可用 Zotero 工具"),
      };
    case "waiting_model":
      return {
        label: hasThinking ? "模型仍在思考" : "等待模型响应",
        detail:
          state.activeAssistantDetail ||
          latestTool?.summary ||
          "请求已发送，等待首个流式事件",
      };
    case "thinking":
      return {
        label: "模型正在思考",
        detail:
          "进度正在更新；可见思考取决于当前模型/API 是否返回 reasoning summary",
      };
    case "using_tool":
      return {
        label: "正在使用工具",
        detail: latestTool?.summary || "等待 Zotero 工具返回",
      };
    case "writing":
      return {
        label: readingRoute
          ? "正在生成阅读路线"
          : hasContent
            ? "正在生成回答"
            : "正在开始回答",
        detail: readingRoute
          ? "完整内容将保存到「AI 阅读路线」笔记；对话框只显示任务状态"
          : hasThinking
            ? "已收到思考过程，正在输出正文"
            : "正在流式输出正文",
      };
    case "starting":
    default:
      return {
        label: "准备发送给模型",
        detail: "正在初始化本轮回复",
      };
  }
}

function latestToolTrace(message: Message | undefined) {
  const tools = message?.context?.toolCalls;
  return Array.isArray(tools) && tools.length ? tools[tools.length - 1] : null;
}

export function renderAssistantProgress(
  doc: Document,
  progress: AssistantProgress,
): HTMLElement {
  const row = el(doc, "div", "assistant-live-progress");
  row.append(
    el(doc, "span", "assistant-live-spinner"),
    el(doc, "span", "assistant-live-label", progress.label),
    el(doc, "span", "assistant-live-detail", progress.detail),
  );
  return row;
}
