import { describe, expect, it } from "vitest";

import type { PrefsStore } from "../../src/settings/storage";
import {
  getImmersiveClickMode,
  setImmersiveClickMode,
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
