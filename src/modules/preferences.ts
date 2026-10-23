import { getUiLocale, uiText } from "../utils/ui-locale";
import type { SyncAccount } from "../sync/account";
import { config } from "../../package.json";
import type { ModelPreset } from "../settings/types";

let registeredPaneID: string | null = null;

export const PREFERENCE_SAVE_SECTIONS = [
  "presets",
  "prompts",
  "mcp",
  "sync",
] as const;

export type PreferenceSaveSection = (typeof PREFERENCE_SAVE_SECTIONS)[number];

function preferenceSaveSectionLabel(section: PreferenceSaveSection): string {
  switch (section) {
    case "presets":
      return uiText("账号与模型", "Accounts & models");
    case "prompts":
      return uiText("快捷提示词", "Quick prompts");
    case "mcp":
      return "MCP Servers";
    case "sync":
      return uiText("WebDAV 账号", "WebDAV account");
  }
}

export function formatPreferenceSaveSections(
  sections: Iterable<PreferenceSaveSection>,
): string {
  const active = new Set(sections);
  return PREFERENCE_SAVE_SECTIONS.filter((section) => active.has(section))
    .map(preferenceSaveSectionLabel)
    .join(uiText("、", ", "));
}

export function resolveTestModel(models: string[], selected: string): string {
  const normalized = selected.trim();
  return models.includes(normalized) ? normalized : (models[0] ?? "");
}

export function hasUnsavedPresetChanges(
  current: ModelPreset[],
  saved: ModelPreset[],
): boolean {
  return presetListSignature(current) !== presetListSignature(saved);
}

function presetListSignature(presets: ModelPreset[]): string {
  return JSON.stringify(
    presets.map((preset) => ({
      id: preset.id,
      provider: preset.provider,
      label: preset.label,
      apiKey: preset.apiKey,
      baseUrl: preset.baseUrl,
      model: preset.model,
      models: preset.models ?? [],
      maxTokens: preset.maxTokens,
      extras: preset.extras ?? {},
    })),
  );
}

export function dispatchPreferenceChange(
  doc: Document,
  target: EventTarget,
): void {
  const EventCtor = doc.defaultView?.Event;
  if (!EventCtor) throw new Error("Preference window is unavailable.");
  target.dispatchEvent(new EventCtor("change"));
}

export function setPreferenceSaveBarVisible(
  bar: Element,
  visible: boolean,
): void {
  if (visible) bar.removeAttribute("hidden");
  else bar.setAttribute("hidden", "hidden");
}

export function bindSyncHelpDialog(doc: Document): void {
  const trigger = doc.getElementById(
    "zai-sync-guide-open",
  ) as HTMLButtonElement | null;
  const dialog = doc.getElementById(
    "zai-sync-guide-dialog",
  ) as HTMLDialogElement | null;
  const close = doc.getElementById("zai-sync-guide-close");
  if (!trigger || !dialog || !close) return;
  trigger.addEventListener("click", () => {
    if (!dialog.open) dialog.showModal();
  });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dialog.close();
  });
  dialog.addEventListener("close", () => trigger.focus());
}

export function formatSyncSummary(account: SyncAccount): string {
  const records = [
    {
      time: Date.parse(account.lastPushAt),
      label: uiText("最近上传", "Last upload"),
    },
    {
      time: Date.parse(account.lastPullAt),
      label: uiText("最近下载", "Last download"),
    },
    {
      time: Date.parse(account.lastAutoSyncAt),
      label: uiText("最近自动同步", "Last auto-sync"),
    },
  ]
    .filter((record) => Number.isFinite(record.time))
    .sort((a, b) => b.time - a.time);
  const latest = records[0];
  if (!latest) return uiText("尚无同步记录", "No sync history yet");
  const date = new Intl.DateTimeFormat(getUiLocale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(latest.time));
  return `${latest.label}${uiText("：", ": ")}${date}`;
}

export async function registerPreferences(): Promise<void> {
  if (registeredPaneID) return;
  registeredPaneID = await Zotero.PreferencePanes.register({
    pluginID: config.addonID,
    id: `${config.addonRef}-prefs`,
    label: uiText("AI 对话", "AI Chat"),
    src: `chrome://${config.addonRef}/content/preferences.xhtml`,
    image: `chrome://${config.addonRef}/content/icons/ai-chat.svg`,
  });
}

export function unregisterPreferences(): void {
  if (!registeredPaneID) return;
  Zotero.PreferencePanes.unregister(registeredPaneID);
  registeredPaneID = null;
}
