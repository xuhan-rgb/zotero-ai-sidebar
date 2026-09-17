import type { PrefsStore } from "./storage";

export const MINERU_TOKEN_APPLY_URL = "https://mineru.net/apiManage/token";

export interface MineruSettings {
  token: string;
}

export function openMineruTokenApplyPage(): void {
  (globalThis as unknown as { Zotero?: { launchURL?: (url: string) => void } })
    .Zotero?.launchURL?.(MINERU_TOKEN_APPLY_URL);
}

const KEY = "extensions.zotero-ai-sidebar.mineru";
export const DEFAULT_MINERU_SETTINGS: MineruSettings = { token: "" };

export function loadMineruSettings(prefs: PrefsStore): MineruSettings {
  const raw = prefs.get(KEY);
  if (!raw) return { ...DEFAULT_MINERU_SETTINGS };
  try {
    return normalizeMineruSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_MINERU_SETTINGS };
  }
}

export function saveMineruSettings(
  prefs: PrefsStore,
  settings: MineruSettings,
): void {
  prefs.set(KEY, JSON.stringify(normalizeMineruSettings(settings)));
}

export function normalizeMineruSettings(value: unknown): MineruSettings {
  const input =
    value && typeof value === "object"
      ? (value as Partial<MineruSettings>)
      : {};
  return {
    token: typeof input.token === "string" ? input.token.trim() : "",
  };
}
