import { extractMineruZip } from "./mineru-zip";

export const MINERU_API_BASE = "https://mineru.net/api/v4";

export interface MineruParseProgress {
  state: string;
  extractedPages?: number;
  totalPages?: number;
}

export interface MineruParseResult {
  markdown: string;
  contentList: unknown | null;
  batchId: string;
}

export interface MineruClientOptions {
  token: string;
  fetch?: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export async function probeMineruToken(
  options: MineruClientOptions,
): Promise<void> {
  const response = await requestJson(
    options,
    "POST",
    "/file-urls/batch",
    {
      files: [{ name: "connection-test.pdf", data_id: "connection-test" }],
      model_version: "vlm",
    },
  );
  if (response.code !== 0) {
    throw new Error(mineruErrorMessage(response));
  }
}

export async function parsePdfWithMineru(
  file: { name: string; bytes: Uint8Array; dataId?: string },
  options: MineruClientOptions & {
    language?: string;
    signal?: AbortSignal;
    onProgress?: (progress: MineruParseProgress) => void;
  },
): Promise<MineruParseResult> {
  const created = await requestJson(options, "POST", "/file-urls/batch", {
    files: [
      {
        name: file.name,
        data_id: file.dataId ?? file.name.replace(/\.[^.]+$/, ""),
        is_ocr: false,
      },
    ],
    model_version: "vlm",
    enable_formula: true,
    enable_table: true,
    language: options.language ?? "en",
  });
  if (created.code !== 0) throw new Error(mineruErrorMessage(created));
  const batchId = stringField(created.data, "batch_id");
  const uploadUrl = Array.isArray(created.data?.file_urls)
    ? String(created.data.file_urls[0] ?? "")
    : "";
  if (!batchId || !uploadUrl) {
    throw new Error("MinerU 未返回上传地址");
  }
  const put = await (options.fetch ?? fetch)(uploadUrl, {
    method: "PUT",
    body: new Blob([file.bytes]),
    signal: options.signal,
  });
  if (!put.ok) {
    throw new Error(`MinerU 文件上传失败（HTTP ${put.status}）`);
  }
  const deadline = (options.now ?? Date.now)() + (options.timeoutMs ?? 10 * 60_000);
  const interval = options.pollIntervalMs ?? 3000;
  const wait = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  while ((options.now ?? Date.now)() < deadline) {
    if (options.signal?.aborted) throw new Error("MinerU 解析已取消");
    const polled = await requestJson(
      options,
      "GET",
      `/extract-results/batch/${batchId}`,
    );
    if (polled.code !== 0) throw new Error(mineruErrorMessage(polled));
    const result = firstExtractResult(polled.data);
    const state = stringField(result, "state") || "pending";
    const progress = isRecord(result.extract_progress)
      ? result.extract_progress
      : {};
    options.onProgress?.({
      state,
      extractedPages: numberField(progress, "extracted_pages"),
      totalPages: numberField(progress, "total_pages"),
    });
    if (state === "failed") {
      throw new Error(stringField(result, "err_msg") || "MinerU 解析失败");
    }
    if (state === "done") {
      const zipUrl = stringField(result, "full_zip_url");
      if (!zipUrl) throw new Error("MinerU 未返回结果包");
      const zip = await (options.fetch ?? fetch)(zipUrl, { signal: options.signal });
      if (!zip.ok) throw new Error(`下载 MinerU 结果失败（HTTP ${zip.status}）`);
      const bytes = new Uint8Array(await zip.arrayBuffer());
      const extracted = await extractMineruZip(bytes);
      return { ...extracted, batchId };
    }
    await wait(interval);
  }
  throw new Error("MinerU 解析超时，请稍后重试");
}

interface MineruResponse {
  code: number;
  msg?: string;
  data?: Record<string, unknown>;
}

async function requestJson(
  options: MineruClientOptions,
  method: string,
  path: string,
  body?: unknown,
): Promise<MineruResponse> {
  const response = await (options.fetch ?? fetch)(`${MINERU_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: "*/*",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new Error(`MinerU 接口返回了无法解析的响应（HTTP ${response.status}）`);
  }
  if (!isRecord(parsed)) throw new Error("MinerU 接口响应无效");
  const code = typeof parsed.code === "number" ? parsed.code : -1;
  return {
    code,
    msg: typeof parsed.msg === "string" ? parsed.msg : undefined,
    data: isRecord(parsed.data) ? parsed.data : {},
  };
}

function mineruErrorMessage(response: MineruResponse): string {
  if (response.msg === "A0202" || /A0202/.test(response.msg ?? "")) {
    return "MinerU Token 无效，请到 mineru.net/apiManage 重新创建";
  }
  if (response.msg === "A0211") {
    return "MinerU Token 已过期，请重新创建";
  }
  return response.msg || `MinerU 接口错误（${response.code}）`;
}

function firstExtractResult(
  data: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const list = data?.extract_result;
  if (Array.isArray(list) && isRecord(list[0])) return list[0];
  return {};
}

function stringField(value: unknown, key: string): string {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : "";
}

function numberField(value: unknown, key: string): number | undefined {
  return isRecord(value) && typeof value[key] === "number" ? value[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
