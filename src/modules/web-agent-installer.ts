import { version as ADDON_VERSION } from "../../package.json";
import { unzipSync } from "fflate";
import {
  clearWebAgentConfigCache,
  readWebAgentHealth,
  startWebAgent,
  stopWebAgent,
  WEB_AGENT_PROTOCOL_VERSION,
  type WebAgentConfig,
} from "./web-agent-client";

export type WebAgentPlatform = "linux" | "darwin" | "win32";

export interface WebAgentExecutableCandidatesInput {
  platform: WebAgentPlatform;
  homeDir: string;
  env: Record<string, string | undefined>;
}

export interface WebAgentExecutableCandidates {
  node: string[];
  chrome: string[];
  clipboard: string[];
}

export interface WebAgentHealth {
  ok: boolean;
  protocolVersion?: number;
  runtimeSha256?: string;
}

export interface WebAgentRuntimeRelease {
  protocolVersion: number;
  assetName: string;
  downloadUrl: string;
  releaseUrl: string;
  sha256: string;
  size: number;
}

export class WebAgentRuntimeDownloadError extends Error {
  constructor(
    message: string,
    public readonly downloadUrl: string,
    public readonly releaseUrl: string,
  ) {
    super(message);
    this.name = "WebAgentRuntimeDownloadError";
  }
}

