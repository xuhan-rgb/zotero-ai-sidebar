import type { WebPromptProvider } from "../settings/local-ui-settings";
import type { MessageImage } from "../providers/types";

export type { WebPromptProvider } from "../settings/local-ui-settings";

export interface WebPromptResult {
  answer: string;
  reasoning?: string;
  images?: MessageImage[];
  revision?: number;
}

export interface WebPromptTaskInput {
  provider: WebPromptProvider;
  prompt: string;
  sourceLabel: string;
  onImport(result: WebPromptResult): Promise<void> | void;
  onProgress?(result: WebPromptResult): Promise<void> | void;
  onStatus?(status: WebPromptTaskStatus, error?: string): Promise<void> | void;
}

export type WebPromptTaskStatus =
  | "queued"
  | "starting_browser"
  | "needs_login"
  | "uploading_attachment"
  | "submitting"
  | "generating"
  | "processing_answer"
  | "completed"
  | "failed"
  | "cancelled";

interface WebPromptTask extends WebPromptTaskInput {
  id: string;
  createdAt: number;
  importedAt?: number;
  lastRevision: number;
  lastResult?: WebPromptResult;
}

const ENDPOINT = "/zai/web-prompt-hub";
const tasks = new Map<string, WebPromptTask>();

export function registerWebPromptHub(): void {
  Zotero.Server.Endpoints[ENDPOINT] = WebPromptHubEndpoint;
}

function WebPromptHubEndpoint(): void {}

(WebPromptHubEndpoint as any).prototype = {
  supportedMethods: ["GET", "POST"],
  supportedDataTypes: ["application/json", "text/plain"],
  permitBookmarklet: true,
  allowRequestsFromUnsafeWebContent: true,

  async init(options: {
    method: "GET" | "POST";
    searchParams: URLSearchParams;
    headers: Record<string, unknown>;
    data: unknown;
  }): Promise<[number, string, string]> {
    if (options.method === "GET") {
      const task = tasks.get(options.searchParams.get("id") ?? "");
      return task
        ? [200, "text/html; charset=utf-8", renderHubPage(task)]
        : [404, "text/plain; charset=utf-8", "Web Prompt task not found."];
    }

    const data = isRecord(options.data) ? options.data : {};
    if (typeof data.state === "string") {
      return handleWebAgentCallback(options.headers, data);
    }
    const id = typeof data.id === "string" ? data.id : "";
    const answer = typeof data.answer === "string" ? data.answer.trim() : "";
    const task = tasks.get(id);
    if (!task || !answer) {
      return [400, "application/json", JSON.stringify({ ok: false })];
    }
    await task.onImport({ answer });
    task.importedAt = Date.now();
    tasks.delete(id);
    return [200, "application/json", JSON.stringify({ ok: true })];
  },
};

export function unregisterWebPromptHub(): void {
  delete Zotero.Server.Endpoints[ENDPOINT];
  tasks.clear();
}

export function createWebPromptTask(input: WebPromptTaskInput): {
  id: string;
  url: string;
} {
  const id = `${Date.now()}-${Zotero.Utilities.randomString(12)}`;
  tasks.set(id, { ...input, id, createdAt: Date.now(), lastRevision: 0 });
  return {
    id,
    url: `http://127.0.0.1:23119${ENDPOINT}?id=${encodeURIComponent(id)}`,
  };
}

