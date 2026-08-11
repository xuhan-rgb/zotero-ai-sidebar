import type { QuickAskState } from "./quick-ask";
import type { ReasoningEffort } from "../settings/types";
import { renderMarkdownInto } from "./markdown-render";

// Zotero's chrome document is XUL; real XHTML controls are required for Gecko
// to report the textarea caret rectangle correctly to Chinese input methods.
const XHTML_NS = "http://www.w3.org/1999/xhtml";

export interface QuickAskDialogActions {
  onQuestionChange(value: string): void;
  onToggleModelSettings(): void;
  onModelChange(presetId: string, model: string): void;
  onReasoningChange(value: ReasoningEffort): void;
  onSend(value: string): void;
  onStop(): void;
  onCopy(): void;
  onTransfer(): void;
  onClose(): void;
}

export interface QuickAskModelOption {
  presetId: string;
  presetLabel: string;
  model: string;
}

export interface QuickAskDialogOptions {
  shortcutLabel: string;
  modelSettingsOpen?: boolean;
  modelOptions?: QuickAskModelOption[];
  reasoningOptions?: Array<[ReasoningEffort, string]>;
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
    el(doc, "span", "zai-quick-ask-subtitle", "临时连续对话 · 不读取研究历史"),
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
      "本窗口可以连续追问，但不会读取或保存研究对话；关闭后全部销毁。",
    ),
  );
  if (options.modelOptions) {
    scroll.append(
      renderModelControls(
        doc,
        state,
        actions,
        options.modelSettingsOpen === true,
        options.modelOptions,
        options.reasoningOptions ?? [],
      ),
    );
  }
  if (state.reference) scroll.append(renderReference(doc, state));

  state.messages.forEach((message) => {
    scroll.append(renderConversationMessage(doc, message));
  });

  if (state.status === "sending") {
    scroll.append(
      el(doc, "div", "zai-quick-ask-question", state.question.trim()),
      renderAssistantMessage(doc, state.answer, state.thinking, true),
    );
  } else {
    const composer = el(doc, "div", "zai-quick-ask-composer");
    if (state.messages.length) composer.classList.add("is-follow-up");
    const input = doc.createElementNS(
      XHTML_NS,
      "textarea",
    ) as HTMLTextAreaElement;
    input.className = "zai-quick-ask-input";
    input.value = state.question;
    input.rows = state.messages.length ? 2 : 4;
    input.placeholder = state.messages.length
      ? "继续追问……"
      : state.reference
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
  if (state.status === "sending") {
    const hint = el(
      doc,
      "span",
      "zai-quick-ask-hint",
      "对话只保留在当前浮层中",
    );
    const stop = buttonEl(doc, "停止");
    stop.addEventListener("click", actions.onStop);
    foot.append(hint, stop);
  } else {
    const hint = el(
      doc,
      "span",
      "zai-quick-ask-hint",
      "Enter 发送 · Shift+Enter 换行",
    );
    const latestAnswer = latestAssistantAnswer(state);
    if (state.messages.length) {
      const copy = buttonEl(doc, "复制");
      copy.disabled = !latestAnswer;
      copy.addEventListener("click", actions.onCopy);
      const transfer = buttonEl(doc, "转入研究对话");
      transfer.disabled = !latestAnswer || options.transferDisabled === true;
      transfer.title = options.transferDisabled
        ? "研究对话正在回答，请结束后再转入"
        : "把本窗口的全部问答显式保存到当前研究对话";
      transfer.addEventListener("click", actions.onTransfer);
      foot.append(hint, copy, transfer);
    } else {
      foot.append(hint);
    }
    const send = buttonEl(doc, state.messages.length ? "继续询问" : "询问");
    send.className = "zai-quick-ask-primary";
    send.disabled = !state.question.trim();
    send.addEventListener("click", () => {
      const input = dialog.querySelector<HTMLTextAreaElement>(
        ".zai-quick-ask-input",
      );
      actions.onSend(input?.value ?? state.question);
    });
    foot.append(send);
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

function renderConversationMessage(
  doc: Document,
  message: QuickAskState["messages"][number],
): HTMLElement {
  if (message.role === "user") {
    return el(doc, "div", "zai-quick-ask-question", message.content.trim());
  }
  return renderAssistantMessage(
    doc,
    message.content,
    message.thinking ?? "",
    false,
  );
}

function renderAssistantMessage(
  doc: Document,
  content: string,
  thinkingText: string,
  live: boolean,
): HTMLElement {
  const turn = el(doc, "div", "zai-quick-ask-assistant-turn");
  const answer = el(doc, "div", "zai-quick-ask-answer");
  if (live) answer.setAttribute("aria-live", "polite");
  if (content) {
    renderMarkdownInto(answer, content);
  } else if (live) {
    answer.append(el(doc, "div", "zai-quick-ask-waiting", "正在准备回答……"));
  }
  turn.append(answer);
  if (thinkingText) {
    const thinking = doc.createElementNS(
      XHTML_NS,
      "details",
    ) as HTMLDetailsElement;
    thinking.className = "zai-quick-ask-thinking";
    const summary = doc.createElementNS(XHTML_NS, "summary") as HTMLElement;
    summary.textContent = "思考过程";
    const body = el(doc, "div", "zai-quick-ask-thinking-body");
    renderMarkdownInto(body, thinkingText);
    thinking.append(summary, body);
    turn.append(thinking);
  }
  return turn;
}

function latestAssistantAnswer(state: QuickAskState): string {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (message.role === "assistant" && message.content.trim()) {
      return message.content.trim();
    }
  }
  return "";
}

function renderModelControls(
  doc: Document,
  state: QuickAskState,
  actions: QuickAskDialogActions,
  open: boolean,
  modelOptions: QuickAskModelOption[],
  reasoningOptions: Array<[ReasoningEffort, string]>,
): HTMLElement {
  const root = el(doc, "section", "zai-quick-ask-model-settings");
  const current =
    modelOptions.find(
      (item) =>
        item.presetId === state.modelSelection.presetId &&
        item.model === state.modelSelection.model,
    ) ?? modelOptions[0];
  const summary = el(doc, "div", "zai-quick-ask-model-settings-summary");
  const copy = el(doc, "div", "zai-quick-ask-model-settings-copy");
  copy.append(
    el(doc, "strong", "", current?.model ?? "未配置可用模型"),
    el(
      doc,
      "small",
      "",
      current
        ? `${current.presetLabel} · ${quickAskReasoningLabel(state, reasoningOptions)}`
        : "请先在设置中配置账号和模型",
    ),
  );
  const toggle = buttonEl(doc, open ? "收起设置" : "模型设置");
  toggle.className = "zai-quick-ask-model-settings-toggle";
  toggle.setAttribute("aria-expanded", String(open));
  toggle.disabled = state.status !== "idle" || modelOptions.length === 0;
  toggle.addEventListener("click", actions.onToggleModelSettings);
  summary.append(copy, toggle);

  const panel = el(doc, "div", "zai-quick-ask-model-settings-panel");
  panel.hidden = !open;
  const presetOptions = modelOptions.filter(
    (item, index) =>
      modelOptions.findIndex(
        (candidate) => candidate.presetId === item.presetId,
      ) === index,
  );
  panel.append(
    quickAskSelect(doc, {
      label: "账号",
      className: "zai-quick-ask-preset-select",
      value: current?.presetId ?? "",
      options: presetOptions.map((item) => [item.presetId, item.presetLabel]),
      disabled: state.status !== "idle",
      emptyLabel: "未配置可用账号",
      onChange: (presetId) => {
        const firstModel = modelOptions.find(
          (item) => item.presetId === presetId,
        );
        if (firstModel) actions.onModelChange(presetId, firstModel.model);
      },
    }),
    quickAskSelect(doc, {
      label: "模型",
      className: "zai-quick-ask-model-select",
      value: current?.model ?? "",
      options: modelOptions
        .filter((item) => item.presetId === current?.presetId)
        .map((item) => [item.model, item.model]),
      disabled: state.status !== "idle",
      emptyLabel: "未配置可用模型",
      onChange: (model) => {
        if (current) actions.onModelChange(current.presetId, model);
      },
    }),
    quickAskSelect(doc, {
      label: "思考强度",
      className: "zai-quick-ask-reasoning-select",
      value: state.modelSelection.reasoningEffort,
      options: reasoningOptions,
      disabled: state.status !== "idle" || reasoningOptions.length === 0,
      emptyLabel: "当前账号不支持",
      onChange: (value) => actions.onReasoningChange(value as ReasoningEffort),
    }),
  );
  root.append(summary, panel);
  return root;
}

interface QuickAskSelectOptions {
  label: string;
  className: string;
  value: string;
  options: Array<[string, string]>;
  disabled: boolean;
  emptyLabel: string;
  onChange(value: string): void;
}

function quickAskSelect(
  doc: Document,
  options: QuickAskSelectOptions,
): HTMLElement {
  const label = el(doc, "label", "zai-quick-ask-model-setting");
  label.append(el(doc, "span", "", options.label));
  const select = doc.createElementNS(XHTML_NS, "select") as HTMLSelectElement;
  select.className = options.className;
  select.setAttribute("aria-label", `选择本次 Quick Ask 的${options.label}`);
  if (options.options.length === 0) {
    const option = doc.createElementNS(XHTML_NS, "option") as HTMLOptionElement;
    option.textContent = options.emptyLabel;
    select.append(option);
  } else {
    for (const [value, title] of options.options) {
      const option = doc.createElementNS(
        XHTML_NS,
        "option",
      ) as HTMLOptionElement;
      option.value = value;
      option.textContent = title;
      select.append(option);
    }
    select.value = options.value;
  }
  select.disabled = options.disabled || options.options.length === 0;
  select.addEventListener("change", () => options.onChange(select.value));
  label.append(select);
  return label;
}

function quickAskReasoningLabel(
  state: QuickAskState,
  reasoningOptions: Array<[ReasoningEffort, string]>,
): string {
  return (
    reasoningOptions.find(
      ([value]) => value === state.modelSelection.reasoningEffort,
    )?.[1] ?? "当前账号不支持"
  );
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
