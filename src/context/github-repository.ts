import { DEFAULT_CONTEXT_POLICY } from "./policy";
import type { InitialDetailCategory } from "./network-diagram-types";
import {
  createGitHubRepositorySnapshotStore,
  type GitHubRepositorySnapshot,
  type GitHubRepositorySnapshotStore,
} from "./github-repository-cache";

export interface GitHubRepositoryCoordinates {
  owner: string;
  repo: string;
}

export interface GitHubRepositoryReference extends GitHubRepositoryCoordinates {
  url: string;
  defaultBranch: string;
  commitSHA: string;
}

export interface GitHubTreeFile {
  path: string;
  sha: string;
  size: number;
}

export interface GitHubFileReadRequest {
  path: string;
  symbols?: string[];
  startLine?: number;
  endLine?: number;
  reason: string;
  coverage: InitialDetailCategory;
}

export interface GitHubFileEvidence extends GitHubFileReadRequest {
  evidenceID: string;
  sha: string;
  text: string;
  chars: number;
  truncated: boolean;
  symbols: string[];
}

export interface GitHubCodeSearchMatch {
  path: string;
  line: number;
  text: string;
}

export interface GitHubCodeSearchResult {
  query: string;
  prefix: string;
  matches: GitHubCodeSearchMatch[];
  scannedFiles: number;
  candidateFiles: number;
  truncated: boolean;
}

export interface GitHubFileOutlineEntry {
  kind: "import" | "class" | "function" | "type";
  signature: string;
  startLine: number;
  endLine: number;
}

export interface GitHubFileOutline {
  path: string;
  totalLines: number;
  entries: GitHubFileOutlineEntry[];
  truncated: boolean;
}

export type GitHubFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface OpenGitHubRepositoryOptions {
  fetcher?: GitHubFetch;
  commitSHA?: string;
  defaultBranch?: string;
  maxFileChars?: number;
  maxRangeLines?: number;
  maxAnalysisChars?: number;
  requestBudget?: number;
  snapshotStore?: GitHubRepositorySnapshotStore | null;
}

const SOURCE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cfg",
  ".conf",
  ".cpp",
  ".cu",
  ".cuh",
  ".go",
  ".h",
  ".hpp",
  ".ini",
  ".java",
  ".jl",
  ".js",
  ".json",
  ".md",
  ".m",
  ".mm",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".toml",
  ".ts",
  ".tsx",
  ".xml",
  ".yaml",
  ".yml",
]);

const EXCLUDED_SEGMENTS = new Set([
  ".git",
  ".github",
  ".idea",
  ".vscode",
  "__pycache__",
  "build",
  "checkpoints",
  "dist",
  "docs/_build",
  "node_modules",
  "outputs",
  "third_party",
  "vendor",
  "weights",
]);

const DETAIL_CATEGORIES = new Set<InitialDetailCategory>([
  "inputs-preprocess",
  "backbone-features",
  "core-innovations",
  "branches-fusion",
  "inference-path",
  "training-path",
  "parameters-tensors",
  "outputs",
]);

const WHOLE_FILE_EXTENSIONS = new Set([
  ".cfg",
  ".conf",
  ".ini",
  ".json",
  ".md",
  ".toml",
  ".xml",
  ".yaml",
  ".yml",
]);
const MAX_WHOLE_FILE_CHARS = 20_000;
const DEFAULT_SEARCH_FILE_LIMIT = 80;
const MAX_SEARCH_MATCHES = 100;
const MAX_SEARCH_LINE_CHARS = 400;
const MAX_OUTLINE_ENTRIES = 200;

function apiHeaders(): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function requireOk(response: Response, label: string): Promise<Response> {
  if (response.ok) return response;
  if (response.status === 404) {
    throw new Error(`${label}不存在、是私有仓库，或当前无法公开访问。`);
  }
  if (response.status === 403 || response.status === 429) {
    const reset = response.headers.get("x-ratelimit-reset");
    throw new Error(
      `${label}触发 GitHub 访问限制${reset ? `（恢复时间 ${reset}）` : ""}。`,
    );
  }
  throw new Error(`${label}读取失败（HTTP ${response.status}）。`);
}

