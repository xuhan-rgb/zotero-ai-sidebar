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

const PREFERENCE_SAVE_SECTION_LABELS: Record<PreferenceSaveSection, string> = {
  presets: "账号与模型",
  prompts: "快捷提示词",
  mcp: "MCP Servers",
  sync: "WebDAV 账号",
};

export function formatPreferenceSaveSections(
  sections: Iterable<PreferenceSaveSection>,
): string {
  const active = new Set(sections);
  return PREFERENCE_SAVE_SECTIONS.filter((section) => active.has(section))
    .map((section) => PREFERENCE_SAVE_SECTION_LABELS[section])
    .join("、");
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

export async function registerPreferences(): Promise<void> {
  if (registeredPaneID) return;
  registeredPaneID = await Zotero.PreferencePanes.register({
    pluginID: config.addonID,
    id: `${config.addonRef}-prefs`,
    label: "AI 对话",
    src: `chrome://${config.addonRef}/content/preferences.xhtml`,
    image: `chrome://${config.addonRef}/content/icons/ai-chat.svg`,
  });
}

export function unregisterPreferences(): void {
  if (!registeredPaneID) return;
  Zotero.PreferencePanes.unregister(registeredPaneID);
  registeredPaneID = null;
}
