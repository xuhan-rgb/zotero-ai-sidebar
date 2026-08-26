import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("GitHub Release artifacts", () => {
  it("requires the lightweight XPI and separate Web Agent runtime in every version release", () => {
    const workflow = readFileSync(
      resolve(process.cwd(), ".github/workflows/release.yml"),
      "utf8",
    );

    expect(workflow).toContain(".scaffold/build/zotero-ai-sidebar.xpi");
    expect(workflow).toContain(".scaffold/build/zai-web-agent-runtime.zip");
    expect(workflow).toContain("if-no-files-found: error");
    expect(workflow).toContain(
      'RUNTIME_ASSET=".scaffold/build/zai-web-agent-runtime.zip"',
    );
    expect(workflow).toContain('gh release upload "$RELEASE_TAG"');
  });
});
