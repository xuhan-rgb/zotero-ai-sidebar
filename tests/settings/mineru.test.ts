import { describe, expect, it } from "vitest";
import type { PrefsStore } from "../../src/settings/storage";
import {
  loadMineruSettings,
  saveMineruSettings,
} from "../../src/settings/mineru";

function memPrefs(): PrefsStore {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("MinerU settings", () => {
  it("round-trips a trimmed token", () => {
    const prefs = memPrefs();
    saveMineruSettings(prefs, { token: "  abc.def  " });
    expect(loadMineruSettings(prefs)).toEqual({ token: "abc.def" });
  });

  it("returns an empty token for missing prefs", () => {
    expect(loadMineruSettings(memPrefs()).token).toBe("");
  });
});
