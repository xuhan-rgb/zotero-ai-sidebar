import type { Message } from "../providers/types";

// Session-scoped log of immersive-reading ("沉浸") in-place conversations,
// grouped by Zotero item ID. Each clicked sentence starts its own small,
// token-scoped conversation; we record them so the user can later ask AI to
// summarize a paper's whole reading session into the AI note.
//
// In-memory only: cleared on restart. That matches the use case — summarize at
// the end of a reading session — and avoids persisting potentially large Q&A.

export interface ReadingConversation {
  id: number;
  sentence: string;
  // Full Q&A for this card: alternating user/assistant turns. The first user
  // turn embeds the sentence + context, so summaries can rely on `messages`.
  messages: Message[];
  at: number;
}

const log = new Map<number, ReadingConversation[]>();
let nextId = 1;

// Module counter (not Date.now / random) so IDs stay stable and cheap.
export function newConversationId(): number {
  return nextId++;
}

// Upsert by id: the first answer creates the entry, follow-up turns update the
// same one (so a card with multiple turns stays a single recorded conversation).
export function recordReadingConversation(
  itemID: number | null,
  id: number,
  sentence: string,
  messages: Message[],
  at: number,
): void {
  if (itemID == null) return;
  const list = log.get(itemID) ?? [];
  const existing = list.find((c) => c.id === id);
  if (existing) {
    existing.sentence = sentence;
    existing.messages = messages;
    existing.at = at;
  } else {
    list.push({ id, sentence, messages, at });
  }
  log.set(itemID, list);
}

export function getReadingConversations(itemID: number | null): ReadingConversation[] {
  if (itemID == null) return [];
  return log.get(itemID) ?? [];
}

export function clearReadingConversations(itemID: number | null): void {
  if (itemID == null) return;
  log.delete(itemID);
}
