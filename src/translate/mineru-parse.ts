import { loadMineruSettings } from "../settings/mineru";
import { zoteroPrefs } from "../settings/storage";
import { parsePdfWithMineru } from "./mineru-client";
import { buildMineruTranslationDocument, pdfTranslationDocumentId } from "./mineru-document";
import { resolveItemPdfForMineru } from "./mineru-session";
import {
  loadMineruCache,
  readPdfBytes,
  readPdfStat,
  saveMineruCache,
} from "./mineru-store";

export type MineruParseState =
  | { status: "ready" }
  | { status: "parsing"; message: string }
  | { status: "error"; message: string }
  | { status: "no-token" }
  | { status: "no-pdf" };

type Listener = (itemKey: string, state: MineruParseState) => void;

const listeners = new Set<Listener>();
const states = new Map<string, MineruParseState>();
const inflight = new Map<string, Promise<MineruParseState>>();

export function mineruParseState(itemKey: string): MineruParseState | undefined {
  return states.get(itemKey);
}

export function watchMineruParse(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetMineruParseCache(): void {
  states.clear();
  inflight.clear();
}

export async function ensureMineruParse(
  itemID: number,
): Promise<MineruParseState> {
  const pdf = await resolveItemPdfForMineru(itemID);
  if (!pdf) return publish("", { status: "no-pdf" });
  const existing = inflight.get(pdf.itemKey);
  if (existing) return existing;
  const pending = runParse({
    itemKey: pdf.itemKey,
    pdfPath: pdf.path,
    fileName: pdf.name,
  });
  inflight.set(pdf.itemKey, pending);
  try {
    return await pending;
  } finally {
    if (inflight.get(pdf.itemKey) === pending) inflight.delete(pdf.itemKey);
  }
}

async function runParse(pdf: {
  itemKey: string;
  pdfPath: string;
  fileName: string;
}): Promise<MineruParseState> {
  const token = loadMineruSettings(zoteroPrefs()).token;
  if (!token) return publish(pdf.itemKey, { status: "no-token" });
  publish(pdf.itemKey, { status: "parsing", message: "正在检查 PDF 解析缓存…" });
  try {
    const stat = await readPdfStat(pdf.pdfPath);
    const cached = await loadMineruCache(pdf.itemKey, stat.size, stat.mtime);
    if (cached) return publish(pdf.itemKey, { status: "ready" });
    publish(pdf.itemKey, { status: "parsing", message: "正在用 MinerU 解析 PDF…" });
    const bytes = await readPdfBytes(pdf.pdfPath);
    const parsed = await parsePdfWithMineru(
      { name: pdf.fileName, bytes, dataId: pdf.itemKey },
      {
        token,
        onProgress: (progress) => {
          publish(pdf.itemKey, {
            status: "parsing",
            message: progressLabel(
              progress.state,
              progress.extractedPages,
              progress.totalPages,
            ),
          });
        },
      },
    );
    const document = buildMineruTranslationDocument(
      pdfTranslationDocumentId(pdf.itemKey),
      parsed.markdown,
      parsed.contentList,
    );
    await saveMineruCache(pdf.itemKey, stat, parsed, document.sourceHash);
    return publish(pdf.itemKey, { status: "ready" });
  } catch (error) {
    return publish(pdf.itemKey, {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function publish(itemKey: string, state: MineruParseState): MineruParseState {
  if (itemKey) states.set(itemKey, state);
  for (const listener of listeners) listener(itemKey, state);
  return state;
}

function progressLabel(
  state: string,
  extracted?: number,
  total?: number,
): string {
  if (state === "waiting-file") return "正在上传 PDF…";
  if (state === "pending") return "MinerU 排队中…";
  if (state === "converting") return "MinerU 正在转换格式…";
  if (state === "running") {
    return total
      ? `MinerU 解析中（${extracted ?? 0}/${total} 页）…`
      : "MinerU 正在解析 PDF…";
  }
  if (state === "done") return "正在读取解析结果…";
  return "正在用 MinerU 解析 PDF…";
}
