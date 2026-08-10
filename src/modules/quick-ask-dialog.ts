import type { QuickAskState } from "./quick-ask";
import { renderMarkdownInto } from "./markdown-render";

// Zotero's chrome document is XUL; real XHTML controls are required for Gecko
// to report the textarea caret rectangle correctly to Chinese input methods.
const XHTML_NS = "http://www.w3.org/1999/xhtml";

export interface QuickAskDialogActions {
  onQuestionChange(value: string): void;
  onSend(value: string): void;
  onStop(): void;
  onReset(): void;
  onCopy(): void;
  onTransfer(): void;
  onClose(): void;
}

export interface QuickAskDialogOptions {
  shortcutLabel: string;
  transferDisabled?: boolean;
}

export function renderQuickAskDialog(
  doc: Document,
  state: QuickAskState,
  actions: QuickAskDialogActions,
  options: QuickAskDialogOptions,
): HTMLElement {
  const layer = el(doc, "div", "zai-quick-ask-layer");
  const dialog = el(doc, "section", "zai-quick-ask-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Quick Ask 临时问答");

  const head = el(doc, "header", "zai-quick-ask-head");
  const mark = el(doc, "span", "zai-quick-ask-mark", "Q");
  const heading = el(doc, "div", "zai-quick-ask-heading");
  heading.append(
    el(doc, "strong", "zai-quick-ask-title", "Quick Ask"),
    el(doc, "span", "zai-quick-ask-subtitle", "单次问答 · 不读取历史"),
  );
  const shortcut = el(
    doc,
    "kbd",
    "zai-quick-ask-shortcut",
    options.shortcutLabel,
  );
  const close = buttonEl(doc, "×");
  close.className = "zai-quick-ask-close";
  close.title = "关闭并销毁本次临时问答（Esc）";
  close.addEventListener("click", actions.onClose);
  head.append(mark, heading, shortcut, close);

  const scroll = el(doc, "div", "zai-quick-ask-scroll");
  scroll.append(
    el(
      doc,
      "div",
      "zai-quick-ask-notice",
      "本窗口不会读取或保存研究对话；关闭后问题和回答都会销毁。",
    ),
  );
  if (state.reference) scroll.append(renderReference(doc, state));

  if (state.status === "idle") {
    const composer = el(doc, "div", "zai-quick-ask-composer");
    const input = doc.createElementNS(
      XHTML_NS,
      "textarea",
    ) as HTMLTextAreaElement;
    input.className = "zai-quick-ask-input";
    input.value = state.question;
    input.rows = 4;
    input.placeholder = state.reference
      ? "针对这段内容提问……"
      : "输入一个临时问题；需要论文内容时，AI 会按需检索当前论文……";
    input.addEventListener("input", () => {
      actions.onQuestionChange(input.value);
      const send = dialog.querySelector<HTMLButtonElement>(
        ".zai-quick-ask-primary",
      );
      if (send) send.disabled = !input.value.trim();
    });
    input.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        actions.onSend(input.value);
      }
    });
    composer.append(input);
    scroll.append(composer);
  } else {
    scroll.append(
      el(doc, "div", "zai-quick-ask-question", state.question.trim()),
    );
    const answer = el(doc, "div", "zai-quick-ask-answer");
    answer.setAttribute("aria-live", "polite");
    if (state.answer) {
      renderMarkdownInto(answer, state.answer);
    } else if (state.status === "sending") {
      answer.append(el(doc, "div", "zai-quick-ask-waiting", "正在准备回答……"));
    }
    scroll.append(answer);
    if (state.thinking) {
      const thinking = doc.createElementNS(
        XHTML_NS,
        "details",
      ) as HTMLDetailsElement;
      thinking.className = "zai-quick-ask-thinking";
      const summary = doc.createElementNS(XHTML_NS, "summary") as HTMLElement;
      summary.textContent = "思考过程";
      const body = el(doc, "div", "zai-quick-ask-thinking-body");
      renderMarkdownInto(body, state.thinking);
      thinking.append(summary, body);
      scroll.append(thinking);
    }
  }

  if (state.statusText || state.error || state.usage) {
    const status = el(
      doc,
      "div",
      `zai-quick-ask-status${state.error ? " is-error" : ""}`,
    );
    const text = state.error || state.statusText;
    if (text) status.append(doc.createTextNode(text));
    if (state.usage) {
      const usage = `输入 ${state.usage.input} · 输出 ${state.usage.output}`;
      status.append(el(doc, "span", "zai-quick-ask-usage", usage));
    }
    scroll.append(status);
  }

  const foot = el(doc, "footer", "zai-quick-ask-foot");
  if (state.status === "idle") {
    const hint = el(
      doc,
      "span",
      "zai-quick-ask-hint",
      "Enter 发送 · Shift+Enter 换行",
    );
    const send = buttonEl(doc, "询问");
    send.className = "zai-quick-ask-primary";
    send.disabled = !state.question.trim();
    send.addEventListener("click", () => {
      const input = dialog.querySelector<HTMLTextAreaElement>(
        ".zai-quick-ask-input",
      );
      actions.onSend(input?.value ?? state.question);
    });
    foot.append(hint, send);
  } else if (state.status === "sending") {
    const hint = el(
      doc,
      "span",
      "zai-quick-ask-hint",
      "回答只保留在当前浮层中",
    );
    const stop = buttonEl(doc, "停止");
    stop.addEventListener("click", actions.onStop);
    foot.append(hint, stop);
  } else {
    const copy = buttonEl(doc, "复制");
    copy.disabled = !state.answer.trim();
    copy.addEventListener("click", actions.onCopy);
    const transfer = buttonEl(doc, "转入研究对话");
    transfer.disabled =
      !state.answer.trim() || options.transferDisabled === true;
    transfer.title = options.transferDisabled
      ? "研究对话正在回答，请结束后再转入"
      : "把本次问题和回答显式保存到当前研究对话";
    transfer.addEventListener("click", actions.onTransfer);
    const reset = buttonEl(doc, "再问一个");
    reset.className = "zai-quick-ask-primary";
    reset.addEventListener("click", actions.onReset);
    foot.append(copy, transfer, reset);
  }

  dialog.append(head, scroll, foot);
  layer.append(dialog);
  layer.addEventListener("mousedown", (event) => {
    if (event.target === layer) actions.onClose();
  });
  layer.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    actions.onClose();
  });
  return layer;
}

