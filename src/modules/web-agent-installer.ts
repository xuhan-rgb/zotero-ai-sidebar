import { version as ADDON_VERSION } from "../../package.json";
import { unzipSync } from "fflate";
import { uiText } from "../utils/ui-locale";
import {
  clearWebAgentConfigCache,
  readWebAgentHealth,
  startWebAgent,
  stopWebAgent,
  WEB_AGENT_PROTOCOL_VERSION,
  type WebAgentConfig,
} from "./web-agent-client";

export type WebAgentBrowser = "chrome" | "edge" | "firefox";

export function webAgentBrowserCandidates(
  input: WebAgentExecutableCandidatesInput,
  browser: WebAgentBrowser,
): string[] {
  if (browser === "chrome") return webAgentExecutableCandidates(input).chrome;
  const dirs = (input.env.PATH ?? "")
    .split(input.platform === "win32" ? ";" : ":")
    .filter(Boolean);
  if (browser === "firefox") {
    if (input.platform === "win32")
      return unique([
        ...dirs.map((dir) => winJoin(dir, "firefox.exe")),
        ...[input.env.ProgramFiles, input.env["ProgramFiles(x86)"], input.env.LOCALAPPDATA]
          .filter((dir): dir is string => !!dir)
          .map((dir) => winJoin(dir, "Mozilla Firefox", "firefox.exe")),
      ]);
    if (input.platform === "darwin")
      return unique([
        "/Applications/Firefox.app/Contents/MacOS/firefox",
        posixJoin(input.homeDir, "Applications", "Firefox.app", "Contents", "MacOS", "firefox"),
        ...dirs.map((dir) => posixJoin(dir, "firefox")),
      ]);
    return unique([
      posixJoin(input.homeDir, ".local", "opt", "firefox", "firefox"),
      ...dirs.flatMap((dir) => ["firefox", "firefox-esr"].map((name) => posixJoin(dir, name))),
      "/usr/bin/firefox", "/usr/bin/firefox-esr", "/opt/firefox/firefox", "/snap/bin/firefox",
    ]);
  }
  if (input.platform === "win32")
    return unique([
      ...dirs.map((dir) => winJoin(dir, "msedge.exe")),
      ...[
        input.env.ProgramFiles,
        input.env["ProgramFiles(x86)"],
        input.env.LOCALAPPDATA,
      ]
        .filter((dir): dir is string => !!dir)
        .map((dir) =>
          winJoin(dir, "Microsoft", "Edge", "Application", "msedge.exe"),
        ),
    ]);
  if (input.platform === "darwin")
    return unique([
      ...dirs.map((dir) => posixJoin(dir, "microsoft-edge")),
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      posixJoin(
        input.homeDir,
        "Applications",
        "Microsoft Edge.app",
        "Contents",
        "MacOS",
        "Microsoft Edge",
      ),
    ]);
  return unique([
    ...dirs.flatMap((dir) =>
      ["microsoft-edge", "microsoft-edge-stable"].map((name) =>
        posixJoin(dir, name),
      ),
    ),
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
    posixJoin(input.homeDir, ".local", "bin", "microsoft-edge"),
  ]);
}

function configuredBrowser(config: WebAgentConfig): string {
  return (
    config.browser ??
    (/(?:^|[\\/])firefox(?:-esr)?(?:\.exe)?$/i.test(config.chromePath) ? "firefox" : /msedge|microsoft[- ]edge/i.test(config.chromePath) ? "edge" : "chrome")
  );
}

function isFirefoxPath(path: string): boolean {
  return /(?:^|[\\/])firefox(?:-esr)?(?:\.exe)?$/i.test(path);
}

