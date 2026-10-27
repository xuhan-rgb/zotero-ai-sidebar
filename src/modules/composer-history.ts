export interface ComposerPromptHistoryMessage {
  role: string;
  content: string;
}

export interface ComposerPromptHistoryState {
  messages: ComposerPromptHistoryMessage[];
  promptHistoryCursor?: number;
}

export type ComposerPromptHistoryDirection = "previous" | "next";

export interface ComposerPromptHistoryNavigation {
  handled: boolean;
  value: string;
}

export function resetComposerPromptHistory(
  state: ComposerPromptHistoryState,
): void {
  state.promptHistoryCursor = undefined;
}

export function navigateComposerPromptHistory(
  state: ComposerPromptHistoryState,
  currentValue: string,
  direction: ComposerPromptHistoryDirection,
): ComposerPromptHistoryNavigation {
  const active = state.promptHistoryCursor != null;
  if (direction === "next") {
    if (!active) return { handled: false, value: currentValue };
    resetComposerPromptHistory(state);
    return { handled: true, value: "" };
  }

  const prompts = userPromptHistory(state.messages);
  if (!prompts.length || (!active && currentValue !== ""))
    return { handled: false, value: currentValue };

  const cursor = state.promptHistoryCursor ?? prompts.length;
  const nextCursor = Math.max(0, Math.min(prompts.length - 1, cursor - 1));
  state.promptHistoryCursor = nextCursor;
  return { handled: true, value: prompts[nextCursor] };
}

function userPromptHistory(messages: ComposerPromptHistoryMessage[]): string[] {
  return messages
    .filter((message) => message.role === "user" && message.content.trim())
    .map((message) => message.content);
}
