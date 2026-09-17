import {
  ensureMineruParse,
  mineruParseState,
  watchMineruParse,
  type MineruParseState,
} from "../translate/mineru-parse";
import { resolveItemPdfForMineru } from "../translate/mineru-session";

export function renderPdfParseControls(
  doc: Document,
  itemID: number,
  onTranslate: () => void,
  options?: { onConfigureToken?: () => void },
): HTMLElement {
  const root = doc.createElement("span");
  root.className = "latex-source-controls pdf-parse-controls";
  const badge = doc.createElement("span");
  badge.className = "arxiv-source-badge";
  const retry = doc.createElement("button");
  retry.type = "button";
  retry.className = "arxiv-full-translation-button";
  retry.textContent = "重试解析";
  const applyToken = doc.createElement("button");
  applyToken.type = "button";
  applyToken.className = "arxiv-full-translation-button";
  applyToken.textContent = "配置 Token";
  applyToken.hidden = true;
  applyToken.addEventListener("click", () => openTokenSettings());
  const translate = doc.createElement("button");
  translate.type = "button";
  translate.className = "arxiv-full-translation-button";
  translate.textContent = "全文翻译";
  translate.addEventListener("click", onTranslate);
  const toolbar = doc.createElement("span");
  toolbar.className = "latex-source-toolbar";
  toolbar.append(badge, retry, applyToken, translate);
  root.append(toolbar);

  let itemKey = "";
  let generation = 0;
  let current: MineruParseState | undefined;
  const openTokenSettings = () => options?.onConfigureToken?.();
  badge.addEventListener("click", () => {
    if (current?.status === "no-token") openTokenSettings();
  });
  const apply = (state: MineruParseState | undefined) => {
    current = state;
    retry.hidden = true;
    applyToken.hidden = true;
    translate.hidden = true;
    badge.style.cursor = "";
    if (!state || state.status === "parsing") {
      badge.textContent = state?.message || "正在解析 PDF…";
      badge.title = "打开 PDF 后先完成 MinerU 解析，再显示全文翻译";
      return;
    }
    if (state.status === "ready") {
      badge.textContent = "PDF 已解析";
      badge.title = "MinerU 解析完成，可以全文翻译";
      translate.hidden = false;
      return;
    }
    if (state.status === "no-token") {
      badge.textContent = "未配置 MinerU Token";
      badge.removeAttribute("title");
      applyToken.hidden = !options?.onConfigureToken;
      if (options?.onConfigureToken) badge.style.cursor = "pointer";
      return;
    }
    if (state.status === "no-pdf") {
      badge.textContent = "无 PDF";
      badge.title = "当前条目没有可解析的 PDF 附件";
      return;
    }
    badge.textContent = "PDF 解析失败";
    badge.title = state.message;
    retry.hidden = false;
  };

  const start = async () => {
    const current = ++generation;
    apply({ status: "parsing", message: "正在解析 PDF…" });
    const pdf = await resolveItemPdfForMineru(itemID);
    if (current !== generation) return;
    itemKey = pdf?.itemKey ?? "";
    if (itemKey) {
      const known = mineruParseState(itemKey);
      if (known) apply(known);
    }
    const result = await ensureMineruParse(itemID);
    if (current !== generation) return;
    apply(result);
  };

  retry.addEventListener("click", () => {
    void start();
  });
  const unwatch = watchMineruParse((key, state) => {
    if (!root.isConnected) {
      unwatch();
      return;
    }
    if (itemKey && key === itemKey) apply(state);
  });
  void start();
  return root;
}
