import { describe, expect, it } from "vitest";

import {
  DEFAULT_MATERIAL_PICK_SHORTCUT,
  formatMaterialPickShortcut,
  getMaterialPickShortcut,
  isMaterialPickShortcut,
  materialShortcutFromEvent,
  setMaterialPickShortcut,
} from "../../src/modules/material-shortcut";
import type { PrefsStore } from "../../src/settings/storage";

function memoryPrefs(initial?: string): PrefsStore {
  let value = initial;
  return {
    get: () => value,
    set: (_key, next) => {
      value = next;
    },
  };
}

function keyEvent(
  key: string,
  mods: Partial<{
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
    isComposing: boolean;
  }> = {},
) {
  return {
    key,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    ...mods,
  };
}

describe("material pick shortcut", () => {
  it("defaults to a Ctrl combination and stays configurable", () => {
    const prefs = memoryPrefs();
    expect(getMaterialPickShortcut(prefs)).toBe(DEFAULT_MATERIAL_PICK_SHORTCUT);
    expect(DEFAULT_MATERIAL_PICK_SHORTCUT).toContain("Ctrl+");

    setMaterialPickShortcut(prefs, "Ctrl+Alt+M");
    expect(getMaterialPickShortcut(prefs)).toBe("Ctrl+Alt+M");

    setMaterialPickShortcut(prefs, "   ");
    expect(getMaterialPickShortcut(prefs)).toBe(DEFAULT_MATERIAL_PICK_SHORTCUT);
  });

  it("normalizes a handwritten binding and rejects unusable ones", () => {
    expect(formatMaterialPickShortcut("ctrl + shift + m")).toBe("Ctrl+Shift+M");
    expect(formatMaterialPickShortcut("Control+M")).toBe("Ctrl+M");
    expect(formatMaterialPickShortcut("Ctrl")).toBeNull();
    expect(formatMaterialPickShortcut("")).toBeNull();
  });

  it("matches only the recorded modifiers and key", () => {
    expect(
      isMaterialPickShortcut(
        keyEvent("M", { ctrlKey: true, shiftKey: true }),
        "Ctrl+Shift+M",
      ),
    ).toBe(true);
    expect(
      isMaterialPickShortcut(keyEvent("m", { ctrlKey: true }), "Ctrl+Shift+M"),
    ).toBe(false);
    expect(
      isMaterialPickShortcut(
        keyEvent("M", { ctrlKey: true, shiftKey: true, isComposing: true }),
        "Ctrl+Shift+M",
      ),
    ).toBe(false);
  });

  it("records a pressed combination but not a bare key", () => {
    expect(
      materialShortcutFromEvent(keyEvent("m", { ctrlKey: true, shiftKey: true })),
    ).toBe("Ctrl+Shift+M");
    expect(materialShortcutFromEvent(keyEvent(" ", { ctrlKey: true }))).toBe(
      "Ctrl+Space",
    );
    expect(materialShortcutFromEvent(keyEvent("m"))).toBeNull();
    expect(materialShortcutFromEvent(keyEvent("Control", { ctrlKey: true }))).toBeNull();
  });
});
