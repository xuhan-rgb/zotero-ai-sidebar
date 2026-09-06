import type { WebPromptProvider } from "./web-prompt-hub";
import type {
  ChatGPTWebSettings,
  CustomWebProvider,
} from "../settings/local-ui-settings";

export interface WebAgentAttachment {
  kind: "latex" | "pdf" | "text";
  path: string;
  name: string;
  mimeType: "text/plain" | "application/pdf";
}

export interface WebAgentConfig {
  runtimeSha256?: string;
  checkedXpiVersion?: string;
  needsRuntimeUpdate?: boolean;
  runtimeVersion?: string;
  instanceId?: string;
  token: string;
  nodePath: string;
  chromePath: string;
  agentScript: string;
  profileDir: string;
  cdpPort?: number;
  port: number;
  callbackUrl: string;
}

export function clearWebAgentConfigCache(): void {
  cachedConfig = null;
}

export interface WebAccountStatus {
  ok: boolean;
  provider: WebPromptProvider;
  browserOpen: boolean;
  configured: boolean;
  // Z.ai may be ready for text chat without an authenticated account.
  guest?: boolean;
  // Z.ai login runs in ordinary Chrome until the user closes that window.
  manualLogin?: boolean;
  verificationRequired?: boolean;
  url?: string;
  error?: string;
}

let cachedConfig: WebAgentConfig | null = null;
let startingAgent: Promise<WebAgentConfig> | undefined;
let shuttingDown = false;
export const WEB_AGENT_PROTOCOL_VERSION = 24;

export interface WebAgentHealth {
  ok: boolean;
  protocolVersion?: number;
  runtimeVersion?: string;
  runtimeSha256?: string;
  version?: string;
  service?: string;
  instanceId?: string;
}

type WebAgentProtocolStatus = "current" | "stale" | "offline";

export function webAgentProtocolStatus(value: unknown): WebAgentProtocolStatus {
  if (!value || typeof value !== "object") return "offline";
  const health = value as { ok?: unknown; protocolVersion?: unknown };
  if (health.ok !== true) return "offline";
  return health.protocolVersion === WEB_AGENT_PROTOCOL_VERSION
    ? "current"
    : "stale";
}

export async function dispatchWebAgentTask(input: {
  id: string;
  provider: WebPromptProvider;
  prompt: string;
  continuationPrompt: string;
  sessionKey: string;
  paperUrl: string;
  hideBrowser: boolean;
  chatgptOptions?: ChatGPTWebSettings;
  customProvider?: CustomWebProvider;
  attachment?: WebAgentAttachment;
  contextAttachment?: WebAgentAttachment;
  tocAttachment?: WebAgentAttachment;
}): Promise<void> {
  const config = await loadWebAgentConfig();
  const health = await webAgentHealth(config);
  if (health === "stale") throw staleWebAgentError();
  if (health === "offline") {
    await startWebAgent(config);
  }
  const account = await getWebAccountStatus(
    input.provider,
    config,
    input.customProvider,
  );
  if (!account.configured) {
    throw new Error(
      account.verificationRequired
        ? `${input.customProvider?.name || webProviderName(input.provider)} 网站要求访问验证，请在专用 Chrome 中手动完成验证`
        : input.customProvider
          ? `${input.customProvider.name} 未检测到可用输入框，请先打开该网址并完成登录`
          : `${webProviderName(input.provider)} 网页账号未配置，请先点击账号配置按钮并手动登录`,
    );
  }
  if (
    input.provider === "zai" && account.guest &&
    (input.attachment || input.contextAttachment || input.tocAttachment)
  ) {
    throw new Error(
      "Z.ai 游客可进行文字聊天，上传附件需要登录；请点击账号完成登录后重试",
    );
  }
  const response = await fetch(`http://127.0.0.1:${config.port}/tasks`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`Web Agent 拒绝任务（HTTP ${response.status}）`);
  }
}

export async function cancelWebAgentTask(id: string): Promise<void> {
  const config = await loadWebAgentConfig();
  const health = await webAgentHealth(config);
  if (health === "offline") return;
  if (health === "stale") throw staleWebAgentError();
  const response = await fetch(`http://127.0.0.1:${config.port}/tasks/cancel`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ id }),
  });
  if (!response.ok) {
    throw new Error(`Web Agent 无法取消任务（HTTP ${response.status}）`);
  }
}