async function resolveBrowserExecutable(
  host: WebAgentInstallerHost,
  browser: string,
  paths: Array<string | undefined>,
): Promise<{ path?: string; firefoxSnap?: boolean; unsupportedReason?: string }> {
  let snapPath: string | undefined;
  for (const path of unique(paths)) {
    if (!(await host.exists(path))) continue;
    if (host.platform === "linux" && (browser === "firefox" || isFirefoxPath(path))) {
      const launcher = await readOptionalUTF8(host, path);
      if (path.startsWith("/snap/") ||
          (launcher?.startsWith("#!") && /\/snap\/bin\/firefox|\bsnap\s+(?:run\s+)?firefox\b/.test(launcher))) {
        snapPath ??= path;
        continue;
      }
    }
    return { path };
  }
  return snapPath ? { path: snapPath, firefoxSnap: true } : {};
}

function browserProfileKey(browser: string, firefoxSnap = false): string {
  return firefoxSnap ? `${browser}:snap` : browser;
}

async function snapFirefoxProfileRoot(host: WebAgentInstallerHost): Promise<string> {
  const profileHash = await host.sha256(new TextEncoder().encode(host.profileDir));
  return nativeJoin(host.platform, host.homeDir, "snap", "firefox", "common", "zotero-ai-sidebar", profileHash.slice(0, 16));
}

async function browserProfileDirectory(host: WebAgentInstallerHost, browser: string, firefoxSnap: boolean, saved?: string): Promise<string> {
  if (firefoxSnap) {
    const root = await snapFirefoxProfileRoot(host);
    return saved?.startsWith(root + "/") ? saved : nativeJoin(host.platform, root, `browser-profile-${browser}`);
  }
  return saved ?? nativeJoin(host.platform, host.profileDir, "zai-web-agent", browser === "chrome" ? "browser-profile" : `browser-profile-${browser}`);
}

async function needsLocalFirefoxProfile(host: WebAgentInstallerHost, profileDir: string): Promise<boolean> {
  const separator = host.platform === "win32" ? "\\" : "/";
  return !profileDir.startsWith(host.profileDir + separator) && !(await host.exists(profileDir));
}

interface CustomWebBrowser {
  browser: string;
  name: string;
  customPath: string;
}

async function readCustomWebBrowsers(host: WebAgentInstallerHost): Promise<CustomWebBrowser[]> {
  const text = await readOptionalUTF8(host, nativeJoin(host.platform, host.dataDir, "zai-web-custom-browsers.json"));
  if (!text) return [];
  const entries = JSON.parse(text);
  if (!Array.isArray(entries)) throw new Error(uiText("自定义浏览器配置格式错误", "Invalid custom browser configuration"));
  return entries.filter(entry => /^custom-[a-z0-9-]+$/.test(entry.browser)
    && typeof entry.name === "string" && typeof entry.customPath === "string");
}

