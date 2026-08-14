import { appendLocalPath, localDirname } from "../utils/local-path";
import { extractArchive } from "./arxiv-archive";
import { DEFAULT_CONTEXT_POLICY } from "./policy";
import type {
  GitHubRepositoryReference,
  GitHubTreeFile,
} from "./github-repository";

interface IOUtilsLike {
  makeDirectory(
    path: string,
    options?: { ignoreExisting?: boolean },
  ): Promise<void>;
  write(path: string, data: Uint8Array): Promise<unknown>;
  writeUTF8(path: string, data: string): Promise<unknown>;
  readUTF8(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}

interface GitHubSnapshotMeta {
  version: 1;
  owner: string;
  repo: string;
  defaultBranch: string;
  commitSHA: string;
  files: GitHubTreeFile[];
  cachedPaths: string[];
}

export interface GitHubRepositorySnapshot {
  files: GitHubTreeFile[];
  readText(path: string): Promise<string | null>;
}

export interface GitHubRepositorySnapshotStore {
  load(
    reference: GitHubRepositoryReference,
  ): Promise<GitHubRepositorySnapshot | null>;
  install(
    reference: GitHubRepositoryReference,
    files: GitHubTreeFile[],
    archive: Uint8Array,
    cachedPaths: string[],
  ): Promise<GitHubRepositorySnapshot>;
}

function runtime(): { root: string; io: IOUtilsLike } | null {
  const global = globalThis as unknown as {
    IOUtils?: IOUtilsLike;
    Zotero?: {
      DataDirectory?: { dir?: string; path?: string };
      Profile?: { dir?: string };
    };
  };
  const root =
    global.Zotero?.DataDirectory?.dir ??
    global.Zotero?.DataDirectory?.path ??
    global.Zotero?.Profile?.dir;
  return root && global.IOUtils ? { root, io: global.IOUtils } : null;
}

function safeSegment(value: string): string {
  return encodeURIComponent(value.trim());
}

function safeRelativePath(value: string): string | null {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.split("/").includes("..")
  ) {
    return null;
  }
  return normalized;
}

function snapshotFolder(
  root: string,
  reference: GitHubRepositoryReference,
): string {
  return appendLocalPath(
    root,
    "zotero-ai-sidebar",
    "repositories",
    safeSegment(reference.owner),
    safeSegment(reference.repo),
    safeSegment(reference.commitSHA),
  );
}

function metaPath(root: string, reference: GitHubRepositoryReference): string {
  return appendLocalPath(snapshotFolder(root, reference), "meta.json");
}

function sourcePath(
  root: string,
  reference: GitHubRepositoryReference,
  relativePath: string,
): string {
  return appendLocalPath(
    snapshotFolder(root, reference),
    "source",
    relativePath,
  );
}

function validTreeFile(value: unknown): value is GitHubTreeFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<GitHubTreeFile>;
  return (
    typeof file.path === "string" &&
    typeof file.sha === "string" &&
    typeof file.size === "number"
  );
}

function diskSnapshot(
  root: string,
  io: IOUtilsLike,
  reference: GitHubRepositoryReference,
  meta: GitHubSnapshotMeta,
): GitHubRepositorySnapshot {
  const cachedPaths = new Set(meta.cachedPaths);
  return {
    files: meta.files,
    async readText(path: string): Promise<string | null> {
      const relative = safeRelativePath(path);
      if (!relative || !cachedPaths.has(relative)) return null;
      try {
        return await io.readUTF8(sourcePath(root, reference, relative));
      } catch {
        return null;
      }
    },
  };
}

function archiveRelativePath(
  rawPath: string,
  allowedPaths: Set<string>,
): string | null {
  const safe = safeRelativePath(rawPath);
  if (!safe) return null;
  if (allowedPaths.has(safe)) return safe;
  const slash = safe.indexOf("/");
  if (slash < 0) return null;
  const withoutArchiveRoot = safe.slice(slash + 1);
  return allowedPaths.has(withoutArchiveRoot) ? withoutArchiveRoot : null;
}

class ZoteroGitHubRepositorySnapshotStore implements GitHubRepositorySnapshotStore {
  constructor(
    private readonly root: string,
    private readonly io: IOUtilsLike,
  ) {}

  async load(
    reference: GitHubRepositoryReference,
  ): Promise<GitHubRepositorySnapshot | null> {
    try {
      const path = metaPath(this.root, reference);
      if (!(await this.io.exists(path))) return null;
      const parsed = JSON.parse(
        await this.io.readUTF8(path),
      ) as Partial<GitHubSnapshotMeta>;
      if (
        parsed.version !== 1 ||
        parsed.owner !== reference.owner ||
        parsed.repo !== reference.repo ||
        parsed.commitSHA !== reference.commitSHA ||
        !Array.isArray(parsed.files) ||
        !parsed.files.every(validTreeFile) ||
        !Array.isArray(parsed.cachedPaths) ||
        !parsed.cachedPaths.every((item) => typeof item === "string")
      ) {
        return null;
      }
      return diskSnapshot(this.root, this.io, reference, {
        version: 1,
        owner: reference.owner,
        repo: reference.repo,
        defaultBranch: reference.defaultBranch,
        commitSHA: reference.commitSHA,
        files: parsed.files,
        cachedPaths: parsed.cachedPaths,
      });
    } catch {
      return null;
    }
  }

  async install(
    reference: GitHubRepositoryReference,
    files: GitHubTreeFile[],
    archive: Uint8Array,
    cachedPaths: string[],
  ): Promise<GitHubRepositorySnapshot> {
    if (archive.byteLength > DEFAULT_CONTEXT_POLICY.githubSnapshotMaxBytes) {
      throw new Error("GitHub 源码快照超过本地缓存大小限制。");
    }
    const folder = snapshotFolder(this.root, reference);
    await this.io.makeDirectory(appendLocalPath(folder, "source"), {
      ignoreExisting: true,
    });
    const allowedPaths = new Set(cachedPaths);
    const written: string[] = [];
    let writtenBytes = 0;
    for (const file of await extractArchive(archive)) {
      const relative = archiveRelativePath(file.path, allowedPaths);
      if (!relative) continue;
      if (
        file.bytes.byteLength >
        DEFAULT_CONTEXT_POLICY.githubSnapshotMaxFileBytes
      ) {
        continue;
      }
      writtenBytes += file.bytes.byteLength;
      if (writtenBytes > DEFAULT_CONTEXT_POLICY.githubSnapshotMaxBytes) {
        throw new Error("GitHub 源码快照解压后超过本地缓存大小限制。");
      }
      const destination = sourcePath(this.root, reference, relative);
      const parent = localDirname(destination);
      if (parent) {
        await this.io.makeDirectory(parent, { ignoreExisting: true });
      }
      await this.io.write(destination, file.bytes);
      written.push(relative);
    }
    if (!written.length) {
      throw new Error("GitHub 源码快照中没有可缓存的文本源码。");
    }
    const meta: GitHubSnapshotMeta = {
      version: 1,
      owner: reference.owner,
      repo: reference.repo,
      defaultBranch: reference.defaultBranch,
      commitSHA: reference.commitSHA,
      files,
      cachedPaths: written,
    };
    await this.io.writeUTF8(
      metaPath(this.root, reference),
      JSON.stringify(meta),
    );
    return diskSnapshot(this.root, this.io, reference, meta);
  }
}

export function createGitHubRepositorySnapshotStore(): GitHubRepositorySnapshotStore | null {
  const available = runtime();
  return available
    ? new ZoteroGitHubRepositorySnapshotStore(available.root, available.io)
    : null;
}
