import { describe, expect, it } from "vitest";

import type { PrefsStore } from "../../src/settings/storage";
import {
  DEFAULT_IMMERSIVE_MODE_SHORTCUT,
  getImmersiveClickMode,
  getImmersiveModeShortcut,
  isImmersiveModeShortcut,
  setImmersiveClickMode,
  setImmersiveModeShortcut,
} from "../../src/translate/ask-mode";

function memoryPrefs(initial?: string): PrefsStore {
  let value = initial;
  return {
    get: () => value,
    set: (_key, next) => {
      value = next;
    },
  };
}

describe("immersive click mode", () => {
  it("defaults to the ask-or-translate chooser", () => {
    expect(getImmersiveClickMode(memoryPrefs())).toBe("chooser");
  });

  it("preserves an explicitly selected direct card mode", () => {
    const prefs = memoryPrefs();
    setImmersiveClickMode(prefs, "card");

    expect(getImmersiveClickMode(prefs)).toBe("card");
  });

  it("preserves an explicitly selected chooser mode", () => {
    expect(getImmersiveClickMode(memoryPrefs("chooser"))).toBe("chooser");
  });
});

describe("immersive mode shortcut", () => {
  it("defaults to Alt+T", () => {
    expect(DEFAULT_IMMERSIVE_MODE_SHORTCUT).toBe("Alt+T");
    expect(getImmersiveModeShortcut(memoryPrefs())).toBe("Alt+T");
  });

  it("persists a custom shortcut", () => {
    const prefs = memoryPrefs();
    setImmersiveModeShortcut(prefs, "Ctrl+Alt+M");

    expect(getImmersiveModeShortcut(prefs)).toBe("Ctrl+Alt+M");
  });

  it("migrates the removed Alt+R default to Alt+T", () => {
    expect(getImmersiveModeShortcut(memoryPrefs("Alt+R"))).toBe("Alt+T");
  });

  it("matches the configured modifiers and key case-insensitively", () => {
    expect(
      isImmersiveModeShortcut(
        {
          key: "t",
          shiftKey: false,
          ctrlKey: false,
          altKey: true,
          metaKey: false,
          isComposing: false,
        },
        "Alt+T",
      ),
    ).toBe(true);
    expect(
      isImmersiveModeShortcut(
        {
          key: "t",
          shiftKey: false,
          ctrlKey: false,
          altKey: false,
          metaKey: false,
          isComposing: false,
        },
        "Alt+T",
      ),
    ).toBe(false);
  });
});
