import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { patchFirefoxStartup } from "../../scripts/patch-playwright-firefox.mjs";

describe("pinned Playwright Firefox startup compatibility", () => {
  it("packages a driver that adopts startup windows and can be prepared repeatedly", () => {
    const driver = readFileSync(
      "web-agent/node_modules/playwright-core/lib/coreBundle.js",
      "utf8",
    );
    expect(driver).toContain("Zotero: adopt Firefox's startup window");
    expect(patchFirefoxStartup(driver)).toBe(driver);
  });
  it("fails explicitly when a driver update changes the startup implementation", () => {
    expect(() => patchFirefoxStartup("unrecognized driver")).toThrow(
      "review the compatibility patch",
    );
  });
});