export async function addWebAgentBrowser(
  name: string,
  path: string,
  host: WebAgentInstallerHost = createZoteroWebAgentInstallerHost(),
): Promise<void> {
  if (!name.trim()) throw new Error(uiText("请填写浏览器名称", "Enter a browser name"));
  if (!path.trim()) throw new Error(uiText("请选择浏览器可执行文件", "Select the browser executable"));
  const id = `custom-${host.randomToken().replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
  await selectWebAgentBrowser(id, host, path, name.trim());
}

export async function removeWebAgentBrowser(
  browser: string,
  host: WebAgentInstallerHost = createZoteroWebAgentInstallerHost(),
): Promise<void> {
  const entries = await readCustomWebBrowsers(host);
  if (!entries.some(entry => entry.browser === browser))
    throw new Error(uiText("只能移除已添加的自定义浏览器", "Only added custom browsers can be removed"));
  const choices = await getWebAgentBrowsers(host);
  if (choices.selected === browser) {
    const currentPath = choices.available.find(entry => entry.browser === browser)?.path;
    const alternatives = choices.available.filter(entry => entry.browser !== browser && entry.path);
    const replacement = alternatives.find(entry => entry.path === currentPath) ?? alternatives[0];
    if (!replacement)
      throw new Error(uiText("请先安装或选择其他可用浏览器，再移除此项", "Install or select another available browser before removing this entry"));
    await selectWebAgentBrowser(replacement.browser, host);
  }
  await host.writeUTF8(
    nativeJoin(host.platform, host.dataDir, "zai-web-custom-browsers.json"),
    JSON.stringify(entries.filter(entry => entry.browser !== browser), null, 2),
  );
  const preferencePath = nativeJoin(host.platform, host.dataDir, "zai-web-browser.txt");
  if ((await readOptionalUTF8(host, preferencePath))?.trim() === browser) {
    await host.writeUTF8(preferencePath, choices.selected);
  }
}

export async function getWebAgentBrowsers(
  host: WebAgentInstallerHost = createZoteroWebAgentInstallerHost(),
) {
  const config = await readConfig(
    host,
    nativeJoin(host.platform, host.dataDir, "zai-web-agent-config.json"),
  );
  const preference = await readOptionalUTF8(
    host,
    nativeJoin(host.platform, host.dataDir, "zai-web-browser.txt"),
  );
  const available: Array<CustomWebBrowser & { path?: string; firefoxSnap?: boolean; unsupportedReason?: string }> = await Promise.all(
    (["chrome", "edge", "firefox"] as const).map(async (browser) => {
      const customPath = (await readOptionalUTF8(
        host,
        nativeJoin(host.platform, host.dataDir, `zai-web-browser-${browser}-path.txt`),
      ))?.trim() ?? "";
      const preferred = await resolveBrowserExecutable(host, browser, customPath ? [customPath] :
        config && configuredBrowser(config) === browser ? [config.chromePath] : []);
      const resolved = preferred.path || (customPath && browser !== "firefox") ? preferred :
        await resolveBrowserExecutable(host, browser, webAgentBrowserCandidates(host, browser));
      return {
        browser,
        name: browser === "firefox" ? "Firefox" : browser === "edge" ? "Microsoft Edge" : "Google Chrome",
        customPath: customPath && resolved.path ? resolved.path : customPath,
        ...resolved,
      };
    }),
  );
  for (const entry of await readCustomWebBrowsers(host)) {
    const preferred = await resolveBrowserExecutable(host, entry.browser, [entry.customPath]);
    const resolved = preferred.path || !isFirefoxPath(entry.customPath) ? preferred :
      await resolveBrowserExecutable(host, "firefox", webAgentBrowserCandidates(host, "firefox"));
    available.push({ ...entry, customPath: resolved.path ?? entry.customPath, ...resolved });
  }
  const saved = config ? configuredBrowser(config) : preference?.trim();
  const selected = available.some(entry => entry.browser === saved)
    ? saved! : (available.find(entry => entry.path)?.browser ?? available.find(entry => entry.unsupportedReason)?.browser ?? "chrome");
  return { selected, available };
}

export async function detectWebAgentBrowser(
  browser: string,
  host: WebAgentInstallerHost = createZoteroWebAgentInstallerHost(),
): Promise<string> {
  if (browser !== "chrome" && browser !== "edge" && browser !== "firefox")
    throw new Error(uiText("自定义浏览器请使用“选择程序文件…”指定路径。", "For a custom browser, use Select program file… to specify its path."));
  const resolved = await resolveBrowserExecutable(host, browser, webAgentBrowserCandidates(host, browser));
  if (!resolved.path) throw new Error(resolved.unsupportedReason ?? uiText("未检测到浏览器，请使用“选择程序文件…”指定路径。", "No browser was detected. Use Select program file… to specify its path."));
  return resolved.path;
}

export async function selectWebAgentBrowser(
  browser: string,
  host: WebAgentInstallerHost = createZoteroWebAgentInstallerHost(),
  customPath?: string,
  customName?: string,
): Promise<void> {
  const choices = await getWebAgentBrowsers(host);
  const builtin = browser === "chrome" || browser === "edge" || browser === "firefox";
  const entry = choices.available.find(entry => entry.browser === browser);
  if (!entry && !(customName && /^custom-[a-z0-9-]+$/.test(browser)))
    throw new Error(uiText("浏览器配置不存在", "Browser configuration does not exist"));
  const normalizedPath = customPath?.trim().replace(/^"(.*)"$/, "$1");
  if (normalizedPath && !(await host.exists(normalizedPath)))
    throw new Error(uiText("浏览器程序路径不存在，请选择浏览器可执行文件。", "The browser executable path does not exist; select a browser executable."));
  const resolved = await resolveBrowserExecutable(host, browser, normalizedPath ? [normalizedPath] : customPath !== undefined
    ? (builtin ? webAgentBrowserCandidates(host, browser) : [])
    : [entry?.path]);
  const path = resolved.path;
  if (!path)
    throw new Error(
      resolved.unsupportedReason ?? entry?.unsupportedReason ?? uiText(`未找到 ${entry?.name ?? customName ?? browser}，请选择有效的浏览器程序路径。`, `Could not find ${entry?.name ?? customName ?? browser}; select a valid browser executable path.`),
    );
  const configPath = nativeJoin(
    host.platform,
    host.dataDir,
    "zai-web-agent-config.json",
  );
  const config = await readConfig(host, configPath);
  const profiles = config ? { ...config.browserProfiles, [browserProfileKey(configuredBrowser(config), config.firefoxSnap)]: config.profileDir } : {};
  const profileKey = browserProfileKey(browser, resolved.firefoxSnap);
  const sameFirefox = config && browser === "firefox" && isFirefoxPath(path) && config.chromePath === path && !!config.firefoxSnap === !!resolved.firefoxSnap;
  let profileDir = await browserProfileDirectory(host, browser, !!resolved.firefoxSnap, profiles[profileKey] ?? (sameFirefox ? config.profileDir : undefined));
  if (!resolved.firefoxSnap && (browser === "firefox" || isFirefoxPath(path)) && await needsLocalFirefoxProfile(host, profileDir)) {
    profileDir = nativeJoin(host.platform, host.profileDir, "zai-web-agent", `browser-profile-${browser}`);
  }
  if (config && (configuredBrowser(config) !== browser || config.chromePath !== path || config.profileDir !== profileDir || !!config.firefoxSnap !== !!resolved.firefoxSnap)) {
    const health = await host.health(config);
    if (
      Object.values(health?.active ?? {}).some(Boolean) ||
      Object.values(health?.queued ?? {}).some((count) => count > 0)
    ) {
      throw new Error(uiText("WEB 任务正在运行，请等待任务完成后再切换浏览器。", "A WEB task is running. Wait for it to finish before switching browsers."));
    }
    if (health) {
      if (!(await host.stop(config)))
        throw new Error(uiText("Web Agent 未能停止，浏览器设置未更改。", "Web Agent could not be stopped; browser settings were not changed."));
      let stopped = false;
      for (let i = 0; i < 40; i++) {
        await host.delay(250);
        if (!(await host.health(config))) {
          stopped = true;
          break;
        }
      }
      if (!stopped) throw new Error(uiText("Web Agent 尚未退出，请稍后再切换浏览器。", "Web Agent has not exited yet. Try switching browsers again later."));
    }
    await host.makeDirectory(profileDir);
    if (resolved.firefoxSnap) await host.setPermissions(profileDir, 0o700);
    const next = {
      ...config,
      browser,
      firefoxSnap: !!resolved.firefoxSnap,
      browserProfiles: { ...profiles, [profileKey]: profileDir },
      chromePath: path,
      profileDir,
      port: 0,
      cdpPort: 0,
    };
    await host.writeUTF8(configPath, `${JSON.stringify(next, null, 2)}\n`);
    await host.setPermissions(configPath, 0o600).catch(() => undefined);
    clearWebAgentConfigCache();
  }
  if (!builtin && (normalizedPath || entry?.customPath !== path)) {
    const entries = await readCustomWebBrowsers(host);
    const next = { browser, name: customName ?? entry!.name, customPath: path };
    const index = entries.findIndex(entry => entry.browser === browser);
    if (index < 0) entries.push(next); else entries[index] = next;
    await host.writeUTF8(
      nativeJoin(host.platform, host.dataDir, "zai-web-custom-browsers.json"),
      JSON.stringify(entries, null, 2),
    );
  }
  if (builtin && customPath !== undefined) {
    await host.writeUTF8(
      nativeJoin(host.platform, host.dataDir, `zai-web-browser-${browser}-path.txt`),
      normalizedPath ?? "",
    );
  }
  await host.writeUTF8(
    nativeJoin(host.platform, host.dataDir, "zai-web-browser.txt"),
    browser,
  );
}

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
  active?: Record<string, unknown>;
  queued?: Record<string, number>;
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
  listChildren?(path: string): Promise<string[]>;
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

export async function selectWebAgentNode(
  input: string,
  host: WebAgentInstallerHost = createZoteroWebAgentInstallerHost(),
): Promise<{ path: string; version: string }> {
  const raw = input.trim().replace(/^"(.*)"$/, "$1");
  const selected = /^~[\\/]/.test(raw) ? nativeJoin(host.platform, host.homeDir, raw.slice(2)) : raw;
  const absolute = host.platform === "win32" ? /^(?:[A-Za-z]:[\\/]|\\\\)/.test(selected) : selected.startsWith("/");
  if (!selected || !absolute)
    throw new Error(uiText("请输入 Node 程序或所在目录的完整路径", "Enter the absolute path to Node or its directory"));
  if (/\.sh$/i.test(selected))
    throw new Error(uiText("install.sh 等安装脚本不是 Node 程序，请选择 node、node.exe 或其所在目录", "Installation scripts such as install.sh are not Node executables. Select node, node.exe, or its directory."));
  const name = host.platform === "win32" ? "node.exe" : "node";
  const node = await findSupportedNode(host, [selected, nativeJoin(host.platform, selected, name), nativeJoin(host.platform, selected, "bin", name)]);
  if (!node)
    throw new Error(uiText("未找到可运行的 Node.js 20+，请选择 node、node.exe 或其所在目录", "No runnable Node.js 20+ was found. Select node, node.exe, or its directory."));
  const configPath = nativeJoin(host.platform, host.dataDir, "zai-web-agent-config.json");
  const config = await readConfig(host, configPath);
  if (config && config.nodePath !== node.path) {
    const health = await host.health(config);
    if (Object.values(health?.active ?? {}).some(Boolean) || Object.values(health?.queued ?? {}).some(count => count > 0))
      throw new Error(uiText("WEB 任务正在运行，请等待任务完成后再更改 Node 路径", "Wait for WEB tasks to finish before changing the Node path"));
    if (health) {
      if (!(await host.stop(config))) throw new Error(uiText("Web Agent 未能停止，Node 设置未更改", "Web Agent could not be stopped. Node settings were not changed."));
      let stopped = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        await host.delay(250);
        if (!(await host.health(config))) { stopped = true; break; }
      }
      if (!stopped) throw new Error(uiText("Web Agent 尚未退出，Node 设置未更改", "Web Agent has not exited. Node settings were not changed."));
    }
    await host.writeUTF8(configPath, `${JSON.stringify({ ...config, nodePath: node.path, port: 0 }, null, 2)}\n`);
    await host.setPermissions(configPath, 0o600).catch(() => undefined);
    clearWebAgentConfigCache();
  }
  const preferencePath = nativeJoin(host.platform, host.dataDir, "zai-web-node-path.txt");
  await host.writeUTF8(preferencePath, node.path);
  await host.setPermissions(preferencePath, 0o600).catch(() => undefined);
  return node;
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
  if (
    !config ||
    (config.checkedXpiVersion === xpiVersion &&
      config.needsRuntimeUpdate === (config.runtimeSha256 !== release.sha256))
  )
    return;
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
  let config = await readConfig(host, configPath);
  // Only explicit installation/update checks supply a release. Ordinary use
  // reads the saved result without comparing ZIP identities or hashing files.
  if (config && release)
    await recordPackageMatch(host, configPath, config, release.sha256);
  const candidates = webAgentExecutableCandidates(host);
  const savedNodePath = await readOptionalUTF8(host, nativeJoin(host.platform, host.dataDir, "zai-web-node-path.txt"));
  let node = await findSupportedNode(host, [
    savedNodePath?.trim(),
    config?.nodePath,
    ...candidates.node,
  ]);
  if (!node) node = await findSupportedNode(host, await nvmNodeCandidates(host));
  const browsers = await getWebAgentBrowsers(host);
  const selectedBrowser = browsers.available.find(
    (entry) => entry.browser === browsers.selected,
  );
  const chromePath = selectedBrowser?.path;
  const clipboardPath =
    host.platform === "linux"
      ? await firstExisting(host, candidates.clipboard)
      : undefined;
  const missing: string[] = [];
  if (!node) missing.push("Node.js 20+");
  if (!chromePath)
    missing.push(
      browsers.available.find(entry => entry.browser === browsers.selected)?.name ?? uiText("浏览器", "Browser"),
    );
  if (host.platform === "linux" && !clipboardPath) missing.push("xclip");

  if (missing.length > 0) {
    return {
      state: "blocked",
      action: config ? "upgrade" : "install",
      message: (!chromePath && browsers.available.find(entry => entry.browser === browsers.selected)?.unsupportedReason) || uiText(
        `缺少系统依赖：${missing.join("、")}`,
        `Missing system dependencies: ${missing.join(", ")}`,
      ),
      nodePath: node?.path,
      nodeVersion: node?.version,
      chromePath,
      clipboardPath,
      configPresent: Boolean(config),
      missing,
    };
  }

  if (config && node && config.nodePath !== node.path) {
    await selectWebAgentNode(node.path, host);
    config = await readConfig(host, configPath);
  }
  if (config && chromePath && (browsers.selected === "firefox" || isFirefoxPath(chromePath)) &&
      (config.chromePath !== chromePath || !!config.firefoxSnap !== !!selectedBrowser?.firefoxSnap ||
        (selectedBrowser?.firefoxSnap
          ? !config.profileDir.startsWith(await snapFirefoxProfileRoot(host) + "/")
          : await needsLocalFirefoxProfile(host, config.profileDir)))) {
    await selectWebAgentBrowser(browsers.selected, host, chromePath);
    config = await readConfig(host, configPath);
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
        message: uiText("Web Agent 已就绪", "Web Agent is ready"),
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
        ? uiText("Web Agent 运行包与当前插件不匹配，请安装配套运行包", "The Web Agent runtime does not match this add-on; install the matching runtime")
        : config
          ? uiText("Web Agent 需要检查或修复", "Web Agent needs to be checked or repaired")
          : uiText("尚未安装 Web Agent，可以在线下载并安装", "Web Agent is not installed; download and install it online"),
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
      uiText(`Web Agent 下载失败：${detail}`, `Web Agent download failed: ${detail}`),
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
      uiText(`Web Agent 运行包大小不匹配：应为 ${release.size} 字节，实际为 ${archiveBytes.byteLength} 字节`, `Web Agent runtime size mismatch: expected ${release.size} bytes, received ${archiveBytes.byteLength} bytes`),
    );
  }
  const actualSha256 = await host.sha256(archiveBytes);
  if (actualSha256.toLowerCase() !== release.sha256.toLowerCase()) {
    throw new Error(uiText("Web Agent 运行包 SHA-256 校验失败", "Web Agent runtime SHA-256 verification failed"));
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
      throw new Error(uiText("旧 Web Agent 未能停止，请关闭 WEB 任务后重试升级", "The previous Web Agent could not be stopped. Close WEB tasks and retry the upgrade."));
  }
  const browserChoices = await getWebAgentBrowsers(host);
  const browser = browserChoices.selected;
  const firefoxSnap = !!browserChoices.available.find(entry => entry.browser === browser)?.firefoxSnap;
  const profileDir = await browserProfileDirectory(host, browser, firefoxSnap, previous?.profileDir);
  const config: WebAgentConfig = {
    browser,
    firefoxSnap,
    browserProfiles: { ...previous?.browserProfiles, [browserProfileKey(browser, firefoxSnap)]: profileDir },
    runtimeSha256: release.sha256,
    checkedXpiVersion: ADDON_VERSION,
    needsRuntimeUpdate: false,
    token: previous?.token || host.randomToken(),
    nodePath: report.nodePath!,
    chromePath: report.chromePath!,
    agentScript: nativeJoin(host.platform, runtimeDir, "agent.mjs"),
    profileDir,
    cdpPort: 0,
    port: 0,
    callbackUrl:
      previous?.callbackUrl || "http://127.0.0.1:23119/zai/web-prompt-hub",
  };
  let newRuntimeStarted = false;
  try {
    await host.makeDirectory(config.profileDir);
    if (firefoxSnap) await host.setPermissions(config.profileDir, 0o700);
    await host.writeUTF8(configPath, `${JSON.stringify(config, null, 2)}\n`);
    await host.setPermissions(configPath, 0o600).catch(() => undefined);
    clearWebAgentConfigCache();

    newRuntimeStarted = await host.start(config);
    if (!newRuntimeStarted) {
      throw new Error(uiText("Web Agent 启动失败，请检查 Node.js 和浏览器路径", "Web Agent failed to start. Check the Node.js and browser paths."));
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
          message: uiText("Web Agent 配套运行包已安装并通过健康检查", "The matching Web Agent runtime is installed and passed its health check"),
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
    throw new Error(uiText("Web Agent 安装完成，但健康检查未通过", "Web Agent installed, but the health check failed"));
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

async function nvmNodeCandidates(host: WebAgentInstallerHost): Promise<string[]> {
  if (host.platform === "win32" || !host.listChildren) return [];
  const roots = unique([
    host.env.NVM_DIR,
    posixJoin(host.homeDir, ".nvm"),
    posixJoin(host.homeDir, ".config", "nvm"),
    host.env.XDG_CONFIG_HOME && posixJoin(host.env.XDG_CONFIG_HOME, "nvm"),
  ]);
  const directories: string[] = [];
  for (const root of roots) {
    try {
      directories.push(...(await host.listChildren(posixJoin(root, "versions", "node")))
        .filter(dir => /^v\d+\.\d+\.\d+$/.test(dir.split("/").at(-1) ?? "")));
    } catch {
      // A missing or unreadable NVM root must not hide other installations.
    }
  }
  return unique(directories)
    .sort((a, b) => (b.split("/").at(-1) ?? "").localeCompare(a.split("/").at(-1) ?? "", undefined, { numeric: true }))
    .map(dir => posixJoin(dir, "bin", "node"));
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
      throw new Error(uiText(`Web Agent 运行包不完整：缺少 ${required}`, `Web Agent runtime is incomplete: missing ${required}`));
    }
  }
  const manifest = JSON.parse(
    new TextDecoder().decode(files["runtime-manifest.json"]),
  ) as { protocolVersion?: unknown };
  if (
    manifest.protocolVersion !== release.protocolVersion ||
    release.protocolVersion !== WEB_AGENT_PROTOCOL_VERSION
  ) {
    throw new Error(uiText("Web Agent 运行包协议与插件不匹配", "Web Agent runtime protocol does not match the add-on"));
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
    throw new Error(uiText(`Web Agent 运行包包含不安全路径：${archivePath}`, `Web Agent runtime contains an unsafe path: ${archivePath}`));
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
    throw new Error(uiText("无法定位 Web Agent 所需的用户目录", "Could not locate the user directory required by Web Agent"));
  }
  const processEnvironment = (Cc as any)[
    "@mozilla.org/process/environment;1"
  ].getService((Ci as any).nsIEnvironment);
  const env = Object.fromEntries(
    ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)", "PATH", "NVM_DIR", "XDG_CONFIG_HOME"].map(
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
    listChildren: (path) => io.getChildren(path),
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
  throw new Error(uiText("Web Agent 目前仅支持 Windows、Linux 和 macOS", "Web Agent currently supports Windows, Linux, and macOS only"));
}
