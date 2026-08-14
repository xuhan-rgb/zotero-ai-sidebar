import { buttonEl, el } from "./dom-utils";

export type PdfExportDialogState =
  | { status: "choosing"; fileName: string }
  | { status: "converting"; fileName: string }
  | { status: "done"; fileName: string; path: string }
  | { status: "error"; fileName: string; message: string };

export interface PdfExportDialogActions {
  onCopyFile(): void | Promise<void>;
  onCopyPath(): void | Promise<void>;
  onOpen(): void | Promise<void>;
  onClose(): void;
}

export function renderPdfExportDialog(
  doc: Document,
  state: PdfExportDialogState,
  actions: PdfExportDialogActions,
): HTMLElement {
  const layer = el(doc, "div", "zai-pdf-export-layer");
  const dialog = el(doc, "section", "zai-pdf-export-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "PDF 转换");

  const icon = el(
    doc,
    "div",
    `zai-pdf-export-icon is-${state.status}`,
    state.status === "done" ? "✓" : state.status === "error" ? "!" : "PDF",
  );
  const content = el(doc, "div", "zai-pdf-export-content");
  const title = el(doc, "strong", "zai-pdf-export-title", stateTitle(state));
  const fileName = el(doc, "div", "zai-pdf-export-file-name", state.fileName);
  content.append(title, fileName);

  if (state.status === "choosing" || state.status === "converting") {
    const progress = el(doc, "div", "zai-pdf-export-progress");
    progress.append(el(doc, "span", "zai-pdf-export-progress-bar"));
    content.append(progress);
  } else if (state.status === "done") {
    const path = el(doc, "div", "zai-pdf-export-path", state.path);
    path.title = state.path;
    content.append(path);
  } else {
    content.append(
      el(doc, "div", "zai-pdf-export-error", state.message || "转换失败"),
    );
  }

  dialog.append(icon, content);
  if (state.status === "done") {
    const actionRow = el(doc, "footer", "zai-pdf-export-actions");
    actionRow.append(
      actionButton(doc, "复制文件", actions.onCopyFile),
      actionButton(doc, "复制路径", actions.onCopyPath),
      actionButton(doc, "打开 PDF", actions.onOpen, true),
      actionButton(doc, "关闭", actions.onClose),
    );
    dialog.append(actionRow);
  } else if (state.status === "error") {
    const actionRow = el(doc, "footer", "zai-pdf-export-actions");
    actionRow.append(actionButton(doc, "关闭", actions.onClose, true));
    dialog.append(actionRow);
  }

  layer.append(dialog);
  if (state.status === "done" || state.status === "error") {
    layer.addEventListener("mousedown", (event) => {
      if (event.target === layer) actions.onClose();
    });
    layer.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      actions.onClose();
    });
  }
  return layer;
}

function stateTitle(state: PdfExportDialogState): string {
  switch (state.status) {
    case "choosing":
      return "请选择 PDF 保存位置";
    case "converting":
      return "正在转换 PDF…";
    case "done":
      return "PDF 转换完成";
    case "error":
      return "PDF 转换失败";
  }
}

function actionButton(
  doc: Document,
  label: string,
  action: () => void | Promise<void>,
  primary = false,
): HTMLButtonElement {
  const button = buttonEl(doc, label);
  if (primary) button.classList.add("is-primary");
  button.addEventListener("click", () => {
    const original = button.textContent ?? label;
    button.disabled = true;
    void Promise.resolve()
      .then(action)
      .then(() => {
        if (label.startsWith("复制")) button.textContent = "已复制";
      })
      .catch(() => {
        button.textContent = "操作失败";
      })
      .finally(() => {
        doc.defaultView?.setTimeout(() => {
          if (!button.isConnected) return;
          button.textContent = original;
          button.disabled = false;
        }, 1300);
      });
  });
  return button;
}
