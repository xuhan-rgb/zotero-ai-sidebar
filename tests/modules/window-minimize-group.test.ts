import { afterEach, describe, expect, it, vi } from "vitest";
import {
  linkWindowMinimization,
  clearWindowMinimization,
} from "../../src/modules/window-minimize-group";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose();
});
function windowMock() {
  const win = Object.assign(new EventTarget(), {
    closed: false,
    windowState: 3,
    STATE_MINIMIZED: 2,
    STATE_MAXIMIZED: 1,
    minimize: vi.fn(),
    restore: vi.fn(),
    maximize: vi.fn(),
    focus: vi.fn(),
  });
  win.minimize.mockImplementation(() => {
    win.windowState = 2;
  });
  win.restore.mockImplementation(() => {
    win.windowState = 3;
  });
  win.maximize.mockImplementation(() => {
    win.windowState = 1;
  });
  return win;
}
function link(
  host: ReturnType<typeof windowMock>,
  child: ReturnType<typeof windowMock>,
) {
  cleanups.push(
    linkWindowMinimization(
      host as unknown as Window,
      child as unknown as Window,
    ),
  );
}
function state(win: ReturnType<typeof windowMock>, value: number) {
  win.windowState = value;
  win.dispatchEvent(new Event("sizemodechange"));
}

describe("PDF window minimization group", () => {
  it("minimizes chat and notes and restores them without forcing focus", () => {
    const host = windowMock(),
      chat = windowMock(),
      note = windowMock();
    link(host, chat);
    link(host, note);
    state(host, 2);
    state(host, 2);
    expect(chat.minimize).toHaveBeenCalledOnce();
    expect(note.minimize).toHaveBeenCalledOnce();
    state(host, 1);
    state(host, 3);
    expect(chat.restore).toHaveBeenCalledOnce();
    expect(note.restore).toHaveBeenCalledOnce();
    expect(chat.focus).not.toHaveBeenCalled();
    expect(note.focus).not.toHaveBeenCalled();
  });
  it("preserves windows minimized independently before the PDF", () => {
    const host = windowMock(),
      chat = windowMock(),
      note = windowMock();
    note.windowState = 2;
    link(host, chat);
    link(host, note);
    state(host, 2);
    state(host, 1);
    expect(chat.restore).toHaveBeenCalledOnce();
    expect(note.minimize).not.toHaveBeenCalled();
    expect(note.restore).not.toHaveBeenCalled();
  });
  it("includes a new note opened while the PDF is already minimized", () => {
    const host = windowMock(),
      note = windowMock();
    host.windowState = 2;
    link(host, note);
    expect(note.minimize).toHaveBeenCalledOnce();
    state(host, 1);
    expect(note.restore).toHaveBeenCalledOnce();
  });
  it("does not reopen closed windows or restore a manually restored child twice", () => {
    const host = windowMock(),
      chat = windowMock(),
      note = windowMock();
    link(host, chat);
    link(host, note);
    state(host, 2);
    note.closed = true;
    note.dispatchEvent(new Event("unload"));
    chat.windowState = 1;
    state(host, 1);
    expect(chat.restore).not.toHaveBeenCalled();
    expect(note.restore).not.toHaveBeenCalled();
  });
  it("removes listeners when the floating window exits or host closes", () => {
    const host = windowMock(),
      chat = windowMock();
    const dispose = linkWindowMinimization(
      host as unknown as Window,
      chat as unknown as Window,
    );
    dispose();
    dispose();
    state(host, 2);
    expect(chat.minimize).not.toHaveBeenCalled();
    host.windowState = 1;
    link(host, chat);
    host.dispatchEvent(new Event("unload"));
    state(host, 2);
    expect(chat.minimize).not.toHaveBeenCalled();
    host.windowState = 3;
    link(host, chat);
    clearWindowMinimization(host as unknown as Window);
    state(host, 2);
    expect(chat.minimize).not.toHaveBeenCalled();
  });
  it("preserves a note's maximized state when the PDF is restored", () => {
    const host = windowMock(),
      note = windowMock();
    note.windowState = 1;
    link(host, note);
    state(host, 2);
    state(host, 3);
    expect(note.maximize).toHaveBeenCalledOnce();
    expect(note.restore).not.toHaveBeenCalled();
    expect(note.windowState).toBe(1);
  });

  it("keeps separate PDF windows in separate groups", () => {
    const first = windowMock(),
      second = windowMock(),
      chat = windowMock(),
      note = windowMock();
    link(first, chat);
    link(second, note);
    state(first, 2);
    expect(chat.minimize).toHaveBeenCalledOnce();
    expect(note.minimize).not.toHaveBeenCalled();
    state(second, 2);
    state(first, 1);
    expect(chat.restore).toHaveBeenCalledOnce();
    expect(note.restore).not.toHaveBeenCalled();
  });
});