function cleanSegment(value: string): string {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

export function parsePublicGitHubRepositoryURL(
  raw: string,
): GitHubRepositoryCoordinates {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("请输入完整的公开 GitHub 仓库链接。");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "github.com"
  ) {
    throw new Error("第一版只接受 https://github.com/{owner}/{repo}。");
  }
  if (url.username || url.password) {
    throw new Error("GitHub 仓库链接不能包含用户名、Token 或其他凭证。");
  }
  const parts = url.pathname.split("/").map(cleanSegment).filter(Boolean);
  if (parts.length !== 2) {
    throw new Error("请输入仓库主页链接，不要输入文件、分支或任意网页 URL。");
  }
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  if (!owner || !repo || owner === "." || repo === ".") {
    throw new Error("GitHub 仓库 owner 或 repo 无效。");
  }
  return { owner, repo };
}

function pathExtension(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  return dot >= 0 ? file.slice(dot).toLowerCase() : "";
}

function isCandidatePath(path: string): boolean {
  const lower = path.toLowerCase();
  const segments = lower.split("/");
  if (
    segments.some((segment, index) =>
      EXCLUDED_SEGMENTS.has(
        index === 0 && segments.length > 1
          ? `${segment}/${segments[index + 1]}`
          : segment,
      ),
    )
  ) {
    return false;
  }
  const base = segments[segments.length - 1];
  return (
    SOURCE_EXTENSIONS.has(pathExtension(lower)) ||
    base === "makefile" ||
    base === "dockerfile"
  );
}

function candidatePriority(path: string): number {
  const lower = path.toLowerCase();
  let score = 0;
  if (/^readme(?:\.|$)/.test(lower)) score -= 50;
  if (/(^|\/)(config|configs|model|models|network|networks)(\/|$)/.test(lower))
    score -= 30;
  if (
    /(model|network|backbone|encoder|decoder|head|planner|loss|dataset)/.test(
      lower,
    )
  )
    score -= 15;
  score += lower.split("/").length;
  return score;
}

function normalizeSymbols(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((symbol): symbol is string => typeof symbol === "string")
        .map((symbol) => symbol.trim())
        .filter(Boolean),
    ),
  );
}

function sliceLineRange(
  text: string,
  startLine: number,
  endLine: number,
): string {
  const lines = text.split("\n");
  const start = Math.max(0, Math.floor(startLine) - 1);
  const end = Math.max(start + 1, Math.min(lines.length, Math.floor(endLine)));
  return lines.slice(start, end).join("\n");
}

function isWholeFileReadable(path: string, chars: number): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  return (
    chars <= MAX_WHOLE_FILE_CHARS &&
    (WHOLE_FILE_EXTENSIONS.has(pathExtension(path)) ||
      base === "makefile" ||
      base === "dockerfile")
  );
}

interface OutlineCandidate {
  kind: GitHubFileOutlineEntry["kind"];
  signature: string;
  startLine: number;
  indent: number;
}

function leadingIndent(line: string): number {
  let indent = 0;
  for (const char of line) {
    if (char === " ") indent += 1;
    else if (char === "\t") indent += 4;
    else break;
  }
  return indent;
}

