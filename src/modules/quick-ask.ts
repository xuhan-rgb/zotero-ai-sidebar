import { toApiMessages } from "../context/message-format";
import { DEFAULT_CONTEXT_POLICY, type ContextPolicy } from "../context/policy";
import type { MessageContext } from "../context/types";
import type { AgentTool, Message, MessageUsage } from "../providers/types";

export const QUICK_ASK_SHORTCUT_LABEL = "Alt + Q";

export type QuickAskReferenceKind = "pdf" | "translation" | "source";

export interface QuickAskReference {
  kind: QuickAskReferenceKind;
  displayText: string;
  sourceText: string;
}

export type QuickAskStatus = "idle" | "sending" | "answered" | "error";

export interface QuickAskState {
  status: QuickAskStatus;
  question: string;
  answer: string;
  thinking: string;
  statusText: string;
  error: string;
  usage?: MessageUsage;
  reference: QuickAskReference | null;
}

interface QuickAskShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing: boolean;
}

export function createQuickAskState(
  reference: QuickAskReference | null = null,
): QuickAskState {
  return {
    status: "idle",
    question: "",
    answer: "",
    thinking: "",
    statusText: "",
    error: "",
    usage: undefined,
    reference,
  };
}

export function resetQuickAskState(state: QuickAskState): QuickAskState {
  return createQuickAskState(state.reference);
}

export function createQuickAskUserMessage(
  question: string,
  reference: QuickAskReference | null,
  context: Partial<MessageContext>,
): Message {
  const selectedText = reference?.sourceText.trim() ?? "";
  const messageContext: MessageContext | undefined = selectedText
    ? {
        ...context,
        selectedText,
        planMode: "selected_text",
        plannerSource: "selected",
        planReason:
          "Quick Ask 单次请求：只发送当前选区和本轮附近上下文，不读取聊天历史",
      }
    : Object.keys(context).length
      ? context
      : undefined;
  return {
    role: "user",
    content: question.trim(),
    ...(messageContext ? { context: messageContext } : {}),
  };
}

export function buildQuickAskApiMessages(
  userMessage: Message,
  policy: ContextPolicy = DEFAULT_CONTEXT_POLICY,
): Message[] {
  return toApiMessages([userMessage], { message: userMessage }, policy);
}

export function isQuickAskShortcut(event: QuickAskShortcutEvent): boolean {
  if (
    event.isComposing ||
    !event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return false;
  }
  return event.key.toLowerCase() === "q";
}

export function quickAskReadOnlyTools(tools: AgentTool[]): AgentTool[] {
  return tools.filter(
    (tool) =>
      !tool.requiresApproval && tool.name !== "chat_get_previous_context",
  );
}
