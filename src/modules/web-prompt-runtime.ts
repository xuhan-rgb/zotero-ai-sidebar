import type { WebPromptProvider } from "./web-prompt-hub";

export interface WebPromptPendingTask {
  id?: string;
  title?: string;
  webProvider?: string;
  completedAt?: number;
  cancelledAt?: number;
  error?: string;
  webStatus?: string;
}

export interface WebPromptPendingMessage {
  role?: "user" | "assistant";
  content?: string;
  task?: WebPromptPendingTask;
}

export interface WebPromptPendingState {
  webPromptBusy?: boolean;
  messages: WebPromptPendingMessage[];
}

export function advanceWebProgressText(current: string, target: string): string {
  if (!target || target === current) return current;
  if (target.startsWith(current)) {
    return target.slice(0, Math.min(target.length, current.length + 28));
  }
  // DeepSeek can normalize headings, whitespace, and generated-file markers
  // between DOM snapshots. A growing snapshot is still forward progress even
  // when its prefix changed, so follow the current Web answer instead of
  // freezing Zotero until completion. A shorter snapshot can be a transient
  // DOM replacement; keep the already-painted text in that case.
  if (target.length > current.length) {
    return target.slice(0, Math.min(target.length, current.length + 28));
  }
  return current;
}

export function webPromptProviderForUserMessage(
  message: WebPromptPendingMessage | undefined,
): WebPromptProvider | null {
  if (message?.task?.webProvider) {
    return message.task.webProvider as WebPromptProvider;
  }
  if (message?.task?.title === "ChatGPT Web") return "chatgpt";
  if (message?.task?.title === "DeepSeek Web") return "deepseek";
  const task = message?.task;
  if (task?.title?.endsWith(" Web") && !String(task.id || "").startsWith("task-")) {
    return "custom:legacy";
  }
  return null;
}

export function isWebPromptUserMessage(
  message: WebPromptPendingMessage | undefined,
): boolean {
  return webPromptProviderForUserMessage(message) != null;
}

export function webPromptTaskPending(state: WebPromptPendingState): boolean {
  if (state.webPromptBusy) return true;
  return state.messages.some(
    (message) =>
      isWebPromptUserMessage(message) &&
      !!message.task &&
      !message.task.completedAt &&
      !message.task.cancelledAt &&
      !message.task.error,
  );
}

export function interruptStaleWebPromptTasks(
  messages: WebPromptPendingMessage[],
  now = Date.now(),
): number {
  let interrupted = 0;
  for (const message of messages) {
    const task = message.task;
    if (!task || !isWebPromptUserMessage(message)) continue;
    let changed = false;
    if (!task.completedAt && !task.cancelledAt && !task.error) {
      task.cancelledAt = now;
      task.error = "Zotero 重启时被中断";
      changed = true;
    }
    if (task.webStatus) {
      delete task.webStatus;
      changed = true;
    }
    if (changed) interrupted += 1;
  }
  return interrupted;
}

export function webPromptStatusBubbleContent(input: {
  status: string;
  statusMessage: string;
  paintedAnswer: string;
  queuedAnswer?: string;
}): string {
  const progress =
    (input.queuedAnswer || "").trim() || input.paintedAnswer.trim();
  if (
    input.status === "generating" &&
    progress
  ) {
    return input.paintedAnswer.trim() || progress;
  }
  if ((input.status === "failed" || input.status === "cancelled") && progress) {
    return `${progress}\n\n> ${input.statusMessage}`;
  }
  return input.statusMessage;
}
