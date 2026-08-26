import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";

interface RuntimeArchiveOptions {
  projectRoot: string;
  runtimeVersion: string;
  protocolVersion: number;
}

interface RuntimeReleaseOptions extends RuntimeArchiveOptions {
  repository: string;
}

export interface WebAgentRuntimeRelease {
  archive: Uint8Array;
  assetName: "zai-web-agent-runtime.zip";
  downloadUrl: string;
  releaseUrl: string;
  sha256: string;
  size: number;
}

export async function buildWebAgentRuntimeRelease(
  options: RuntimeReleaseOptions,
): Promise<WebAgentRuntimeRelease> {
  const archive = await buildWebAgentRuntimeArchive(options);
  const assetName = "zai-web-agent-runtime.zip" as const;
  const releaseUrl = `https://github.com/${options.repository}/releases/tag/v${options.runtimeVersion}`;
  return {
    archive,
    assetName,
    downloadUrl: `https://github.com/${options.repository}/releases/download/v${options.runtimeVersion}/${assetName}`,
    releaseUrl,
    sha256: createHash("sha256").update(archive).digest("hex"),
    size: archive.byteLength,
  };
}

export async function buildWebAgentRuntimeArchive(
  options: RuntimeArchiveOptions,
): Promise<Uint8Array> {
  const webAgentDir = path.join(options.projectRoot, "web-agent");
  const playwrightDir = path.join(
    webAgentDir,
    "node_modules",
    "playwright-core",
  );
  const entries: Record<string, Uint8Array> = {};
  const webAgentFiles = (await readdir(webAgentDir))
    .filter((name) => name.endsWith(".mjs") || name === "package.json")
    .sort();
  for (const name of webAgentFiles) {
    entries[name] = await readFile(path.join(webAgentDir, name));
  }
  await collectDirectory(
    playwrightDir,
    "node_modules/playwright-core",
    entries,
  );
  entries["runtime-manifest.json"] = new TextEncoder().encode(
    JSON.stringify({
      runtimeVersion: options.runtimeVersion,
      protocolVersion: options.protocolVersion,
    }),
  );
  return zipSync(entries, { level: 9 });
}

async function collectDirectory(
  sourceDir: string,
  archiveDir: string,
  entries: Record<string, Uint8Array>,
): Promise<void> {
  const children = await readdir(sourceDir, { withFileTypes: true });
  children.sort((left, right) => left.name.localeCompare(right.name));
  for (const child of children) {
    const sourcePath = path.join(sourceDir, child.name);
    const archivePath = `${archiveDir}/${child.name}`;
    if (child.isDirectory()) {
      await collectDirectory(sourcePath, archivePath, entries);
    } else if (child.isFile()) {
      entries[archivePath] = await readFile(sourcePath);
    }
  }
}
