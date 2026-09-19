import type { PrefsStore } from "../settings/storage";
import { formatKeybinding, parseKeybinding } from "../translate/keybinding";

const MATERIAL_PICK_SHORTCUT_PREF =
  "extensions.zotero-ai-sidebar.materialPickShortcut";
export const DEFAULT_MATERIAL_PICK_SHORTCUT = "Ctrl+Shift+M";

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph"]);

interface MaterialPickShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing: boolean;
}

export function getMaterialPickShortcut(prefs: PrefsStore): string {
  const value = prefs.get(MATERIAL_PICK_SHORTCUT_PREF);
  return typeof value === "string" && value.trim()
    ? value.trim()
    : DEFAULT_MATERIAL_PICK_SHORTCUT;
}

export function setMaterialPickShortcut(
  prefs: PrefsStore,
  value: string,
): void {
  prefs.set(
    MATERIAL_PICK_SHORTCUT_PREF,
    formatMaterialPickShortcut(value) ?? DEFAULT_MATERIAL_PICK_SHORTCUT,
  );
}

/** Normalizes a stored or typed binding; null when it cannot be used. */
export function formatMaterialPickShortcut(value: string): string | null {
  const binding = parseKeybinding(value);
  // Without Ctrl/Alt/Meta the shortcut would swallow ordinary typing.
  if (!binding || (!binding.ctrl && !binding.alt && !binding.meta)) return null;
  return formatKeybinding({
    ...binding,
    key: binding.key.length === 1 ? binding.key.toUpperCase() : binding.key,
  });
}

/**
 * Records a pressed combination. A modifier-only press (or a bare key, which
 * would swallow ordinary typing) records nothing.
 */
export function materialShortcutFromEvent(
  event: MaterialPickShortcutEvent,
): string | null {
  const key = event.key === " " ? "Space" : event.key;
  if (!key || MODIFIER_KEYS.has(key)) return null;
  if (!event.ctrlKey && !event.altKey && !event.metaKey) return null;
  return formatKeybinding({
    key: key.length === 1 ? key.toUpperCase() : key,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  });
}

export function isMaterialPickShortcut(
  event: MaterialPickShortcutEvent,
  shortcut = DEFAULT_MATERIAL_PICK_SHORTCUT,
): boolean {
  if (event.isComposing) return false;
  const binding = parseKeybinding(shortcut);
  if (!binding) return false;
  const eventKey = event.key === " " ? "Space" : event.key;
  return (
    eventKey.toLowerCase() === binding.key.toLowerCase() &&
    event.ctrlKey === binding.ctrl &&
    event.metaKey === binding.meta &&
    event.shiftKey === binding.shift &&
    event.altKey === binding.alt
  );
}