function renderReference(doc: Document, state: QuickAskState): HTMLElement {
  const reference = state.reference!;
  const card = el(doc, "section", "zai-quick-ask-reference");
  const label =
    reference.kind === "translation"
      ? "翻译页选区"
      : reference.kind === "source"
        ? "英文原文"
        : "PDF 选区";
  card.append(el(doc, "div", "zai-quick-ask-reference-title", label));
  if (reference.kind === "translation") {
    card.append(referenceRow(doc, "中文", reference.displayText));
    card.append(referenceRow(doc, "原文", reference.sourceText));
  } else {
    card.append(referenceRow(doc, "引用", reference.sourceText));
  }
  return card;
}

function referenceRow(
  doc: Document,
  label: string,
  value: string,
): HTMLElement {
  const row = el(doc, "div", "zai-quick-ask-reference-row");
  row.append(
    el(doc, "span", "zai-quick-ask-reference-label", label),
    el(doc, "div", "zai-quick-ask-reference-text", value),
  );
  return row;
}

function el(
  doc: Document,
  tag: string,
  className = "",
  value?: string,
): HTMLElement {
  const element = doc.createElementNS(XHTML_NS, tag) as HTMLElement;
  if (className) element.className = className;
  if (value != null) element.textContent = value;
  return element;
}

function buttonEl(doc: Document, value: string): HTMLButtonElement {
  const button = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
  button.textContent = value;
  return button;
}
