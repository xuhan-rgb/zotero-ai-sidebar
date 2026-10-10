import {
  ensureMineruParse,
  mineruParseState,
  watchMineruParse,
  type MineruParseState,
} from "../translate/mineru-parse";
import { resolveItemPdfForMineru } from "../translate/mineru-session";
import { uiText } from "../utils/ui-locale";

export function renderPdfParseControls(
  doc: Document,
  itemID: number,
  onTranslate: () => void,
  options?: {
    onConfigureToken?: () => void;
  },
): HTMLElement {
  const root = doc.createElement("span");
  root.className = "latex-source-controls pdf-parse-controls";
  const badge = doc.createElement("span");
  badge.className = "arxiv-source-badge";
  const retry = doc.createElement("button");
  retry.type = "button";
  retry.className = "arxiv-full-translation-button";
  retry.textContent = uiText("重试解析", "Retry parsing");
  const applyToken = doc.createElement("button");
  applyToken.type = "button";
  applyToken.className = "arxiv-full-translation-button";
  applyToken.textContent = uiText("配置 Token", "Configure token");
  applyToken.hidden = true;
  applyToken.addEventListener("click", () => openTokenSettings());
  const translate = doc.createElement("button");
  translate.type = "button";
  translate.className = "arxiv-full-translation-button";
  translate.textContent = uiText("全文翻译", "Translate full text");
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
      badge.textContent = state?.message || uiText("正在解析 PDF…", "Parsing PDF…");
      badge.title = uiText("打开 PDF 后先完成 MinerU 解析，再显示全文翻译", "Open the PDF and wait for MinerU parsing to finish before translating the full text");
      return;
    }
    if (state.status === "ready") {
      badge.textContent = uiText("PDF 已解析", "PDF parsed");
      badge.title = uiText("MinerU 解析完成，可以全文翻译", "MinerU parsing is complete; you can translate the full text");
      translate.hidden = false;
      return;
    }
    if (state.status === "no-token") {
      badge.textContent = uiText("未配置 MinerU Token", "MinerU token is not configured");
      badge.removeAttribute("title");
      applyToken.hidden = !options?.onConfigureToken;
      if (options?.onConfigureToken) badge.style.cursor = "pointer";
      return;
    }
    if (state.status === "no-pdf") {
      badge.textContent = uiText("无 PDF", "No PDF");
      badge.title = uiText("当前条目没有可解析的 PDF 附件", "This item has no PDF attachment to parse");
      return;
    }
    badge.textContent = uiText("PDF 解析失败", "PDF parsing failed");
    badge.title = state.message;
    retry.hidden = false;
  };

  const start = async () => {
    const current = ++generation;
    apply({ status: "parsing", message: uiText("正在解析 PDF…", "Parsing PDF…") });
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