function outlineCandidate(
  line: string,
  lineNumber: number,
): OutlineCandidate | null {
  const signature = line.trim();
  if (!signature || signature.startsWith("//") || signature.startsWith("*")) {
    return null;
  }
  const indent = leadingIndent(line);
  if (
    /^(?:from\s+\S+\s+import\s+|import\s+|#include\s*[<"]|use\s+\S+|package\s+\S+)/.test(
      signature,
    )
  ) {
    return { kind: "import", signature, startLine: lineNumber, indent };
  }
  if (
    /^(?:(?:export|public|private|protected|abstract|final)\s+)*(?:class)\s+[A-Za-z_$][\w$]*/.test(
      signature,
    )
  ) {
    return { kind: "class", signature, startLine: lineNumber, indent };
  }
  if (
    /^(?:(?:export|public|private|protected|abstract|final)\s+)*(?:interface|type|enum|struct|trait|impl)\s+[A-Za-z_$][\w$]*/.test(
      signature,
    )
  ) {
    return { kind: "type", signature, startLine: lineNumber, indent };
  }
  if (
    /^(?:async\s+def|def|async\s+function|function|(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn|func)\s+[A-Za-z_$][\w$]*/.test(
      signature,
    )
  ) {
    return { kind: "function", signature, startLine: lineNumber, indent };
  }
  if (
    /^(?:(?:public|private|protected|static|async|override|virtual|final|const)\s+)*[A-Za-z_$][\w$]*\s*\([^;]*\)\s*(?::[^={]+)?\s*(?:\{|:)?$/.test(
      signature,
    ) &&
    !/^(?:if|for|while|switch|catch|with)\s*\(/.test(signature)
  ) {
    return { kind: "function", signature, startLine: lineNumber, indent };
  }
  return null;
}

function buildFileOutline(path: string, text: string): GitHubFileOutline {
  const lines = text.split("\n");
  const candidates = lines.flatMap((line, index) => {
    const candidate = outlineCandidate(line, index + 1);
    return candidate ? [candidate] : [];
  });
  const selected = candidates.slice(0, MAX_OUTLINE_ENTRIES);
  const entries = selected.map((candidate, index) => {
    if (candidate.kind === "import") {
      return {
        kind: candidate.kind,
        signature: candidate.signature,
        startLine: candidate.startLine,
        endLine: candidate.startLine,
      };
    }
    let endLine = lines.length;
    for (let next = index + 1; next < candidates.length; next += 1) {
      if (candidates[next].indent <= candidate.indent) {
        endLine = candidates[next].startLine - 1;
        break;
      }
    }
    return {
      kind: candidate.kind,
      signature: candidate.signature,
      startLine: candidate.startLine,
      endLine,
    };
  });
  return {
    path,
    totalLines: lines.length,
    entries,
    truncated: candidates.length > entries.length,
  };
}

export class GitHubRepositorySession {
  readonly reference: GitHubRepositoryReference;
  readonly files: GitHubTreeFile[];
  readonly candidates: GitHubTreeFile[];
  readonly contentSource: "local-snapshot" | "remote-fallback";

  private readonly fileByPath: Map<string, GitHubTreeFile>;
  private readonly fetcher: GitHubFetch;
  private readonly maxFileChars: number;
  private readonly maxRangeLines: number;
  private readonly maxAnalysisChars: number;
  private readonly requestBudget: number;
  private requestCount = 0;
  private returnedChars = 0;
  private readonly contentCache = new Map<string, string>();
  private readonly snapshot: GitHubRepositorySnapshot | null;

  constructor(
    reference: GitHubRepositoryReference,
    files: GitHubTreeFile[],
    options: Required<
      Pick<
        OpenGitHubRepositoryOptions,
        | "fetcher"
        | "maxFileChars"
        | "maxRangeLines"
        | "maxAnalysisChars"
        | "requestBudget"
      >
    >,
    snapshot: GitHubRepositorySnapshot | null = null,
  ) {
    this.reference = reference;
    this.files = files;
    this.fileByPath = new Map(files.map((file) => [file.path, file]));
    this.candidates = files
      .filter((file) => isCandidatePath(file.path))
      .sort(
        (a, b) =>
          candidatePriority(a.path) - candidatePriority(b.path) ||
          a.path.localeCompare(b.path),
      );
    this.fetcher = options.fetcher;
    this.maxFileChars = options.maxFileChars;
    this.maxRangeLines = options.maxRangeLines;
    this.maxAnalysisChars = options.maxAnalysisChars;
    this.requestBudget = options.requestBudget;
    this.snapshot = snapshot;
    this.contentSource = snapshot ? "local-snapshot" : "remote-fallback";
  }

  remainingAnalysisChars(): number {
    return Math.max(0, this.maxAnalysisChars - this.returnedChars);
  }

  listCandidatePaths(query = "", prefix = ""): string[] {
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedPrefix = prefix.trim().replace(/^\/+/, "").toLowerCase();
    return this.candidates
      .map((file) => file.path)
      .filter(
        (path) =>
          (!normalizedPrefix ||
            path.toLowerCase().startsWith(normalizedPrefix)) &&
          (!normalizedQuery || path.toLowerCase().includes(normalizedQuery)),
      );
  }

  async searchCode(
    query: string,
    prefix = "",
    maxMatches = 40,
  ): Promise<GitHubCodeSearchResult> {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) throw new Error("代码搜索必须提供非空 query。");
    const normalizedPrefix = prefix.trim().replace(/^\/+/, "");
    const candidatePaths = this.listCandidatePaths("", normalizedPrefix);
    const paths = candidatePaths.slice(0, DEFAULT_SEARCH_FILE_LIMIT);
    const limit = Math.max(
      1,
      Math.min(MAX_SEARCH_MATCHES, Math.floor(maxMatches)),
    );
    const matches: GitHubCodeSearchMatch[] = [];
    let scannedFiles = 0;
    for (const path of paths) {
      const file = this.fileByPath.get(path);
      if (!file) continue;
      const text = await this.readRawFile(file);
      scannedFiles += 1;
      const lines = text.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        if (!lines[index].toLowerCase().includes(normalizedQuery)) continue;
        matches.push({
          path,
          line: index + 1,
          text: lines[index].trim().slice(0, MAX_SEARCH_LINE_CHARS),
        });
        if (matches.length >= limit) break;
      }
      if (matches.length >= limit) break;
    }
    return {
      query: query.trim(),
      prefix: normalizedPrefix,
      matches,
      scannedFiles,
      candidateFiles: candidatePaths.length,
      truncated:
        matches.length >= limit || scannedFiles < candidatePaths.length,
    };
  }

  async outlineFile(rawPath: string): Promise<GitHubFileOutline> {
    const path = rawPath.trim().replace(/^\/+/, "");
    const file = this.fileByPath.get(path);
    if (!file) {
      throw new Error(
        `拒绝读取 ${rawPath}：路径不属于固定 commit ${this.reference.commitSHA} 的目录树。`,
      );
    }
    return buildFileOutline(path, await this.readRawFile(file));
  }

  async readFiles(
    requests: GitHubFileReadRequest[],
  ): Promise<GitHubFileEvidence[]> {
    const out: GitHubFileEvidence[] = [];
    for (const request of requests) {
      const path = request.path?.trim().replace(/^\/+/, "");
      const file = this.fileByPath.get(path);
      if (!file) {
        throw new Error(
          `拒绝读取 ${request.path}：路径不属于固定 commit ${this.reference.commitSHA} 的目录树。`,
        );
      }
      const reason = request.reason?.trim();
      if (!reason) throw new Error(`读取 ${path} 时必须说明选择理由。`);
      if (!DETAIL_CATEGORIES.has(request.coverage)) {
        throw new Error(`读取 ${path} 时必须指定要补全的细节类别。`);
      }
      const symbols = normalizeSymbols(request.symbols);
      const hasStartLine = typeof request.startLine === "number";
      const hasEndLine = typeof request.endLine === "number";
      if (hasStartLine !== hasEndLine) {
        throw new Error(`读取 ${path} 时必须同时指定 startLine 和 endLine。`);
      }
      if (symbols.length && hasStartLine) {
        throw new Error(`读取 ${path} 时 symbols 和行范围不能同时使用。`);
      }
      if (symbols.length) {
        throw new Error(
          `读取源码 ${path} 不再接受 symbols。请先使用 github_outline_file 或 github_search_code 定位真实行号，再提供 startLine/endLine。`,
        );
      }
      const raw = await this.readRawFile(file);
      let extracted = raw;
      if (hasStartLine && hasEndLine) {
        const startLine = Math.floor(request.startLine as number);
        const endLine = Math.floor(request.endLine as number);
        const totalLines = raw.split("\n").length;
        if (startLine < 1 || endLine < startLine || startLine > totalLines) {
          throw new Error(
            `读取 ${path} 的行范围无效：${startLine}-${endLine}，文件共 ${totalLines} 行。`,
          );
        }
        if (endLine - startLine + 1 > this.maxRangeLines) {
          throw new Error(
            `读取 ${path} 的行范围过大：${startLine}-${endLine}；每次最多 ${this.maxRangeLines} 行，请拆成与符号或数据流对应的小范围。`,
          );
        }
        extracted = sliceLineRange(raw, startLine, endLine);
      } else if (!isWholeFileReadable(path, raw.length)) {
        throw new Error(
          `读取源码 ${path} 必须指定 startLine/endLine；只有不超过 ${MAX_WHOLE_FILE_CHARS.toLocaleString("en-US")} 字符的小型配置/文档允许全文读取。`,
        );
      }
      const remaining = this.remainingAnalysisChars();
      if (remaining <= 0) {
        throw new Error("本次 GitHub 分析文本预算已经耗尽。");
      }
      const limit = Math.min(this.maxFileChars, remaining);
      const text = extracted.slice(0, limit);
      const truncated =
        extracted.length > text.length || raw.length > extracted.length;
      this.returnedChars += text.length;
      out.push({
        ...request,
        path,
        symbols,
        sha: file.sha,
        evidenceID:
          hasStartLine && hasEndLine
            ? `code:${this.reference.commitSHA}:${path}:L${Math.floor(request.startLine as number)}-L${Math.floor(request.endLine as number)}`
            : `code:${this.reference.commitSHA}:${path}`,
        text,
        chars: text.length,
        truncated,
        reason,
      });
    }
    return out;
  }

  private async readRawFile(file: GitHubTreeFile): Promise<string> {
    const cached = this.contentCache.get(file.sha);
    if (cached != null) return cached;
    const local = await this.snapshot?.readText(file.path);
    if (local != null) {
      this.contentCache.set(file.sha, local);
      return local;
    }
    if (this.requestCount >= this.requestBudget) {
      throw new Error("本次 GitHub 网络请求预算已经耗尽。");
    }
    this.requestCount += 1;
    const encodedPath = file.path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const url = `https://raw.githubusercontent.com/${encodeURIComponent(
      this.reference.owner,
    )}/${encodeURIComponent(this.reference.repo)}/${encodeURIComponent(
      this.reference.commitSHA,
    )}/${encodedPath}`;
    const response = await requireOk(await this.fetcher(url), file.path);
    const text = await response.text();
    this.contentCache.set(file.sha, text);
    return text;
  }
}

export async function openGitHubRepository(
  rawURL: string,
  options: OpenGitHubRepositoryOptions = {},
): Promise<GitHubRepositorySession> {
  const { owner, repo } = parsePublicGitHubRepositoryURL(rawURL);
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const apiRoot = `https://api.github.com/repos/${encodeURIComponent(
    owner,
  )}/${encodeURIComponent(repo)}`;
  let defaultBranch = options.defaultBranch?.trim() ?? "";
  let commitSHA = options.commitSHA?.trim() ?? "";

  if (!defaultBranch) {
    const response = await requireOk(
      await fetcher(apiRoot, { headers: apiHeaders() }),
      `${owner}/${repo}`,
    );
    const repository = (await response.json()) as { default_branch?: unknown };
    defaultBranch =
      typeof repository.default_branch === "string"
        ? repository.default_branch
        : "";
    if (!defaultBranch) throw new Error("GitHub 仓库没有可用的默认分支。");
  }

  if (!commitSHA) {
    const response = await requireOk(
      await fetcher(`${apiRoot}/commits/${encodeURIComponent(defaultBranch)}`, {
        headers: apiHeaders(),
      }),
      `${owner}/${repo} 默认分支`,
    );
    const commit = (await response.json()) as { sha?: unknown };
    commitSHA = typeof commit.sha === "string" ? commit.sha : "";
    if (!commitSHA) throw new Error("无法固定 GitHub 仓库 commit。");
  }

  const reference: GitHubRepositoryReference = {
    url: `https://github.com/${owner}/${repo}`,
    owner,
    repo,
    defaultBranch,
    commitSHA,
  };
  const snapshotStore =
    options.snapshotStore === undefined
      ? createGitHubRepositorySnapshotStore()
      : options.snapshotStore;
  const cachedSnapshot = await snapshotStore?.load(reference);
  if (cachedSnapshot?.files.length) {
    return new GitHubRepositorySession(
      reference,
      cachedSnapshot.files,
      {
        fetcher,
        maxFileChars:
          options.maxFileChars ?? DEFAULT_CONTEXT_POLICY.githubMaxFileChars,
        maxRangeLines:
          options.maxRangeLines ?? DEFAULT_CONTEXT_POLICY.githubMaxRangeLines,
        maxAnalysisChars:
          options.maxAnalysisChars ??
          DEFAULT_CONTEXT_POLICY.githubAnalysisCharBudget,
        requestBudget:
          options.requestBudget ?? DEFAULT_CONTEXT_POLICY.githubRequestBudget,
      },
      cachedSnapshot,
    );
  }

  const treeResponse = await requireOk(
    await fetcher(
      `${apiRoot}/git/trees/${encodeURIComponent(commitSHA)}?recursive=1`,
      { headers: apiHeaders() },
    ),
    `${owner}/${repo} 目录树`,
  );
  const treePayload = (await treeResponse.json()) as {
    truncated?: unknown;
    tree?: unknown;
  };
  if (treePayload.truncated === true) {
    throw new Error("GitHub 返回的目录树不完整，已停止以避免漏读关键模块。");
  }
  const rawTree = Array.isArray(treePayload.tree) ? treePayload.tree : [];
  const files: GitHubTreeFile[] = rawTree
    .filter(
      (entry): entry is Record<string, unknown> =>
        !!entry &&
        typeof entry === "object" &&
        entry.type === "blob" &&
        typeof entry.path === "string" &&
        typeof entry.sha === "string",
    )
    .map((entry) => ({
      path: entry.path as string,
      sha: entry.sha as string,
      size:
        typeof entry.size === "number" && Number.isFinite(entry.size)
          ? entry.size
          : 0,
    }));
  if (!files.length) throw new Error("固定 commit 的目录树中没有可读文件。");

  let snapshot: GitHubRepositorySnapshot | null = null;
  if (snapshotStore) {
    try {
      const repositoryBytes = files.reduce(
        (total, file) => total + Math.max(0, file.size),
        0,
      );
      if (repositoryBytes > DEFAULT_CONTEXT_POLICY.githubSnapshotMaxBytes) {
        throw new Error("GitHub 仓库解压后超过本地缓存大小限制。");
      }
      const response = await requireOk(
        await fetcher(`${apiRoot}/tarball/${encodeURIComponent(commitSHA)}`, {
          headers: apiHeaders(),
        }),
        `${owner}/${repo} 固定 commit 源码快照`,
      );
      const contentLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(contentLength) &&
        contentLength > DEFAULT_CONTEXT_POLICY.githubSnapshotMaxBytes
      ) {
        throw new Error("GitHub 源码快照超过本地缓存大小限制。");
      }
      const archive = new Uint8Array(await response.arrayBuffer());
      if (archive.byteLength > DEFAULT_CONTEXT_POLICY.githubSnapshotMaxBytes) {
        throw new Error("GitHub 源码快照超过本地缓存大小限制。");
      }
      snapshot = await snapshotStore.install(
        reference,
        files,
        archive,
        files
          .filter((file) => isCandidatePath(file.path))
          .map((file) => file.path),
      );
    } catch {
      // A local snapshot is an optimization. Keep the existing pinned Raw
      // reader as a read-only fallback when archive download or disk IO fails.
      snapshot = null;
    }
  }

  return new GitHubRepositorySession(
    reference,
    files,
    {
      fetcher,
      maxFileChars:
        options.maxFileChars ?? DEFAULT_CONTEXT_POLICY.githubMaxFileChars,
      maxRangeLines:
        options.maxRangeLines ?? DEFAULT_CONTEXT_POLICY.githubMaxRangeLines,
      maxAnalysisChars:
        options.maxAnalysisChars ??
        DEFAULT_CONTEXT_POLICY.githubAnalysisCharBudget,
      requestBudget:
        options.requestBudget ?? DEFAULT_CONTEXT_POLICY.githubRequestBudget,
    },
    snapshot,
  );
}
