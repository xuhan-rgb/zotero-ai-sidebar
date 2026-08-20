import type { Message } from "../providers/types";

// Older DeepSeek Web tasks stored the model's internal reasoning and final
// answer in one assistant content string. Split only messages that are
// provably part of that old Web task shape; ordinary API answers are opaque.
export function migrateLegacyDeepSeekMessages(messages: Message[]): boolean {
  let changed = false;
  for (let index = 1; index < messages.length; index += 1) {
    const assistant = messages[index];
    const user = messages[index - 1];
    if (
      assistant.role !== "assistant" ||
      assistant.task?.id !== user.task?.id ||
      user.role !== "user" ||
      user.task?.title !== "DeepSeek Web"
    ) {
      continue;
    }
    if (assistant.thinking?.trim()) {
      const normalized = normalizeLegacyMarkdownHeadings(assistant.content);
      if (normalized !== assistant.content) {
        assistant.content = normalized;
        changed = true;
      }
      continue;
    }
    const split = splitLegacyDeepSeekContent(assistant.content);
    if (!split) continue;
    assistant.thinking = split.reasoning;
    assistant.content = normalizeLegacyMarkdownHeadings(split.answer);
    changed = true;
  }
  return changed;
}

function splitLegacyDeepSeekContent(
  content: string,
): { reasoning: string; answer: string } | null {
  const reasoningMarker =
    /\n(?=#\s*##\s+|##\s+|你好[！!]|好的[，,])/u.exec(content);
  if (!reasoningMarker || reasoningMarker.index < 80) return null;
  const reasoning = content.slice(0, reasoningMarker.index).trim();
  const answer = content
    .slice(reasoningMarker.index)
    .trim()
    .replace(/^#{1,6}\s+(?=##\s+)/gmu, "");
  if (!answer || !looksLikeReasoning(reasoning)) return null;
  return { reasoning, answer };
}

function normalizeLegacyMarkdownHeadings(value: string): string {
  return value.replace(/^#{1,6}\s+(?=##\s+)/gmu, "");
}

function looksLikeReasoning(value: string): boolean {
  return (
    value.length >= 80 &&
    /(用户(要求|问题)|我们需要|最终回答|回答要求|策略[:：]|思考)/u.test(
      value,
    )
  );
}
