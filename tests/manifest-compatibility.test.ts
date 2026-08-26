import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync("addon/manifest.json", "utf8")) as {
  applications: {
    zotero: {
      strict_min_version: string;
      strict_max_version: string;
    };
  };
};

describe("Zotero application compatibility", () => {
  it("keeps Zotero 7 support while allowing Zotero 10", () => {
    expect(manifest.applications.zotero).toMatchObject({
      strict_min_version: "7.0",
      strict_max_version: "10.*",
    });
  });
});