export interface WebAgentInstallerHost {
  platform: WebAgentPlatform;
  homeDir: string;
  dataDir: string;
  profileDir: string;
  env: Record<string, string | undefined>;
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<Uint8Array>;
  readUTF8(path: string): Promise<string>;
  probeNodeVersion(path: string): Promise<string | null>;
  health(config: WebAgentConfig): Promise<WebAgentHealth | null>;
  fetchRuntimeArchive(url: string): Promise<Uint8Array>;
  sha256(value: Uint8Array): Promise<string>;
  makeDirectory(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  write(path: string, value: Uint8Array): Promise<void>;
  writeUTF8(path: string, value: string): Promise<void>;
  setPermissions(path: string, permissions: number): Promise<void>;
  randomToken(): string;
  stop(config: WebAgentConfig): Promise<boolean>;
  start(config: WebAgentConfig): Promise<boolean>;
  delay(milliseconds: number): Promise<void>;
}

export interface WebAgentInstallationReport {
  state: "ready" | "repairable" | "blocked";
  action: "none" | "install" | "upgrade";
  message: string;
  nodePath?: string;
  nodeVersion?: string;
  chromePath?: string;
  clipboardPath?: string;
  configPresent: boolean;
  missing: string[];
}

export async function checkWebAgentAfterXpiUpdate(
  host: WebAgentInstallerHost = createZoteroWebAgentInstallerHost(),
  release: WebAgentRuntimeRelease = webAgentRuntimeRelease(),
  xpiVersion = ADDON_VERSION,
): Promise<void> {
  const path = nativeJoin(
    host.platform,
    host.dataDir,
    "zai-web-agent-config.json",
  );
  const config = await readConfig(host, path);
  if (!config || config.checkedXpiVersion === xpiVersion) return;
  await recordPackageMatch(host, path, config, release.sha256, xpiVersion);
}

async function recordPackageMatch(
  host: WebAgentInstallerHost,
  path: string,
  config: WebAgentConfig,
  expectedSha256: string,
  xpiVersion = ADDON_VERSION,
): Promise<void> {
  config.checkedXpiVersion = xpiVersion;
  config.needsRuntimeUpdate = config.runtimeSha256 !== expectedSha256;
  await host.writeUTF8(path, `${JSON.stringify(config, null, 2)}\n`);
  clearWebAgentConfigCache();
}

export async function inspectWebAgentInstallation(
  host: WebAgentInstallerHost = createZoteroWebAgentInstallerHost(),
  release?: WebAgentRuntimeRelease,
): Promise<WebAgentInstallationReport> {
  const configPath = nativeJoin(
    host.platform,
    host.dataDir,
    "zai-web-agent-config.json",
  );
  const config = await readConfig(host, configPath);
  // Only explicit installation/update checks supply a release. Ordinary use
  // reads the saved result without comparing ZIP identities or hashing files.
  if (config && release)
    await recordPackageMatch(host, configPath, config, release.sha256);
  const candidates = webAgentExecutableCandidates(host);
  const node = await findSupportedNode(host, [
    config?.nodePath,
    ...candidates.node,
  ]);
  const chromePath = await firstExisting(host, [
    config?.chromePath,
    ...candidates.chrome,
  ]);
  const clipboardPath =
    host.platform === "linux"
      ? await firstExisting(host, candidates.clipboard)
      : undefined;
  const missing: string[] = [];
  if (!node) missing.push("Node.js 20+");
  if (!chromePath) missing.push("Google Chrome");
  if (host.platform === "linux" && !clipboardPath) missing.push("xclip");

  if (missing.length > 0) {
    return {
      state: "blocked",
      action: config ? "upgrade" : "install",
      message: `缺少系统依赖：${missing.join("、")}`,
      nodePath: node?.path,
      nodeVersion: node?.version,
      chromePath,
      clipboardPath,
      configPresent: Boolean(config),
      missing,
    };
  }

  if (
    config &&
    config.needsRuntimeUpdate === false &&
    (await configRuntimeExists(host, config))
  ) {
    let health = await host.health(config);
    if (!health) {
      const started = await host.start(config).catch(() => false);
      if (started) {
        for (let attempt = 0; attempt < 40; attempt += 1) {
          await refreshStartedConfig(host, configPath, config);
          health = await host.health(config);
          if (health) break;
          await host.delay(250);
        }
      }
    }
    if (
      health?.ok === true &&
      health.protocolVersion === WEB_AGENT_PROTOCOL_VERSION &&
      (!release || health.runtimeSha256 === release.sha256)
    ) {
      return {
        state: "ready",
        action: "none",
        message: "Web Agent 已就绪",
        nodePath: node?.path,
        nodeVersion: node?.version,
        chromePath,
        clipboardPath,
        configPresent: true,
        missing,
      };
    }
  }

  return {
    state: "repairable",
    action: config ? "upgrade" : "install",
    message:
      config && config.needsRuntimeUpdate !== false
        ? "Web Agent 运行包与当前插件不匹配，请安装配套运行包"
        : config
          ? "Web Agent 需要检查或修复"
          : "尚未安装 Web Agent，可以在线下载并安装",
    nodePath: node?.path,
    nodeVersion: node?.version,
    chromePath,
    clipboardPath,
    configPresent: Boolean(config),
    missing,
  };
}

export async function repairWebAgentInstallation(
  host: WebAgentInstallerHost = createZoteroWebAgentInstallerHost(),
  release: WebAgentRuntimeRelease = webAgentRuntimeRelease(),
): Promise<WebAgentInstallationReport> {
  const report = await inspectWebAgentInstallation(host, release);
  if (report.state === "blocked") throw new Error(report.message);
  if (report.state === "ready") return report;

  let archiveBytes: Uint8Array;
  try {
    archiveBytes = await host.fetchRuntimeArchive(release.downloadUrl);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new WebAgentRuntimeDownloadError(
      `Web Agent 下载失败：${detail}`,
      release.downloadUrl,
      release.releaseUrl,
    );
  }
  return installWebAgentRuntimeArchive(host, report, archiveBytes, release);
}

export async function installLocalWebAgentRuntime(
  path: string,
  host: WebAgentInstallerHost = createZoteroWebAgentInstallerHost(),
  release: WebAgentRuntimeRelease = webAgentRuntimeRelease(),
): Promise<WebAgentInstallationReport> {
  const report = await inspectWebAgentInstallation(host, release);
  if (report.state === "blocked") throw new Error(report.message);
  return installWebAgentRuntimeArchive(
    host,
    report,
    await host.read(path),
    release,
  );
}

async function installWebAgentRuntimeArchive(
  host: WebAgentInstallerHost,
  report: WebAgentInstallationReport,
  archiveBytes: Uint8Array,
  release: WebAgentRuntimeRelease,
): Promise<WebAgentInstallationReport> {
  const configPath = nativeJoin(
    host.platform,
    host.dataDir,
    "zai-web-agent-config.json",
  );
  const previousRaw = await readOptionalUTF8(host, configPath);
  const previous = await readConfig(host, configPath);
  if (archiveBytes.byteLength !== release.size) {
    throw new Error(
      `Web Agent 运行包大小不匹配：应为 ${release.size} 字节，实际为 ${archiveBytes.byteLength} 字节`,
    );
  }
  const actualSha256 = await host.sha256(archiveBytes);
  if (actualSha256.toLowerCase() !== release.sha256.toLowerCase()) {
    throw new Error("Web Agent 运行包 SHA-256 校验失败");
  }
  const archive = validateRuntimeArchive(unzipSync(archiveBytes), release);
  if (report.state === "ready" && previous?.runtimeSha256 === release.sha256)
    return report;
  const runtimeDir = nativeJoin(
    host.platform,
    host.profileDir,
    "zai-web-agent",
    `runtime-${release.sha256}`,
  );
  await writeRuntimeArchive(host, runtimeDir, archive);

  const previousRunning = previous
    ? Boolean(await host.health(previous))
    : false;
  let previousStopped = false;
  if (previous && previousRunning) {
    previousStopped = await host.stop(previous).catch(() => false);
    if (!previousStopped)
      throw new Error("旧 Web Agent 未能停止，请关闭 WEB 任务后重试升级");
  }
  const config: WebAgentConfig = {
    runtimeSha256: release.sha256,
    checkedXpiVersion: ADDON_VERSION,
    needsRuntimeUpdate: false,
    token: previous?.token || host.randomToken(),
    nodePath: report.nodePath!,
    chromePath: report.chromePath!,
    agentScript: nativeJoin(host.platform, runtimeDir, "agent.mjs"),
    profileDir:
      previous?.profileDir ||
      nativeJoin(
        host.platform,
        host.profileDir,
        "zai-web-agent",
        "browser-profile",
      ),
    cdpPort: 0,
    port: 0,
    callbackUrl:
      previous?.callbackUrl || "http://127.0.0.1:23119/zai/web-prompt-hub",
  };
  let newRuntimeStarted = false;
  try {
    await host.makeDirectory(config.profileDir);
    await host.writeUTF8(configPath, `${JSON.stringify(config, null, 2)}\n`);
    await host.setPermissions(configPath, 0o600).catch(() => undefined);
    clearWebAgentConfigCache();

    newRuntimeStarted = await host.start(config);
    if (!newRuntimeStarted) {
      throw new Error("Web Agent 启动失败，请检查 Node.js 和 Chrome 路径");
    }
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await refreshStartedConfig(host, configPath, config);
      const health = await host.health(config);
      if (
        health?.ok === true &&
        health.protocolVersion === WEB_AGENT_PROTOCOL_VERSION &&
        health.runtimeSha256 === release.sha256
      ) {
        return {
          state: "ready",
          action: "none",
          message: "Web Agent 配套运行包已安装并通过健康检查",
          nodePath: report.nodePath,
          nodeVersion: report.nodeVersion,
          chromePath: report.chromePath,
          clipboardPath: report.clipboardPath,
          configPresent: true,
          missing: [],
        };
      }
      await host.delay(250);
    }
    throw new Error("Web Agent 安装完成，但健康检查未通过");
  } catch (error) {
    if (newRuntimeStarted) await host.stop(config).catch(() => false);
    if (previousRaw == null) {
      await host.remove(configPath).catch(() => undefined);
    } else {
      await host.writeUTF8(configPath, previousRaw);
      await host.setPermissions(configPath, 0o600).catch(() => undefined);
    }
    clearWebAgentConfigCache();
    if (
      previous &&
      !previous.needsRuntimeUpdate &&
      previousRunning &&
      previousStopped
    ) {
      await host.start(previous).catch(() => false);
    }
    throw error;
  }
}

