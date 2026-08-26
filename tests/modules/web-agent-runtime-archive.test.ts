import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { version as addonVersion } from "../../package.json";
import {
  buildWebAgentRuntimeArchive,
  buildWebAgentRuntimeRelease,
} from "../../scripts/web-agent-runtime-archive";

describe("Web Agent runtime archive", () => {
  it("packages the agent, its pinned browser driver, and a matching manifest", async () => {
    const archive = await buildWebAgentRuntimeArchive({
      projectRoot: path.resolve("."),
      runtimeVersion: addonVersion,
      protocolVersion: 24,
    });
    const files = unzipSync(archive);

    expect(files["agent.mjs"]).toBeInstanceOf(Uint8Array);
    expect(files["attachments.mjs"]).toBeInstanceOf(Uint8Array);
    expect(files["node_modules/playwright-core/index.mjs"]).toBeInstanceOf(
      Uint8Array,
    );
    expect(
      JSON.parse(new TextDecoder().decode(files["runtime-manifest.json"])),
    ).toEqual({ runtimeVersion: addonVersion, protocolVersion: 24 });
  });

  it("builds a versioned GitHub Release asset with integrity metadata", async () => {
    const release = await buildWebAgentRuntimeRelease({
      projectRoot: path.resolve("."),
      runtimeVersion: addonVersion,
      protocolVersion: 24,
      repository: "xuhan-rgb/zotero-ai-sidebar",
    });

    expect(release.assetName).toBe("zai-web-agent-runtime.zip");
    expect(release.downloadUrl).toBe(
      `https://github.com/xuhan-rgb/zotero-ai-sidebar/releases/download/v${addonVersion}/zai-web-agent-runtime.zip`,
    );
    expect(release.releaseUrl).toBe(
      `https://github.com/xuhan-rgb/zotero-ai-sidebar/releases/tag/v${addonVersion}`,
    );
    expect(release.size).toBe(release.archive.byteLength);
    expect(release.sha256).toBe(
      createHash("sha256").update(release.archive).digest("hex"),
    );
  });
});
