import type { QuickAskHistoryEntry } from "../settings/quick-ask-history";
import type { QuickAskState } from "./quick-ask";
import type { ReasoningEffort } from "../settings/types";
import { renderMarkdownInto } from "./markdown-render";

// Zotero's chrome document is XUL; real XHTML controls are required for Gecko
// to report the textarea caret rectangle correctly to Chinese input methods.
const XHTML_NS = "http://www.w3.org/1999/xhtml";

export function focusQuickAskInput(root: HTMLElement): void {
  const input = root.querySelector<HTMLTextAreaElement>(".zai-quick-ask-input");
  if (!input) return;
  root.ownerDocument?.defaultView?.focus();
  input.focus();
}

export interface QuickAskDialogActions {
  onQuestionChange(value: string): void;
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

export interface QuickAskDialogPosition {
  x: number;
  y: number;
  dialog?: HTMLElement;
  stopDrag?: () => void;
  stopWatchingSize?: () => void;
}

export function disposeQuickAskDialog(position: QuickAskDialogPosition): void {
  position.stopDrag?.();
  position.stopWatchingSize?.();
  position.dialog = undefined;
}

export interface QuickAskDialogOptions {
  history?: QuickAskHistoryEntry[];
  historyOpen?: boolean;
  onHistoryToggle?: (open: boolean) => void;
  modelOptions?: QuickAskModelOption[];
  reasoningOptions?: Array<[ReasoningEffort, string]>;
  transferDisabled?: boolean;
  animateEntrance?: boolean;
  position?: QuickAskDialogPosition;
  followMouse?: boolean;
  onFollowMouseChange?: (enabled: boolean) => void;
  modelSettingsOpen?: boolean;
  onModelSettingsChange?: (open: boolean) => void;
}

export function renderQuickAskDialog(
  doc: Document,
  state: QuickAskState,
  actions: QuickAskDialogActions,
  options: QuickAskDialogOptions,
): HTMLElement {
  const layer = el(doc, "div", "zai-quick-ask-layer");
  const dialog = el(doc, "section", "zai-quick-ask-dialog");
  if (options.animateEntrance === false) {
    layer.style.animation = "none";
    dialog.style.animation = "none";
  }
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "false");
  dialog.setAttribute("aria-label", "Quick Ask 临时问答");

  const head = el(doc, "header", "zai-quick-ask-head");
  const position: QuickAskDialogPosition = options.position ?? { x: 0, y: 0 };
  position.stopWatchingSize?.();
  position.dialog = dialog;
  dialog.style.transform = `translate(${position.x}px, ${position.y}px)`;
  const win = doc.defaultView;
  const constrainPosition = () => {
    if (!win || !dialog.isConnected) return;
    const rect = dialog.getBoundingClientRect();
    position.x +=
      Math.max(0, Math.min(rect.left, win.innerWidth - rect.width)) - rect.left;
    position.y +=
      Math.max(0, Math.min(rect.top, win.innerHeight - rect.height)) - rect.top;
    dialog.style.transform = `translate(${position.x}px, ${position.y}px)`;
  };
  // The initial observer notification runs after mounting, including redraws.
  const observer = win ? new win.ResizeObserver(constrainPosition) : undefined;
  observer?.observe(dialog);
  win?.addEventListener("resize", constrainPosition);
  position.stopWatchingSize = () => {
    observer?.disconnect();
    win?.removeEventListener("resize", constrainPosition);
    position.stopWatchingSize = undefined;
  };
  const closeDialog = () => {
    disposeQuickAskDialog(position);
    actions.onClose();
  };
  head.addEventListener("mousedown", (event: MouseEvent) => {
    if (
      event.button !== 0 ||
      (event.target as Element).closest("button, label")
    )
      return;
    event.preventDefault();
    position.stopDrag?.();
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = position.x;
    const originY = position.y;
    const rect = dialog.getBoundingClientRect();
    const win = doc.defaultView;
    const move = (moveEvent: MouseEvent) => {
      if (!win || !position.dialog?.isConnected) return;
      position.x =
        originX +
        Math.max(
          -rect.left,
          Math.min(win.innerWidth - rect.right, moveEvent.clientX - startX),
        );
      position.y =
        originY +
        Math.max(
          -rect.top,
          Math.min(win.innerHeight - rect.bottom, moveEvent.clientY - startY),
        );
      position.dialog.style.transform = `translate(${position.x}px, ${position.y}px)`;
    };
    const stop = () => {
      doc.removeEventListener("mousemove", move);
      doc.removeEventListener("mouseup", stop);
      position.stopDrag = undefined;
    };
    position.stopDrag = stop;
    doc.addEventListener("mousemove", move);
    doc.addEventListener("mouseup", stop);
  });
  const mark = el(doc, "span", "zai-quick-ask-mark", "Q");
  const heading = el(doc, "div", "zai-quick-ask-heading");
  heading.append(el(doc, "strong", "zai-quick-ask-title", "Quick Ask"));
  const close = buttonEl(doc, "×");
  close.className = "zai-quick-ask-close";
  close.title = "关闭并保存本次对话到历史记录（Esc）";
  close.addEventListener("click", closeDialog);
  const followLabel = el(doc, "label", "zai-quick-ask-follow-mouse");
  const follow = doc.createElementNS(XHTML_NS, "input") as HTMLInputElement;
  follow.type = "checkbox";
  follow.checked = options.followMouse === true;
  follow.addEventListener("change", () =>
    options.onFollowMouseChange?.(follow.checked),
  );
  followLabel.append(follow, doc.createTextNode("跟随鼠标"));
  head.append(mark, heading, followLabel);
  if (options.modelOptions) {
    const modelSettings = renderModelControls(
      doc,
      state,
      actions,
      options.modelOptions,
      options.reasoningOptions ?? [],
    );
    const toggle = buttonEl(doc, "模型设置");
    toggle.className = "zai-quick-ask-model-settings-toggle";
    toggle.setAttribute(
      "aria-expanded",
      String(options.modelSettingsOpen === true),
    );
    modelSettings.hidden = options.modelSettingsOpen !== true;
    toggle.addEventListener("click", () => {
      modelSettings.hidden = !modelSettings.hidden;
      toggle.setAttribute("aria-expanded", String(!modelSettings.hidden));
      options.onModelSettingsChange?.(!modelSettings.hidden);
    });
    head.append(toggle, modelSettings);
  }
  const historyToggle = buttonEl(doc, "历史记录");
  historyToggle.className = "zai-quick-ask-model-settings-toggle";
  head.append(historyToggle, close);