export function webAgentExecutableCandidates(
  input: WebAgentExecutableCandidatesInput,
): WebAgentExecutableCandidates {
  const pathDirectories = (input.env.PATH ?? "")
    .split(input.platform === "win32" ? ";" : ":")
    .filter(Boolean);
  if (input.platform === "win32") {
    const programFiles = input.env.ProgramFiles;
    const programFilesX86 = input.env["ProgramFiles(x86)"];
    const localAppData = input.env.LOCALAPPDATA;
    return {
      node: unique([
        ...pathDirectories.map((dir) => winJoin(dir, "node.exe")),
        programFiles && winJoin(programFiles, "nodejs", "node.exe"),
        programFilesX86 && winJoin(programFilesX86, "nodejs", "node.exe"),
        localAppData && winJoin(localAppData, "Programs", "nodejs", "node.exe"),
        winJoin(input.homeDir, ".local", "bin", "node.exe"),
      ]),
      chrome: unique([
        ...pathDirectories.map((dir) => winJoin(dir, "chrome.exe")),
        programFiles &&
          winJoin(
            programFiles,
            "Google",
            "Chrome",
            "Application",
            "chrome.exe",
          ),
        programFilesX86 &&
          winJoin(
            programFilesX86,
            "Google",
            "Chrome",
            "Application",
            "chrome.exe",
          ),
        localAppData &&
          winJoin(
            localAppData,
            "Google",
            "Chrome",
            "Application",
            "chrome.exe",
          ),
      ]),
      clipboard: [],
    };
  }

  if (input.platform === "darwin") {
    return {
      node: unique([
        ...pathDirectories.map((dir) => posixJoin(dir, "node")),
        posixJoin(input.homeDir, ".local", "bin", "node"),
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
      ]),
      chrome: unique([
        ...pathDirectories.map((dir) => posixJoin(dir, "google-chrome")),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        posixJoin(
          input.homeDir,
          "Applications",
          "Google Chrome.app",
          "Contents",
          "MacOS",
          "Google Chrome",
        ),
      ]),
      clipboard: [],
    };
  }

  return {
    node: unique([
      ...pathDirectories.map((dir) => posixJoin(dir, "node")),
      posixJoin(input.homeDir, ".local", "bin", "node"),
      "/usr/local/bin/node",
      "/usr/bin/node",
    ]),
    chrome: unique([
      ...pathDirectories.flatMap((dir) =>
        ["google-chrome", "google-chrome-stable", "chromium"].map((name) =>
          posixJoin(dir, name),
        ),
      ),
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/snap/bin/chromium",
    ]),
    clipboard: unique([
      ...pathDirectories.map((dir) => posixJoin(dir, "xclip")),
      "/usr/bin/xclip",
      "/usr/local/bin/xclip",
    ]),
  };
}

