import type { Message } from "../providers/types";

export type ConversationHistoryMode = "none" | "previous" | "all";

export function selectConversationHistory(
  messages: Message[],
  mode: ConversationHistoryMode,
): Message[] {
  if (mode === "none") return [];
  if (mode === "all") return [...messages];

  const assistantIndex = messages.findLastIndex(
    (message) => message.role === "assistant",
  );
  if (assistantIndex < 0) return [];

  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return messages.slice(index, assistantIndex + 1);
    }
  }
  return [];
}