export async function openWebAccount(
  provider: WebPromptProvider,
  customProvider?: CustomWebProvider,
): Promise<WebAccountStatus> {
  const config = await loadWebAgentConfig();
  const health = await webAgentHealth(config);
  if (health === "stale") throw staleWebAgentError();
  if (health === "offline") await startWebAgent(config);
  const response = await fetch(`http://127.0.0.1:${config.port}/browser/open`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      provider,
      customProvider,
      ...(provider === "zai" ? { manualLogin: true } : {}),
    }),
  });
  const result = (await response
    .json()
    .catch(() => ({}))) as WebAccountStatus & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(result.error || `无法打开 ${provider} 专用浏览器`);
  }
  return result;
}

export async function hideWebAccount(
  provider: WebPromptProvider,
  customProvider?: CustomWebProvider,
): Promise<WebAccountStatus> {
  const config = await loadWebAgentConfig();
  const health = await webAgentHealth(config);
  if (health === "stale") throw staleWebAgentError();
  if (health === "offline") {
    return {
      ok: true,
      provider,
      browserOpen: false,
      configured: false,
    };
  }
  const response = await fetch(`http://127.0.0.1:${config.port}/browser/hide`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ provider, customProvider }),
  });
  const result = (await response
    .json()
    .catch(() => ({}))) as WebAccountStatus & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(result.error || `无法隐藏 ${provider} 专用浏览器`);
  }
  return result;
}

export async function getWebAccountStatus(
  provider: WebPromptProvider,
  loadedConfig?: WebAgentConfig,
  customProvider?: CustomWebProvider,
): Promise<WebAccountStatus> {
  const config = loadedConfig ?? (await loadWebAgentConfig());
  const health = await webAgentHealth(config);
  if (health === "stale") throw staleWebAgentError();
  if (health === "offline") {
    return {
      ok: true,
      provider,
      browserOpen: false,
      configured: false,
    };
  }
  const query = new URLSearchParams({ provider });
  if (customProvider) {
    query.set("customProvider", JSON.stringify(customProvider));
  }
  const response = await fetch(
    `http://127.0.0.1:${config.port}/browser/status?${query.toString()}`,
    { headers: { authorization: `Bearer ${config.token}` } },
  );
  const result = (await response.json().catch(() => ({}))) as WebAccountStatus;
  if (!response.ok) {
    throw new Error(result.error || `无法读取 ${provider} 账号状态`);
  }
  return result;
}

export async function loadWebAgentConfig(
  refresh = false,
): Promise<WebAgentConfig> {
  if (cachedConfig && !refresh) return cachedConfig;
  const path = webAgentConfigPath();
  const raw = await ioUtils().readUTF8(path);
  const value = JSON.parse(raw) as Partial<WebAgentConfig>;
  if (
    !value.token ||
    !value.nodePath ||
    !value.chromePath ||
    !value.agentScript ||
    !value.profileDir ||
    !Number.isInteger(value.port) ||
    value.port! < 0 ||
    value.port! > 65535 ||
    !value.callbackUrl
  ) {
    throw new Error("Web Agent 配置不完整，请先运行安装脚本");
  }
  cachedConfig = value as WebAgentConfig;
  return cachedConfig;
}

export async function webAgentAuthorizationMatches(
  authorization: unknown,
): Promise<boolean> {
  if (typeof authorization !== "string") return false;
  try {
    const config = await loadWebAgentConfig();
    return authorization === `Bearer ${config.token}`;
  } catch {
    return false;
  }
}

export async function startWebAgent(config: WebAgentConfig): Promise<void> {
  if (shuttingDown) throw new Error("Zotero AI Sidebar 正在关闭");
  if (config.needsRuntimeUpdate !== false) throw staleWebAgentError();
  startingAgent ??= launchWebAgent(config).finally(() => {
    startingAgent = undefined;
  });
  Object.assign(config, await startingAgent);
}

