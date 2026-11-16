import type { Message } from "../providers/types";
import type { QuickAskReference } from "../modules/quick-ask";
import { normalizeMessages } from "./chat-history";

export interface QuickAskHistoryEntry {
  id: string;
  itemID: number | null;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  reference: QuickAskReference | null;
}

let writeQueue: Promise<void> = Promise.resolve();

function storage() {
  const z = (
    globalThis as unknown as {
      Zotero: {
        DataDirectory?: { dir?: string; path?: string };
        Profile: { dir: string };
        File: {
          getContentsAsync(path: string, charset: string): Promise<string>;
          putContentsAsync(path: string, contents: string): Promise<void>;
        };
      };
    }
  ).Zotero;
  const dir = z.DataDirectory?.dir ?? z.DataDirectory?.path ?? z.Profile.dir;
  const sep = dir.includes("\\") ? "\\" : "/";
  return {
    file: z.File,
    path: `${dir.replace(/[\\/]+$/g, "")}${sep}zotero-ai-sidebar-quick-ask-history.json`,
  };
}

async function readHistory(): Promise<QuickAskHistoryEntry[]> {
  const { file, path } = storage();
  if (!(await IOUtils.exists(path))) return [];
  const entries: unknown = JSON.parse(
    await file.getContentsAsync(path, "utf-8"),
  );
  if (!Array.isArray(entries)) throw new Error("Quick Ask 历史记录格式无效");
  return entries.flatMap((entry) => {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      (entry.itemID !== null && !Number.isInteger(entry.itemID)) ||
      typeof entry.createdAt !== "string" ||
      typeof entry.updatedAt !== "string"
    )
      return [];
    const reference = entry.reference;
    return [
      {
        id: entry.id,
        itemID: entry.itemID,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        messages: normalizeMessages(entry.messages),
        reference:
          reference &&
          ["pdf", "translation", "source"].includes(reference.kind) &&
          typeof reference.displayText === "string" &&
          typeof reference.sourceText === "string"
            ? reference
            : null,
      },
    ];
  });
}

export async function loadQuickAskHistory(
  itemID: number | null,
): Promise<QuickAskHistoryEntry[]> {
  await writeQueue.catch(() => undefined);
  return (await readHistory())
    .filter((entry) => entry.itemID === itemID)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function saveQuickAskHistory(
  entry: QuickAskHistoryEntry,
): Promise<void> {
  // Snapshot before queueing: streaming and closing may mutate the live state.
  const snapshot: QuickAskHistoryEntry = JSON.parse(JSON.stringify(entry));
  snapshot.messages = normalizeMessages(snapshot.messages);
  if (!snapshot.messages.length) return Promise.resolve();
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      const entries = await readHistory();
      const index = entries.findIndex((saved) => saved.id === snapshot.id);
      if (index < 0) entries.push(snapshot);
      else entries[index] = snapshot;
      const { file, path } = storage();
      await file.putContentsAsync(path, JSON.stringify(entries, null, 2));
    });
  return writeQueue;
}
