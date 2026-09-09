import type { PrefsStore } from "./storage";

export interface LatexProxySettings {
  mode: "system" | "direct";
  portOverride?: number;
}

const KEY = "extensions.zotero-ai-sidebar.latexProxy";
export const DEFAULT_LATEX_PROXY: LatexProxySettings = { mode: "system" };

export function loadLatexProxy(prefs: PrefsStore): LatexProxySettings {
  const raw = prefs.get(KEY);
  if (!raw) return { ...DEFAULT_LATEX_PROXY };
  const value = JSON.parse(raw) as { mode?: string; portOverride?: number };
  // Earlier versions stored Zotero/custom modes and a manual host/port.
  // Those now use the operating system's proxy configuration.
  const settings: LatexProxySettings = {
    mode: value.mode === "direct" ? "direct" : "system",
  };
  if (settings.mode === "system" && value.portOverride !== undefined) {
    validatePort(value.portOverride);
    settings.portOverride = value.portOverride;
  }
  return settings;
}

export function saveLatexProxy(
  prefs: PrefsStore,
  settings: LatexProxySettings,
): void {
  const saved: LatexProxySettings = { mode: settings.mode };
  if (settings.mode === "system" && settings.portOverride !== undefined) {
    validatePort(settings.portOverride);
    saved.portOverride = settings.portOverride;
  }
  prefs.set(KEY, JSON.stringify(saved));
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("端口必须是 1–65535 的整数");
  }
}