function posixJoin(...parts: string[]): string {
  return parts
    .map((part, index) =>
      index === 0 ? part.replace(/\/$/, "") : part.replace(/^\/+|\/+$/g, ""),
    )
    .filter(Boolean)
    .join("/");
}

function winJoin(...parts: string[]): string {
  return parts
    .map((part, index) =>
      index === 0
        ? part.replace(/[\\/]$/, "")
        : part.replace(/^[\\/]+|[\\/]+$/g, ""),
    )
    .filter(Boolean)
    .join("\\");
}

function nativeJoin(platform: WebAgentPlatform, ...parts: string[]): string {
  return platform === "win32" ? winJoin(...parts) : posixJoin(...parts);
}

async function readConfig(
  host: WebAgentInstallerHost,
  path: string,
): Promise<(WebAgentConfig & { runtimeVersion?: string }) | null> {
  if (!(await host.exists(path))) return null;
  try {
    const value = JSON.parse(await host.readUTF8(path));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

async function refreshStartedConfig(
  host: WebAgentInstallerHost,
  path: string,
  config: WebAgentConfig,
): Promise<void> {
  const published = await readConfig(host, path);
  if (
    published?.token === config.token &&
    published.agentScript === config.agentScript
  ) {
    Object.assign(config, published);
    clearWebAgentConfigCache();
  }
}

async function readOptionalUTF8(
  host: WebAgentInstallerHost,
  path: string,
): Promise<string | null> {
  if (!(await host.exists(path))) return null;
  try {
    return await host.readUTF8(path);
  } catch {
    return null;
  }
}

async function firstExisting(
  host: WebAgentInstallerHost,
  paths: Array<string | undefined>,
): Promise<string | undefined> {
  for (const path of unique(paths)) {
    if (await host.exists(path)) return path;
  }
  return undefined;
}

async function findSupportedNode(
  host: WebAgentInstallerHost,
  paths: Array<string | undefined>,
): Promise<{ path: string; version: string } | undefined> {
  for (const path of unique(paths)) {
    if (!(await host.exists(path))) continue;
    const raw = await host.probeNodeVersion(path);
    const version = normalizeNodeVersion(raw);
    if (version && Number(version.split(".")[0]) >= 20) {
      return { path, version };
    }
  }
  return undefined;
}

function normalizeNodeVersion(value: string | null): string | null {
  const match = /^v?(\d+\.\d+\.\d+)/.exec(value?.trim() ?? "");
  return match?.[1] ?? null;
}

async function configRuntimeExists(
  host: WebAgentInstallerHost,
  config: WebAgentConfig & { runtimeVersion?: string },
): Promise<boolean> {
  return (
    typeof config.agentScript === "string" &&
    (await host.exists(config.agentScript))
  );
}

function unique(values: Array<string | undefined>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

function validateRuntimeArchive(
  files: Record<string, Uint8Array>,
  release: WebAgentRuntimeRelease,
): Record<string, Uint8Array> {
  for (const required of [
    "agent.mjs",
    "runtime-manifest.json",
    "node_modules/playwright-core/package.json",
  ]) {
    if (!files[required]) {
      throw new Error(`Web Agent 运行包不完整：缺少 ${required}`);
    }
  }
  const manifest = JSON.parse(
    new TextDecoder().decode(files["runtime-manifest.json"]),
  ) as { protocolVersion?: unknown };
  if (
    manifest.protocolVersion !== release.protocolVersion ||
    release.protocolVersion !== WEB_AGENT_PROTOCOL_VERSION
  ) {
    throw new Error("Web Agent 运行包协议与插件不匹配");
  }
  return files;
}

async function writeRuntimeArchive(
  host: WebAgentInstallerHost,
  runtimeDir: string,
  files: Record<string, Uint8Array>,
): Promise<void> {
  for (const [archivePath, value] of Object.entries(files)) {
    const segments = archivePath.split("/").filter(Boolean);
    if (
      segments.length === 0 ||
      segments.some((segment) => segment === ".." || segment.includes("\\"))
    ) {
      throw new Error(`Web Agent 运行包包含不安全路径：${archivePath}`);
    }
    const target = nativeJoin(host.platform, runtimeDir, ...segments);
    const parent = nativeJoin(
      host.platform,
      runtimeDir,
      ...segments.slice(0, -1),
    );
    await host.makeDirectory(parent);
    await host.write(target, value);
  }
  const xdgOpen = nativeJoin(
    host.platform,
    runtimeDir,
    "node_modules",
    "playwright-core",
    "lib",
    "xdg-open",
  );
  if (host.platform === "linux" && (await host.exists(xdgOpen))) {
    await host.setPermissions(xdgOpen, 0o755).catch(() => undefined);
  }
}

export function createZoteroWebAgentInstallerHost(): WebAgentInstallerHost {
  const Z = Zotero as any;
  const services = Services as any;
  const io = IOUtils;
  const platform: WebAgentPlatform = Z.isWin
    ? "win32"
    : Z.isMac
      ? "darwin"
      : Z.isLinux
        ? "linux"
        : unsupportedPlatform();
  const homeDir = directoryPath(
    services.dirsvc?.get?.("Home", (Ci as any).nsIFile),
  );
  const dataDir = directoryPath(Z.DataDirectory?.dir ?? Z.DataDirectory?.path);
  const profileDir = directoryPath(
    Z.Profile?.dir ?? (globalThis as any).PathUtils?.profileDir,
  );
  if (!homeDir || !dataDir || !profileDir) {
    throw new Error("无法定位 Web Agent 所需的用户目录");
  }
  const processEnvironment = (Cc as any)[
    "@mozilla.org/process/environment;1"
  ].getService((Ci as any).nsIEnvironment);
  const env = Object.fromEntries(
    ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)", "PATH"].map(
      (name) => [name, processEnvironment.get(name) || undefined],
    ),
  );

  const health = readWebAgentHealth;
  const delay = (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

  return {
    platform,
    homeDir,
    dataDir,
    profileDir,
    env,
    exists: (path) => io.exists(path),
    read: (path) => io.read(path),
    readUTF8: (path) => io.readUTF8(path),
    probeNodeVersion: async (nodePath) => {
      const probeDir = nativeJoin(platform, profileDir, "zai-web-agent");
      const probePath = nativeJoin(
        platform,
        probeDir,
        `node-version-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
      );
      try {
        await io.makeDirectory(probeDir, {
          createAncestors: true,
          ignoreExisting: true,
        });
        const ok = await Z.Utilities.Internal.exec(nodePath, [
          "-e",
          'require("node:fs").writeFileSync(process.argv[1], process.version)',
          probePath,
        ]);
        if (ok !== true || !(await io.exists(probePath))) return null;
        return await io.readUTF8(probePath);
      } catch {
        return null;
      } finally {
        await io
          .remove(probePath, { ignoreAbsent: true })
          .catch(() => undefined);
      }
    },
    health,
    fetchRuntimeArchive: async (url) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      } finally {
        clearTimeout(timeout);
      }
    },
    sha256: async (value) => {
      const bytes = value.buffer.slice(
        value.byteOffset,
        value.byteOffset + value.byteLength,
      ) as ArrayBuffer;
      const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    },
    makeDirectory: (path) =>
      io.makeDirectory(path, {
        createAncestors: true,
        ignoreExisting: true,
      }),
    remove: (path) => io.remove(path, { ignoreAbsent: true }),
    write: async (path, value) => {
      await io.write(path, value, { mode: "overwrite" });
    },
    writeUTF8: async (path, value) => {
      await io.writeUTF8(path, value, { mode: "overwrite" });
    },
    setPermissions: (path, permissions) => io.setPermissions(path, permissions),
    randomToken: () => secureRandomToken(),
    stop: async (config) => {
      try {
        if (!(await stopWebAgent(config))) return false;
        for (let attempt = 0; attempt < 20; attempt += 1) {
          await delay(100);
          if (!(await health(config))) return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    start: async (config) => {
      try {
        await startWebAgent(config);
        return true;
      } catch (error) {
        Z.debug(`[Zotero AI Sidebar] Web Agent start failed: ${String(error)}`);
        return false;
      }
    },
    delay,
  };
}

export function webAgentRuntimeRelease(): WebAgentRuntimeRelease {
  return {
    protocolVersion: __webAgentRuntimeProtocolVersion__,
    assetName: __webAgentRuntimeAssetName__,
    downloadUrl: __webAgentRuntimeDownloadUrl__,
    releaseUrl: __webAgentRuntimeReleaseUrl__,
    sha256: __webAgentRuntimeSha256__,
    size: __webAgentRuntimeSize__,
  };
}

function directoryPath(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { path?: unknown }).path === "string"
  ) {
    return (value as { path: string }).path;
  }
  return "";
}

function secureRandomToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function unsupportedPlatform(): never {
  throw new Error("Web Agent 目前仅支持 Windows、Linux 和 macOS");
}
