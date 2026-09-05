import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
import { version as addonVersion } from "../../package.json";
import {
  buildWebAgentRuntimeArchive,
  buildWebAgentRuntimeRelease,
} from "../../scripts/web-agent-runtime-archive";

describe("Web Agent runtime archive", () => {
  it("keeps the same ZIP identity across build times and XPI releases when the Agent is unchanged", async () => {
    vi.useFakeTimers();
    try {
      const options = {
        projectRoot: path.resolve("."),
        protocolVersion: 24,
        repository: "xuhan-rgb/zotero-ai-sidebar",
      };
      vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
      const first = await buildWebAgentRuntimeRelease({
        ...options,
        releaseVersion: "0.8.6",
      });
      vi.setSystemTime(new Date("2026-09-06T12:00:00Z"));
      const second = await buildWebAgentRuntimeRelease({
        ...options,
        releaseVersion: "0.8.7",
      });
      expect(second.sha256).toBe(first.sha256);
      expect(second.downloadUrl).not.toBe(first.downloadUrl);
    } finally {
      vi.useRealTimers();
    }
  });

  it("packages the agent, its pinned browser driver, and a matching manifest", async () => {
    const archive = await buildWebAgentRuntimeArchive({
      projectRoot: path.resolve("."),
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
    ).toEqual({ protocolVersion: 24 });
    expect(
      JSON.parse(new TextDecoder().decode(files["package.json"])),
    ).not.toHaveProperty("version");
  });

  it("builds a versioned GitHub Release asset with integrity metadata", async () => {
    const release = await buildWebAgentRuntimeRelease({
      projectRoot: path.resolve("."),
      releaseVersion: addonVersion,
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