function renderHubPage(task: WebPromptTask): string {
  const data = JSON.stringify({
    id: task.id,
    provider: task.provider,
    prompt: task.prompt,
    sourceLabel: task.sourceLabel,
    imported: task.importedAt != null,
  }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Web Prompt Hub</title><style>
:root{font-family:system-ui,sans-serif;color:#24211d;background:#fbfaf7}*{box-sizing:border-box}body{margin:0}.shell{max-width:920px;margin:auto;padding:24px}.head{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}.badge{padding:5px 9px;border:1px solid #d8c9b6;border-radius:7px;background:#fff}.panel{border:1px solid #e1d7c9;border-radius:8px;background:#fff;padding:18px;margin-bottom:14px}h1{font-size:21px;margin:0}h2{font-size:15px;margin:0 0 10px}.prompt{max-height:42vh;overflow:auto;white-space:pre-wrap;font:12px/1.65 ui-monospace,monospace;background:#f7f4ef;padding:13px;border-radius:6px}textarea{width:100%;min-height:180px;border:1px solid #d8c9b6;border-radius:6px;padding:12px;font:13px/1.55 system-ui,sans-serif;resize:vertical}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}button{border:1px solid #d8c9b6;border-radius:7px;background:#fff;padding:8px 12px;cursor:pointer}button.primary{border-color:#a94e25;background:#a94e25;color:#fff}button.import{border-color:#2f7d51;background:#2f7d51;color:#fff}.status{color:#746b60;font-size:12px}
</style></head><body><main class="shell"><header class="head"><div><h1>Web Prompt Hub</h1><div class="status" id="source"></div></div><span class="badge" id="provider"></span></header>
<section class="panel"><h2>确认 Prompt</h2><div class="prompt" id="prompt"></div><div class="actions"><button class="primary" id="copyOpen">复制并打开网页</button><button id="copy">仅复制</button></div></section>
<section class="panel"><h2>导入网页回答</h2><textarea id="answer" placeholder="从 ChatGPT 或 DeepSeek 网页复制完整回答后粘贴到这里"></textarea><div class="actions"><button id="paste">从剪贴板粘贴</button><button class="import" id="import">导回 Zotero</button><span class="status" id="status"></span></div></section></main>
<script>const task=${data};const names={chatgpt:"ChatGPT Web",deepseek:"DeepSeek Web"};const urls={chatgpt:"https://chatgpt.com/",deepseek:"https://chat.deepseek.com/"};const provider=document.getElementById("provider"),source=document.getElementById("source"),prompt=document.getElementById("prompt"),answer=document.getElementById("answer"),status=document.getElementById("status"),copy=document.getElementById("copy"),copyOpen=document.getElementById("copyOpen"),paste=document.getElementById("paste"),importButton=document.getElementById("import");
provider.textContent=names[task.provider];source.textContent=task.sourceLabel;prompt.textContent=task.prompt;
async function copyPrompt(){await navigator.clipboard.writeText(task.prompt)}
copy.onclick=async()=>{await copyPrompt();status.textContent="Prompt 已复制"};copyOpen.onclick=async()=>{window.open(urls[task.provider],"_blank","noopener");await copyPrompt();status.textContent="已复制并打开网页"};
paste.onclick=async()=>{answer.value=await navigator.clipboard.readText()};
importButton.onclick=async()=>{const text=answer.value.trim();if(!text){status.textContent="请先粘贴回答";return}importButton.disabled=true;const response=await fetch(location.pathname,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:task.id,answer:text})});status.textContent=response.ok?"已导回 Zotero":"导入失败";importButton.disabled=false};
</script></body></html>`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function webPromptTaskStatus(value: unknown): WebPromptTaskStatus | null {
  return [
    "queued",
    "starting_browser",
    "needs_login",
    "uploading_attachment",
    "submitting",
    "generating",
    "processing_answer",
    "completed",
    "failed",
    "cancelled",
  ].includes(String(value))
    ? (value as WebPromptTaskStatus)
    : null;
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
): [number, string, string] {
  return [status, "application/json", JSON.stringify(body)];
}

async function handleWebAgentCallback(
  headers: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<[number, string, string]> {
  const { webAgentAuthorizationMatches } = await import("./web-agent-client");
  if (!(await webAgentAuthorizationMatches(headers.authorization))) {
    return jsonResponse(401, { ok: false });
  }
  const id = typeof data.id === "string" ? data.id : "";
  const status = webPromptTaskStatus(data.state);
  const task = tasks.get(id);
  if (!task || !status) return jsonResponse(404, { ok: false });
  const error = typeof data.error === "string" ? data.error : undefined;
  const progressAnswer =
    typeof data.answer === "string" ? data.answer.trim() : "";
  const progressReasoning =
    typeof data.reasoning === "string" ? data.reasoning.trim() : "";
  const requestedRevision = Number(data.revision);
  const revision =
    Number.isSafeInteger(requestedRevision) && requestedRevision > 0
      ? requestedRevision
      : task.lastRevision + 1;
  const isNewSnapshot = revision > task.lastRevision;
  const incoming: WebPromptResult = {
    answer: progressAnswer,
    ...(progressReasoning ? { reasoning: progressReasoning } : {}),
    ...(Array.isArray(data.images) ? { images: data.images as MessageImage[] } : {}),
    revision,
  };
  if (isNewSnapshot && (progressAnswer || progressReasoning || incoming.images)) {
    task.lastRevision = revision;
    task.lastResult = {
      answer: progressAnswer || task.lastResult?.answer || "",
      reasoning: progressReasoning || task.lastResult?.reasoning,
      images: incoming.images || task.lastResult?.images,
      revision,
    };
  }
  const result = task.lastResult || incoming;
  if (
    status === "generating" &&
    isNewSnapshot &&
    (progressAnswer || progressReasoning || incoming.images)
  ) {
    await task.onProgress?.(result);
  } else if (status === "generating" && !isNewSnapshot) {
    return jsonResponse(200, { ok: true, ignored: true });
  } else if (status !== "completed") {
    await task.onStatus?.(status, error);
  }
  if (status === "completed") {
    const answer = result.answer.trim();
    if (!answer) {
      await task.onStatus?.("failed", "网页回答为空");
      tasks.delete(id);
      return jsonResponse(400, { ok: false });
    }
    await task.onImport(result);
    task.importedAt = Date.now();
    tasks.delete(id);
  }
  return jsonResponse(200, { ok: true });
}
