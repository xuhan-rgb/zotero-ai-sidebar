import { createFloatingPdfAlignment } from "./floating-pdf-alignment";
import {
  DEFAULT_FLOATING_PANEL_LAYOUT,
  normalizeFloatingPanelLayout,
  type FloatingPanelLayout,
  type FloatingPanelRect,
} from "../settings/local-ui-settings";
import { uiText } from "../utils/ui-locale";

export type FloatingPanelID = keyof FloatingPanelLayout;
type Rect = Omit<FloatingPanelRect, "x" | "y"> & { x: number; y: number };

export interface FloatingWorkspaceOptions {
  desktop?: boolean;
  readerHostWindow?: Window;
  onCompactChange?(compact: boolean): void;
  onReset?(): void;
  readerWindows?(): Window[];
  layout: FloatingPanelLayout;
  onLayoutChange(layout: FloatingPanelLayout): void;
  onVisibilityChange(): void;
  onPanelToggle?(
    id: FloatingPanelID,
    visible: boolean,
    apply: () => void,
  ): void;
}

export interface FloatingWorkspace {
  arrange(panel: HTMLElement): void;
  refresh(layout?: FloatingPanelLayout): void;
  refreshReaderAlignment(): void;
  setVisible(visible: boolean): void;
  showAnswer(): boolean;
  setPinned?(pinned: boolean): Promise<void>;
  isHidden(): boolean;
  destroy(): void;
}

const NS = "http://www.w3.org/1999/xhtml";
const IDs: FloatingPanelID[] = ["answer", "composer"];
const copyLayout = (value: FloatingPanelLayout) =>
  normalizeFloatingPanelLayout(value);
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, Math.max(min, max)));

