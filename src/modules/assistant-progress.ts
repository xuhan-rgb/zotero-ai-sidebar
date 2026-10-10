import type { Message } from "../providers/types";
import { findPreviousUserIndex } from "./chat-message-index";
import { el } from "./dom-utils";
import { uiText } from "../utils/ui-locale";

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
      label: localZoteroTool
        ? uiText("正在调用 Zotero 工具", "Calling Zotero tool")
        : uiText("正在使用联网工具", "Using web tool"),
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
        label: readingRoute
          ? uiText("正在准备阅读路线", "Preparing reading route")
          : uiText("正在整理上下文", "Preparing context"),
        detail:
          preparationDetail(state.activeAssistantDetail) ||
          (readingRoute
            ? uiText("正在准备题录、PDF 正文和阅读路线工具上下文", "Preparing item metadata, PDF text, and reading route tool context")
            : selectedText
              ? uiText(`已带入 PDF 选区 ${selectedText.length} 字`, `PDF selection included (${selectedText.length} characters)`)
              : uiText("正在准备系统提示和可用 Zotero 工具", "Preparing the system prompt and available Zotero tools")),
      };
    case "waiting_model":
      return {
        label: hasThinking
          ? uiText("模型仍在思考", "Model is still thinking")
          : uiText("等待模型响应", "Waiting for model response"),
        detail:
          state.activeAssistantDetail ||
          latestTool?.summary ||
          uiText("请求已发送，等待首个流式事件", "Request sent; waiting for the first streaming event"),
      };
    case "thinking":
      return {
        label: uiText("模型正在思考", "Model is thinking"),
        detail:
          uiText("进度正在更新；可见思考取决于当前模型/API 是否返回 reasoning summary", "Progress is updating; visible reasoning depends on whether the current model/API returns a reasoning summary"),
      };
    case "using_tool":
      return {
        label: uiText("正在使用工具", "Using a tool"),
        detail: latestTool?.summary || uiText("等待 Zotero 工具返回", "Waiting for Zotero tool result"),
      };
    case "writing":
      return {
        label: readingRoute
          ? uiText("正在生成阅读路线", "Generating reading route")
          : hasContent
            ? uiText("正在生成回答", "Generating response")
            : uiText("正在开始回答", "Starting response"),
        detail: readingRoute
          ? uiText("完整内容将保存到「AI 阅读路线」笔记；对话框只显示任务状态", "The full content will be saved to the AI Reading Route note; this chat shows task status only")
          : hasThinking
            ? uiText("已收到思考过程，正在输出正文", "Reasoning received; generating the response")
            : uiText("正在流式输出正文", "Streaming the response"),
      };
    case "starting":
    default:
      return {
        label: uiText("准备发送给模型", "Preparing to send to model"),
        detail: uiText("正在初始化本轮回复", "Initializing this response"),
      };
  }
}

/** Only translate the fixed preparation statuses emitted by the app itself. */
function preparationDetail(detail: string | undefined): string | undefined {
  if (!detail) return undefined;
  switch (detail) {
    case "正在整理对话历史":
      return uiText(detail, "Organizing conversation history");
    case "正在检查本地 LaTeX 缓存，不等待下载":
      return uiText(detail, "Checking the local LaTeX cache without waiting for downloads");
    case "正在读取论文题录":
      return uiText(detail, "Reading paper metadata");
    case "正在读取本地正文与上下文设置":
      return uiText(detail, "Reading local full text and context settings");
    case "正在准备本轮正文":
      return uiText(detail, "Preparing this response");
    case "正在读取引用文章原文":
      return uiText(detail, "Reading cited paper text");
    case "正在准备 Zotero 工具和模型请求":
      return uiText(detail, "Preparing Zotero tools and model request");
    default:
      return detail;
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
