import { toApiMessages } from "../context/message-format";
import { DEFAULT_CONTEXT_POLICY, type ContextPolicy } from "../context/policy";
import type { MessageContext } from "../context/types";
import type { AgentTool, Message, MessageUsage } from "../providers/types";
import type { PrefsStore } from "../settings/storage";
import {
  DEFAULT_REASONING_EFFORT,
  REASONING_EFFORT_OPTIONS,
  type ReasoningEffort,
} from "../settings/types";
import { parseKeybinding } from "../translate/keybinding";

const QUICK_ASK_SHORTCUT_PREF = "extensions.zotero-ai-sidebar.quickAskShortcut";
const QUICK_ASK_MODEL_SELECTION_PREF =
  "extensions.zotero-ai-sidebar.quickAskModelSelection";
export const DEFAULT_QUICK_ASK_SHORTCUT = "Alt+Q";

export type QuickAskReferenceKind = "pdf" | "translation" | "source";

export interface QuickAskReference {
  kind: QuickAskReferenceKind;
  displayText: string;
  sourceText: string;
}

export type QuickAskStatus = "idle" | "sending" | "answered" | "error";

export interface QuickAskModelSelection {
  presetId: string;
  model: string;
  reasoningEffort: ReasoningEffort;
}

export interface QuickAskState {
  status: QuickAskStatus;
  messages: Message[];
  question: string;
  answer: string;
  thinking: string;
  statusText: string;
  error: string;
  usage?: MessageUsage;
  reference: QuickAskReference | null;
  modelSelection: QuickAskModelSelection;
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
  modelSelection: QuickAskModelSelection = {
    presetId: "",
    model: "",
    reasoningEffort: DEFAULT_REASONING_EFFORT,
  },
): QuickAskState {
  return {
    status: "idle",
    messages: [],
    question: "",
    answer: "",
    thinking: "",
    statusText: "",
    error: "",
    usage: undefined,
    reference,
    modelSelection: { ...modelSelection },
  };
}

export function loadQuickAskModelSelection(
  prefs: PrefsStore,
): QuickAskModelSelection | null {
  const raw = prefs.get(QUICK_ASK_MODEL_SELECTION_PREF);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const presetId =
      typeof value.presetId === "string" ? value.presetId.trim() : "";
    const model = typeof value.model === "string" ? value.model.trim() : "";
    const reasoningEffort = value.reasoningEffort;
    if (
      !presetId ||
      !model ||
      !REASONING_EFFORT_OPTIONS.some(([effort]) => effort === reasoningEffort)
    ) {
      return null;
    }
    return {
      presetId,
      model,
      reasoningEffort: reasoningEffort as ReasoningEffort,
    };
  } catch {
    return null;
  }
}

export function saveQuickAskModelSelection(
  prefs: PrefsStore,
  selection: QuickAskModelSelection,
): void {
  prefs.set(QUICK_ASK_MODEL_SELECTION_PREF, JSON.stringify(selection));
}

export function getQuickAskShortcut(prefs: PrefsStore): string {
  const value = prefs.get(QUICK_ASK_SHORTCUT_PREF);
  return typeof value === "string" && value.trim()
    ? value.trim()
    : DEFAULT_QUICK_ASK_SHORTCUT;
}

export function setQuickAskShortcut(prefs: PrefsStore, value: string): void {
  prefs.set(
    QUICK_ASK_SHORTCUT_PREF,
    value.trim() || DEFAULT_QUICK_ASK_SHORTCUT,
  );
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
          "Quick Ask 临时会话：发送当前选区和本轮附近上下文，不读取研究对话历史",
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
  messages: Message[],
  policy: ContextPolicy = DEFAULT_CONTEXT_POLICY,
): Message[] {
  const currentMessage = messages[messages.length - 1];
  return toApiMessages(
    messages,
    currentMessage ? { message: currentMessage } : undefined,
    policy,
  );
}

export function isQuickAskShortcut(
  event: QuickAskShortcutEvent,
  shortcut = DEFAULT_QUICK_ASK_SHORTCUT,
): boolean {
  if (event.isComposing) return false;
  const binding = parseKeybinding(shortcut);
  if (!binding) return false;
  const eventKey = event.key === " " ? "Space" : event.key;
  return (
    eventKey.toLowerCase() === binding.key.toLowerCase() &&
    event.ctrlKey === binding.ctrl &&
    event.metaKey === binding.meta &&
    event.shiftKey === binding.shift &&
    event.altKey === binding.alt
  );
}

export function quickAskReadOnlyTools(tools: AgentTool[]): AgentTool[] {
  return tools.filter(
    (tool) =>
      !tool.requiresApproval && tool.name !== "chat_get_previous_context",
  );
}