  const scroll = el(doc, "div", "zai-quick-ask-scroll");
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
    const send = buttonEl(doc, state.messages.length ? "继续询问" : "询问");
    send.className = "zai-quick-ask-primary";
    send.disabled = !state.question.trim();
    send.addEventListener("click", () => actions.onSend(input.value));
    composer.append(input, send);
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
      "关闭后保存到历史记录，新窗口开始新对话",
    );
    const stop = buttonEl(doc, "停止");
    stop.addEventListener("click", actions.onStop);
    foot.append(hint, stop);
  } else {
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
      foot.append(copy, transfer);
    }
  }

  const history = el(doc, "div", "zai-quick-ask-scroll zai-quick-ask-history");
  history.append(
    el(
      doc,
      "p",
      "zai-quick-ask-hint",
      "历史记录仅供回看，不会加入当前对话上下文。",
    ),
  );
  if (!options.history?.length) {
    history.append(
      el(doc, "p", "zai-quick-ask-hint", "当前论文暂无历史对话。"),
    );
  }
  for (const entry of options.history ?? []) {
    const details = doc.createElementNS(XHTML_NS, "details");
    const firstQuestion =
      entry.messages.find((message) => message.role === "user")?.content ??
      "Quick Ask";
    details.append(
      el(
        doc,
        "summary",
        "",
        `${new Date(entry.createdAt).toLocaleString()} · ${firstQuestion.slice(0, 80)}`,
      ),
    );
    if (entry.reference)
      details.append(
        renderReference(doc, { ...state, reference: entry.reference }),
      );
    for (const message of entry.messages)
      details.append(renderConversationMessage(doc, message));
    history.append(details);
  }
  const showHistory = (open: boolean) => {
    history.hidden = !open;
    scroll.hidden = open;
    foot.hidden = open;
    historyToggle.textContent = open ? "返回当前对话" : "历史记录";
    historyToggle.setAttribute("aria-expanded", String(open));
  };
  showHistory(options.historyOpen === true);
  historyToggle.addEventListener("click", () => {
    const open = history.hidden === true;
    showHistory(open);
    options.onHistoryToggle?.(open);
  });
  dialog.append(head, scroll, history);
  if (state.status === "sending" || state.messages.length) dialog.append(foot);
  layer.append(dialog);
  layer.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    closeDialog();
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
  const panel = el(doc, "div", "zai-quick-ask-model-settings-panel");
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
  root.append(panel);
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

export function updateQuickAskReferenceView(root: HTMLElement, state: QuickAskState): void {
  const scroll = root.querySelector<HTMLElement>(".zai-quick-ask-scroll");
  if (!scroll) return;
  const previous = scroll.querySelector(":scope > .zai-quick-ask-reference");
  if (!state.reference) {
    previous?.remove();
    return;
  }
  const next = renderReference(root.ownerDocument!, state);
  if (previous) previous.replaceWith(next);
  else scroll.prepend(next);
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