/** All views stay under the same mount in the host chrome document. */
export function createFloatingWorkspace(
  win: Window,
  mount: HTMLElement,
  options: FloatingWorkspaceOptions,
): FloatingWorkspace {
  const doc = mount.ownerDocument!;
  if (doc !== win.document)
    throw new Error("Floating panels must use the host document");
  const home = mount.parentNode;
  const homeNext = mount.nextSibling;
  let layout = copyLayout(options.layout);
  const hidden: Record<FloatingPanelID, boolean> = {
    answer: false,
    composer: false,
  };
  let answerCollapsed: boolean | null = null;
  let lastCompact: boolean | null = null;
  let disposed = false;
  let viewportWidth = win.innerWidth;
  let viewportHeight = win.innerHeight;
  let gesture: {
    id: FloatingPanelID;
    pointerID: number;
    resize: boolean;
    x: number;
    y: number;
    start: Rect;
    original: FloatingPanelRect;
    changed: boolean;
  } | null = null;

  const frame = (id: FloatingPanelID) =>
    mount.querySelector<HTMLElement>(`[data-zai-floating-panel="${id}"]`);
  const floatingWindow = () =>
    mount.querySelector<HTMLElement>("[data-zai-floating-window]");
  const element = (tag: string, className: string, text?: string) => {
    const node = doc.createElementNS(NS, tag) as HTMLElement;
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const fit = (id: FloatingPanelID, value: FloatingPanelRect): Rect => {
    if (options.desktop)
      return { x: 0, y: 0, width: win.innerWidth, height: win.innerHeight };
    if (value.x === null && value.y === null) {
      const width = Math.min(600, win.innerWidth - 32);
      const height = Math.min(680, win.innerHeight - 128);
      value = {
        x: (win.innerWidth - width) / 2,
        y: win.innerHeight - height - 24,
        width,
        height,
      };
    }
    const availableWidth = Math.max(1, Math.min(1600, win.innerWidth - 16));
    const availableHeight = Math.max(1, Math.min(1400, win.innerHeight - 16));
    const width = clamp(
      value.width,
      Math.min(320, availableWidth),
      availableWidth,
    );
    const height = clamp(
      value.height,
      Math.min(240, availableHeight),
      availableHeight,
    );
    const visibleHeight =
      answerCollapsed && frame("composer")
        ? Math.min(height, floatingWindow()?.offsetHeight || 240)
        : height;
    return {
      x: clamp(
        value.x ?? (id === "answer" ? win.innerWidth - width - 24 : 24),
        8,
        win.innerWidth - width - 8,
      ),
      y: clamp(
        value.y ?? (id === "answer" ? 64 : win.innerHeight - height - 24),
        8,
        win.innerHeight - visibleHeight - 8,
      ),
      width,
      height,
    };
  };
  const readerAlignment = createFloatingPdfAlignment();
  let pdfAlignment: "left" | "right" = "left";
  const refreshReaderAlignment = () => {
    // Resize the reader only after the gesture completes, keeping pointer delivery stable.
    if (disposed || gesture) return;
    const host = options.readerHostWindow ?? win;
    const rect = options.desktop
      ? {
          x:
            ((win as any).mozInnerScreenX ?? win.screenX) -
            ((host as any).mozInnerScreenX ?? host.screenX),
          y:
            ((win as any).mozInnerScreenY ?? win.screenY) -
            ((host as any).mozInnerScreenY ?? host.screenY),
          width: win.innerWidth,
          height: win.innerHeight,
        }
      : fit("answer", layout.answer);
    const center = rect.x + rect.width / 2;
    if (center < host.innerWidth / 2 - 24) pdfAlignment = "right";
    else if (center > host.innerWidth / 2 + 24) pdfAlignment = "left";
    const overlaps =
      rect.x < host.innerWidth &&
      rect.x + rect.width > 0 &&
      rect.y < host.innerHeight &&
      rect.y + rect.height > 0;
    const visible = !hidden.composer && !answerCollapsed && overlaps;
    if (options.desktop) {
      // Align pages away from the native window without narrowing the reader
      // into a full-height column. The OS window covers only its actual bounds.
      readerAlignment.sync(
        options.readerWindows?.() ?? [],
        visible ? pdfAlignment : "native",
      );
      return;
    }
    readerAlignment.sync(
      options.readerWindows?.() ?? [],
      visible ? pdfAlignment : "native",
      {
        hostWindow: host,
        // Reserve the whole window, including the fixed composer underneath the answer.
        answer: visible
          ? {
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
            }
          : null,
        composer: null,
      },
    );
  };
  const apply = () => {
    if (disposed) return;
    const panel = floatingWindow();
    if (!panel) return;
    const rect = fit("answer", layout.answer);
    panel.hidden = hidden.composer;
    panel.classList.toggle("zai-floating-compact", !!answerCollapsed);
    panel.style.left = `${rect.x}px`;
    panel.style.top = `${rect.y}px`;
    panel.style.width = `${rect.width}px`;
    panel.style.height =
      answerCollapsed && frame("composer") ? "auto" : `${rect.height}px`;
    panel.style.maxHeight = options.desktop
      ? "none"
      : `${win.innerHeight - rect.y - 8}px`;
    for (const id of IDs) {
      const section = frame(id);
      if (section)
        section.hidden = hidden[id] || (id === "answer" && !!answerCollapsed);
    }
    const toggle = panel.querySelector<HTMLButtonElement>(
      '[data-zai-float-action="hide"]',
    );
    if (toggle) {
      toggle.textContent = answerCollapsed ? "⌃" : "−";
      toggle.title = answerCollapsed
        ? uiText("展开回答", "Show answers")
        : uiText("收起回答，保留提问框", "Collapse answers, keep the composer");
      toggle.setAttribute("aria-label", toggle.title);
      toggle.setAttribute("aria-expanded", String(!answerCollapsed));
    }
    refreshReaderAlignment();
    if (lastCompact !== !!answerCollapsed) {
      lastCompact = !!answerCollapsed;
      options.onCompactChange?.(lastCompact);
    }
  };
  const persist = () => options.onLayoutChange(copyLayout(layout));
  const changePanelVisibility = (id: FloatingPanelID, visible: boolean) => {
    const change = () => {
      if (id === "answer") answerCollapsed = !visible;
      else hidden.answer = hidden.composer = !visible;
      apply();
      options.onVisibilityChange();
    };
    if (options.onPanelToggle) options.onPanelToggle(id, visible, change);
    else change();
  };
  const action = (kind: string, text: string, title: string) => {
    const button = element(
      "button",
      "zai-floating-action",
      text,
    ) as HTMLButtonElement;
    button.type = "button";
    button.dataset.zaiFloatAction = kind;
    button.title = title;
    button.setAttribute("aria-label", title);
    return button;
  };
  const wrap = (answer: Element[], composer?: Element) => {
    const panel = element("section", "zai-floating-module zai-floating-window");
    panel.dataset.zaiFloatingWindow = "";
    panel.setAttribute(
      "aria-label",
      uiText("AI 浮动对话窗口", "AI floating conversation"),
    );
    if (!options.desktop) {
      const header = element("div", "zai-floating-header");
      header.dataset.zaiFloatDrag = "answer";
      header.tabIndex = 0;
      header.title = uiText(
        "拖动窗口；聚焦后用方向键微调",
        "Drag window; focus and use arrow keys to adjust",
      );
      header.setAttribute("aria-label", header.title);
      header.append(element("span", "zai-floating-grip", "⠿"));
      const tools = element("div", "zai-floating-actions");
      tools.append(
        action(
          "reset",
          "↺",
          uiText("恢复窗口默认位置和大小", "Reset window layout"),
        ),
        action(
          "hide",
          "−",
          uiText("收起回答，保留提问框", "Collapse answers, keep the composer"),
        ),
      );
      header.append(tools);
      panel.append(header);
    }
    const answers = element("div", "zai-floating-answer zai-floating-content");
    answers.dataset.zaiFloatingPanel = "answer";
    answers.append(...answer);
    panel.append(answers);
    if (composer) {
      const input = element("div", "zai-floating-composer");
      input.dataset.zaiFloatingPanel = "composer";
      input.append(composer);
      panel.append(input);
    }
    const resize = element(
      "button",
      "zai-floating-resize",
    ) as HTMLButtonElement;
    resize.type = "button";
    resize.dataset.zaiFloatResize = "answer";
    resize.title = uiText(
      "拖动调整窗口大小；聚焦后可用方向键调整",
      "Drag to resize the window; focus and use arrow keys to adjust",
    );
    resize.setAttribute("aria-label", resize.title);
    panel.append(resize);
    return panel;
  };
  const arrange = (panel: HTMLElement) => {
    if (disposed) return;
    if (!panel.classList.contains("zai-floating-app")) {
      const composer = Array.from(panel.children).find((child) =>
        child.classList.contains("composer"),
      );
      const answer = Array.from(panel.children).filter(
        (child) => child !== composer,
      );
      const scrolls = (
        Array.from(
          panel.querySelectorAll(".messages, .composer"),
        ) as HTMLElement[]
      ).map((node) => [node, node.scrollTop] as const);
      if (answerCollapsed === null || panel.querySelector(".messages-empty"))
        answerCollapsed = !!panel.querySelector(".messages-empty");
      // Recovery/error views must remain visible even if answers were collapsed.
      if (!composer) answerCollapsed = false;
      panel.append(wrap(answer, composer));
      panel.classList.add("zai-floating-app");
      for (const [node, top] of scrolls) node.scrollTop = top;
    }
    apply();
  };
  const finish = (cancel: boolean) => {
    const current = gesture;
    if (!current) return;
    gesture = null;
    if (cancel) layout[current.id] = current.original;
    try {
      mount.releasePointerCapture?.(current.pointerID);
    } catch {
      /* Already released by the host. */
    }
    mount.classList.remove("zai-floating-gesturing");
    apply();
    if (!cancel && current.changed) persist();
  };
  const onPointerDown = (event: PointerEvent) => {
    if (options.desktop || event.button !== 0) return;
    const target = event.target as Element | null;
    const panel = target?.closest?.("[data-zai-floating-window]");
    if (!panel) return;
    const id: FloatingPanelID = "answer";
    const resize = target?.closest?.("[data-zai-float-resize]");
    const handle = target?.closest?.("[data-zai-float-drag]");
    if (
      !resize &&
      (!handle || target?.closest?.("button, input, textarea, select, a"))
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    // Keep Escape/arrow keys in the host document while the pointer crosses a PDF iframe.
    ((resize ?? handle) as HTMLElement).focus({ preventScroll: true });
    gesture = {
      id,
      pointerID: event.pointerId,
      resize: !!resize,
      x: event.clientX,
      y: event.clientY,
      start: fit(id, layout[id]),
      original: { ...layout[id] },
      changed: false,
    };
    // Capture on the persistent mount, not a header replaced during streaming.
    try {
      mount.setPointerCapture?.(event.pointerId);
    } catch {
      /* Window listeners support hosts without capture. */
    }
    mount.classList.add("zai-floating-gesturing");
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.pointerID) return;
    event.preventDefault();
    const dx = event.clientX - gesture.x,
      dy = event.clientY - gesture.y;
    const rect = { ...gesture.start };
    if (gesture.resize) {
      rect.width += dx;
      rect.height += dy;
    } else {
      rect.x += dx;
      rect.y += dy;
    }
    layout[gesture.id] = fit(gesture.id, rect);
    gesture.changed = gesture.changed || dx !== 0 || dy !== 0;
    apply();
  };
  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId === gesture?.pointerID) finish(false);
  };
  const onCancel = () => finish(true);
  const onResize = () => {
    if (win.innerWidth === viewportWidth && win.innerHeight === viewportHeight)
      return;
    viewportWidth = win.innerWidth;
    viewportHeight = win.innerHeight;
    finish(true);
    apply();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && gesture) {
      event.preventDefault();
      event.stopPropagation();
      finish(true);
      return;
    }
    const target = event.target as HTMLElement | null;
    const id = (target?.dataset?.zaiFloatDrag ??
      target?.dataset?.zaiFloatResize) as FloatingPanelID | undefined;
    if (
      !id ||
      !IDs.includes(id) ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (options.desktop) {
      const step = event.shiftKey ? 1 : 10;
      const dx =
        event.key === "ArrowLeft"
          ? -step
          : event.key === "ArrowRight"
            ? step
            : 0;
      const dy =
        event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      if (target?.dataset.zaiFloatResize) win.resizeBy(dx, dy);
      else win.moveBy(dx, dy);
      return;
    }
    const rect = fit(id, layout[id]),
      step = event.shiftKey ? 1 : 10;
    const delta =
      event.key === "ArrowLeft" || event.key === "ArrowUp" ? -step : step;
    if (target?.dataset.zaiFloatResize) {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight")
        rect.width += delta;
      else rect.height += delta;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight")
      rect.x += delta;
    else rect.y += delta;
    layout[id] = fit(id, rect);
    apply();
    persist();
  };
  const onClick = (event: MouseEvent) => {
    const button = (event.target as Element | null)?.closest?.(
      "[data-zai-float-action]",
    ) as HTMLElement | null;
    if (!button || !button.closest("[data-zai-floating-window]")) return;
    event.preventDefault();
    if (button.dataset.zaiFloatAction === "hide")
      changePanelVisibility("answer", !!answerCollapsed);
    else if (button.dataset.zaiFloatAction === "reset") {
      layout = copyLayout(DEFAULT_FLOATING_PANEL_LAYOUT);
      options.onReset?.();
      const reset = () => {
        hidden.answer = hidden.composer = false;
        answerCollapsed = false;
        apply();
        persist();
        options.onVisibilityChange();
      };
      if (answerCollapsed && options.onPanelToggle)
        options.onPanelToggle("answer", true, reset);
      else reset();
    }
  };

  const scrolls = (
    Array.from(mount.querySelectorAll(".messages, .composer")) as HTMLElement[]
  ).map((node) => [node, node.scrollTop] as const);
  mount.classList.add("zai-root-floating");
  if (options.desktop) mount.classList.add("zai-root-desktop-floating");
  doc.documentElement?.append(mount);
  const initialPanel = mount.querySelector<HTMLElement>(":scope > .zai-app");
  if (initialPanel) arrange(initialPanel);
  for (const [node, top] of scrolls) node.scrollTop = top;
  mount.addEventListener("pointerdown", onPointerDown);
  mount.addEventListener("click", onClick);
  win.addEventListener("keydown", onKeyDown, true);
  mount.addEventListener("lostpointercapture", onCancel);
  win.addEventListener("pointermove", onPointerMove, true);
  win.addEventListener("pointerup", onPointerUp, true);
  win.addEventListener("pointercancel", onCancel, true);
  win.addEventListener("blur", onCancel);
  win.addEventListener("resize", onResize);

  return {
    arrange,
    refreshReaderAlignment,
    refresh(next) {
      if (next && !gesture) layout = copyLayout(next);
      apply();
    },
    setVisible(visible) {
      hidden.answer = hidden.composer = !visible;
      apply();
      options.onVisibilityChange();
    },
    showAnswer() {
      if (!hidden.answer && !answerCollapsed && !hidden.composer) return false;
      hidden.answer = hidden.composer = false;
      changePanelVisibility("answer", true);
      return true;
    },
    isHidden: () => hidden.answer && hidden.composer,
    destroy() {
      if (disposed) return;
      finish(true);
      disposed = true;
      readerAlignment.destroy();
      mount.removeEventListener("pointerdown", onPointerDown);
      mount.removeEventListener("click", onClick);
      win.removeEventListener("keydown", onKeyDown, true);
      mount.removeEventListener("lostpointercapture", onCancel);
      win.removeEventListener("pointermove", onPointerMove, true);
      win.removeEventListener("pointerup", onPointerUp, true);
      win.removeEventListener("pointercancel", onCancel, true);
      win.removeEventListener("blur", onCancel);
      win.removeEventListener("resize", onResize);
      const panel = mount.querySelector<HTMLElement>(":scope > .zai-app");
      if (panel?.classList.contains("zai-floating-app")) {
        const children = IDs.flatMap((id) =>
          Array.from(frame(id)?.children ?? []),
        );
        panel.replaceChildren(...children);
        panel.classList.remove("zai-floating-app");
      }
      mount.classList.remove("zai-root-floating", "zai-floating-gesturing");
      if (home)
        home.insertBefore(
          mount,
          homeNext?.parentNode === home ? homeNext : null,
        );
      else mount.remove();
    },
  };
}
