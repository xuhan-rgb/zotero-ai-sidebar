import { linkWindowMinimization } from "./window-minimize-group";
import { uiText } from "../utils/ui-locale";

const installed = new Map<
  Window,
  { update(options: NotePinOptions): void; destroy(): void }
>();
let serial = 0;

const pending = new WeakMap<Window, Promise<void>>();

export function setNativeWindowPinned(
  win: Window,
  pinned: boolean,
): Promise<void> {
  const previous = pending.get(win) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => applyNativeWindowPin(win, pinned));
  pending.set(win, next);
  const clear = () => {
    if (pending.get(win) === next) pending.delete(win);
  };
  void next.then(clear, clear);
  return next;
}

/** EWMH toggles an existing Linux window without recreating its document/editor. */
async function applyNativeWindowPin(
  win: Window,
  pinned: boolean,
): Promise<void> {
  const zotero = Zotero as any;
  if (!zotero.isLinux || typeof zotero.Utilities?.Internal?.exec !== "function")
    throw new Error(
      uiText(
        "当前环境不支持即时切换窗口置顶",
        "Live window pinning is unavailable in this environment",
      ),
    );
  if (win.closed) throw new Error(uiText("窗口已关闭", "The window is closed"));
  const doc = win.document;
  const title = doc.title;
  // Exact, unique title matching never targets another Zotero or application window.
  const marker = `${title} [zai-pin-${Date.now()}-${++serial}]`;
  doc.title = marker;
  try {
    await new Promise<void>((resolve) => win.setTimeout(resolve, 0));
    if (win.closed)
      throw new Error(uiText("窗口已关闭", "The window is closed"));
    const ok = await zotero.Utilities.Internal.exec("/usr/bin/wmctrl", [
      "-F",
      "-r",
      marker,
      "-b",
      pinned ? "add,above" : "remove,above",
    ]);
    if (ok !== true)
      throw new Error(
        uiText(
          "无法切换窗口置顶，请确认窗口管理器支持此操作",
          "The window manager could not change the window's pinned state",
        ),
      );
  } finally {
    if (!win.closed && doc.title === marker) doc.title = title;
  }
}

interface NotePinOptions {
  host?: Window;
  pinned: boolean;
  onChange(pinned: boolean): void;
}

/** Adds one button beside the native note's menus, leaving its editor untouched. */
export function installNoteWindowPin(
  win: Window,
  options: NotePinOptions,
): void {
  const existing = installed.get(win);
  if (existing) {
    existing.update(options);
    return;
  }
  let current = options;
  let applied: boolean | undefined;
  let button: HTMLButtonElement | null = null;
  let spacer: Element | null = null;
  let disposed = false;
  const unlinkMinimization = options.host
    ? linkWindowMinimization(options.host, win)
    : () => {};
  const paint = () => {
    if (!button) return;
    button.setAttribute("aria-pressed", String(applied ?? current.pinned));
    button.textContent =
      (applied ?? current.pinned)
        ? uiText("取消置顶", "Unpin note")
        : uiText("置顶笔记", "Pin note");
    button.title = button.textContent;
    button.style.background =
      (applied ?? current.pinned) ? "#e3eddf" : "transparent";
    button.style.color = (applied ?? current.pinned) ? "#345e49" : "inherit";
  };
  const apply = async (pinned: boolean, save: boolean) => {
    if (!button || button.disabled || disposed) return;
    button.disabled = true;
    try {
      await setNativeWindowPinned(win, pinned);
      if (disposed) return;
      applied = pinned;
      if (save) {
        current = { ...current, pinned };
        current.onChange(pinned);
      }
      paint();
    } catch (error) {
      if (button) button.title = String(error);
      Zotero.debug(`[zai] note-window-pin: ${String(error)}`);
    } finally {
      if (button) button.disabled = false;
    }
  };
  const attach = () => {
    if (disposed || button || win.closed) return;
    const menu = win.document.querySelector("menubar");
    if (!menu) return;
    const doc = win.document;
    button = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "button",
    ) as HTMLButtonElement;
    button.id = "zai-note-window-pin";
    button.type = "button";
    button.setAttribute(
      "aria-label",
      uiText("置顶笔记窗口", "Keep note window on top"),
    );
    button.style.cssText =
      "align-self:center;margin:0 8px;padding:2px 7px;border:1px solid #cbd5c5;border-radius:5px;cursor:pointer;font:14px system-ui;";
    button.addEventListener("click", () => {
      void apply(!(applied ?? current.pinned), true);
    });
    spacer = doc.createElementNS(
      "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
      "spacer",
    );
    spacer.setAttribute("flex", "1");
    spacer.setAttribute("data-zai-note-pin-spacer", "");
    menu.append(spacer, button);
    paint();
    void apply(current.pinned, false);
  };
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    unlinkMinimization();
    win.removeEventListener("load", attach);
    win.removeEventListener("unload", destroy);
    button?.remove();
    spacer?.remove();
    installed.delete(win);
  };
  installed.set(win, {
    update(next) {
      current = next;
    },
    destroy,
  });
  win.addEventListener("load", attach);
  win.addEventListener("unload", destroy);
  attach();
}

export function removeNoteWindowPin(win: Window): void {
  installed.get(win)?.destroy();
}

export function clearNoteWindowPins(): void {
  for (const entry of [...installed.values()]) entry.destroy();
}