async function launchWebAgent(config: WebAgentConfig): Promise<WebAgentConfig> {
  // Another caller or a manually started Agent may already have published its port.
  const saved = await loadWebAgentConfig(true);
  if ((await webAgentHealth(saved)) === "current") return saved;
  const exec = (Zotero as any)?.Utilities?.Internal?.exec;
  if (typeof exec !== "function") {
    throw new Error("当前 Zotero 无法启动 Web Agent");
  }
  const instanceId = globalThis.crypto.randomUUID();
  let startError: unknown;
  void exec(config.nodePath, [
    config.agentScript,
    webAgentConfigPath(),
    instanceId,
  ])
    .then((ok: boolean) => {
      if (!ok) startError = new Error("Web Agent 进程启动失败");
    })
    .catch((error: unknown) => {
      startError = error;
    });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await delay(250);
    if (startError) throw startError;
    const published = await loadWebAgentConfig(true);
    if (
      (published.instanceId === instanceId || !published.instanceId) &&
      (await webAgentHealth(published)) === "current"
    )
      return published;
  }
  throw new Error(
    "Web Agent 启动超时，请检查本地日志；旧运行包遇到端口冲突时请升级 Web Agent",
  );
}

async function webAgentHealth(
  config: WebAgentConfig,
): Promise<WebAgentProtocolStatus> {
  if (config.needsRuntimeUpdate !== false) return "stale";
  return webAgentProtocolStatus(await readWebAgentHealth(config));
}

export async function readWebAgentHealth(
  config: WebAgentConfig,
): Promise<WebAgentHealth | null> {
  if (!config.port) return null;
  try {
    const response = await webAgentControlRequest(config, "/health", {
      headers: { authorization: `Bearer ${config.token}` },
    });
    if (!response.ok) return null;
    const health = response.body as WebAgentHealth;
    if (
      !health ||
      health.ok !== true ||
      !Number.isInteger(health.protocolVersion)
    )
      return null;
    if (config.instanceId) {
      return health.service === "zotero-ai-sidebar-web-agent" &&
        health.instanceId === config.instanceId
        ? health
        : null;
    }
    // Legacy Agents do not publish an instance ID. Recognize their health schema.
    return health.version === "0.1.0" &&
      (typeof health.runtimeVersion === "string" ||
        health.runtimeVersion === null)
      ? health
      : null;
  } catch {
    return null;
  }
}

export async function stopWebAgent(config: WebAgentConfig): Promise<boolean> {
  if (!(await readWebAgentHealth(config))) return false;
  try {
    if (!config.instanceId) {
      // Legacy health has no instance ID; confirm that it enforces our token.
      const unauthenticated = await webAgentControlRequest(
        config,
        "/health",
        {},
      );
      if (unauthenticated.status !== 401) return false;
    }
    const response = await webAgentControlRequest(config, "/shutdown", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        ...(config.instanceId
          ? { "x-zai-instance-id": config.instanceId }
          : {}),
      },
    });
    return response.status === 202;
  } catch {
    return false;
  }
}

export async function shutdownWebAgent(): Promise<void> {
  shuttingDown = true;
  try {
    await startingAgent;
    await stopWebAgent(await loadWebAgentConfig(true));
  } catch {
    // No installed or running Agent needs cleanup.
  }
}

async function webAgentControlRequest(
  config: WebAgentConfig,
  path: string,
  options: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}${path}`, {
      ...options,
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.json().catch(() => null),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function staleWebAgentError(): Error {
  return new Error(
    "Web Agent 运行包与当前插件不匹配，请在账号配置中安装当前插件的配套运行包。",
  );
}

function webAgentConfigPath(): string {
  const Z = Zotero as any;
  const root = Z.DataDirectory?.dir ?? Z.DataDirectory?.path ?? Z.Profile?.dir;
  if (!root) throw new Error("无法定位 Zotero 数据目录");
  return appendPath(root, "zai-web-agent-config.json", Z.isWin === true);
}

function appendPath(root: string, name: string, windows: boolean): string {
  const normalizedRoot = windows ? root.replace(/\//g, "\\") : root;
  const separator = windows ? "\\" : "/";
  return `${normalizedRoot.replace(/[\\/]+$/, "")}${separator}${name}`;
}

function ioUtils(): { readUTF8(path: string): Promise<string> } {
  const io = (globalThis as any).IOUtils;
  if (!io?.readUTF8) throw new Error("当前 Zotero 不支持读取 Web Agent 配置");
  return io;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function webProviderName(provider: WebPromptProvider): string {
  if (provider === "chatgpt") return "ChatGPT";
  if (provider === "deepseek") return "DeepSeek";
  if (provider === "chatglm") return "ChatGLM";
  if (provider === "zai") return "Z.ai";
  if (provider === "kimi") return "Kimi";
  return provider.slice("custom:".length) || "自定义网页";
}
