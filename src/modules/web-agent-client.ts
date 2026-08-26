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
  runtimeVersion?: string;
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
  url?: string;
  error?: string;
}

let cachedConfig: WebAgentConfig | null = null;
export const WEB_AGENT_PROTOCOL_VERSION = 24;

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
      input.customProvider
        ? `${input.customProvider.name} 未检测到可用输入框，请先打开该网址并完成登录`
        : `${webProviderName(input.provider)} 网页账号未配置，请先点击账号配置按钮并手动登录`,
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
  const response = await fetch(
    `http://127.0.0.1:${config.port}/tasks/cancel`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ id }),
    },
  );
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
    body: JSON.stringify({ provider, customProvider }),
  });
  const result = (await response.json().catch(() => ({}))) as WebAccountStatus & {
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
  const result = (await response.json().catch(() => ({}))) as WebAccountStatus & {
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

export async function loadWebAgentConfig(): Promise<WebAgentConfig> {
  if (cachedConfig) return cachedConfig;
  const path = webAgentConfigPath();
  const raw = await ioUtils().readUTF8(path);
  const value = JSON.parse(raw) as Partial<WebAgentConfig>;
  if (
    !value.token ||
    !value.nodePath ||
    !value.chromePath ||
    !value.agentScript ||
    !value.profileDir ||
    !value.port ||
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

async function startWebAgent(config: WebAgentConfig): Promise<void> {
  const exec = (Zotero as any)?.Utilities?.Internal?.exec;
  if (typeof exec !== "function") {
    throw new Error("当前 Zotero 无法启动 Web Agent");
  }
  void exec(config.nodePath, [config.agentScript, webAgentConfigPath()]);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await delay(250);
    if ((await webAgentHealth(config)) === "current") return;
  }
  throw new Error("Web Agent 启动超时，请检查本地日志");
}

async function webAgentHealth(
  config: WebAgentConfig,
): Promise<WebAgentProtocolStatus> {
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/health`, {
      headers: { authorization: `Bearer ${config.token}` },
    });
    if (!response.ok) return "stale";
    return webAgentProtocolStatus(await response.json().catch(() => null));
  } catch {
    return "offline";
  }
}

function staleWebAgentError(): Error {
  return new Error(
    "Web Agent 版本过旧，已停止提交以避免任务卡住。请重新运行安装脚本并重启 Web Agent。",
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
  if (provider === "kimi") return "Kimi";
  return provider.slice("custom:".length) || "自定义网页";
}
