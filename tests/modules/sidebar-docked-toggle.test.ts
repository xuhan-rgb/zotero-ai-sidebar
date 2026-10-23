import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as messageScroll from "../../src/modules/message-scroll";
import { states, type PanelState } from "../../src/modules/sidebar-state";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

const source = readFileSync("src/modules/sidebar.ts", "utf8");
const js = ts.transpileModule(
  source.slice(
    source.indexOf("function setColumnCollapsed("),
    source.indexOf("\nfunction hideCurrentSidebar("),
  ),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

function setup(noteWidth = 0) {
  let reserved = 484 + noteWidth;
  const mount = document.createElement("div");
  const messages = document.createElement("div");
  messages.className = "messages";
  mount.append(messages);
  document.body.append(mount);
  const sidebar: any = { mount, column: {}, collapsed: false };
  let contentHeight = 1600;
  Object.defineProperties(messages, {
    scrollHeight: { get: () => (sidebar.collapsed ? 0 : contentHeight) },
    clientHeight: { get: () => (sidebar.collapsed ? 0 : 400) },
  });
  const panelState = {
    localUiSettings: { sidebarDisplayMode: "docked" },
    activeConversationID: "a",
    messagesScrollTop: 600,
    autoFollowMessages: false,
  } as PanelState;
  messages.scrollTop = 600;
  states.set(mount, panelState);
  const layouts = new WeakMap<object, any>([
    [sidebar, { dockedColumnWidth: 480 }],
  ]);
  const resize = vi.fn((delta: number) => {
    win.innerWidth += delta;
    win.outerWidth += delta;
  });
  const win = {
    innerWidth: 1600,
    outerWidth: 1620,
    outerHeight: 900,
    resizeBy: resize,
    document: {
      documentElement: { style: { getPropertyValue: () => `${reserved}px` } },
    },
  };
  const leave = vi.fn(() => {
    sidebar.collapsed = true;
    layouts.delete(sidebar);
    reserved = 0;
    messages.scrollTop = 0;
    messageScroll.syncMessagesScrollState(mount);
  });
  const enter = vi.fn(() => {
    sidebar.collapsed = false;
    layouts.set(sidebar, { dockedColumnWidth: 480 });
    reserved = 484;
  });
  const deps = {
    states,
    preserveMessagesScrollOnToggle: (messageScroll as any)
      .preserveMessagesScrollOnToggle,
    dockedSidebarLayouts: layouts,
    loadReaderLayoutPrefs: () => ({ dockedAiWidth: 480 }),
    DOCKED_AI_SPLITTER_WIDTH: 4,
    measuredElementWidth: () => 480,
    isColumnCollapsed: () => sidebar.collapsed,
    leaveDockedSidebarLayout: leave,
    enterDockedSidebarLayout: enter,
    updateToggleButton: vi.fn(),
  };
  const toggle = new Function(
    ...Object.keys(deps),
    `${js}; return setColumnCollapsed;`,
  )(...Object.values(deps));
  return {
    win,
    sidebar,
    messages,
    panelState,
    growMessages: () => {
      contentHeight = 2000;
    },
    resize,
    leave,
    enter,
    toggle: (collapsed: boolean) => toggle(win, sidebar, collapsed),
    startCollapsed: () => {
      sidebar.collapsed = true;
      layouts.delete(sidebar);
      reserved = 0;
    },
    contentWidth: () => win.innerWidth - reserved,
  };
}

describe("docked chat visibility preserves the reader width", () => {
  it("restores the reading position after a long-hidden panel loses its DOM scroll offset", () => {
    vi.useFakeTimers();
    const { toggle, messages, panelState } = setup();
    toggle(true);
    vi.advanceTimersByTime(10000);
    expect(messages.scrollTop).toBe(0);
    toggle(false);
    expect(messages.scrollTop).toBe(600);
    expect(panelState.autoFollowMessages).toBe(false);
    messages.scrollTop = 0; // A delayed native layout pass after reparenting.
    vi.advanceTimersByTime(300);
    expect(messages.scrollTop).toBe(600);
  });

  it("follows the latest messages on reopen if the user was at the bottom", () => {
    vi.useFakeTimers();
    const { toggle, messages, panelState, growMessages } = setup();
    messages.scrollTop = 1200;
    panelState.autoFollowMessages = true;
    toggle(true);
    growMessages();
    vi.advanceTimersByTime(10000);
    toggle(false);
    expect(messages.scrollTop).toBe(1600);
    expect(panelState.autoFollowMessages).toBe(true);
  });

  it("does not restore another conversation's reading position", () => {
    vi.useFakeTimers();
    const { toggle, messages, panelState } = setup();
    toggle(true);
    panelState.activeConversationID = "b";
    messageScroll.resetMessagesScrollForConversation(panelState);
    toggle(false);
    expect(messages.scrollTop).toBe(1200);
  });

  it("shrinks on hide and expands right on show without changing reader width", () => {
    const { win, resize, toggle, contentWidth } = setup();
    const readerWidth = contentWidth();
    toggle(true);
    expect(resize).toHaveBeenLastCalledWith(-484, 0);
    expect(contentWidth()).toBe(readerWidth);
    expect(win.outerWidth).toBe(1136);
    toggle(false);
    expect(resize).toHaveBeenLastCalledWith(484, 0);
    expect(contentWidth()).toBe(readerWidth);
    expect(win.outerWidth).toBe(1620);
    toggle(true);
    toggle(false);
    expect(win.outerWidth).toBe(1620);
  });

  it("expands right on the first open after starting with chat hidden", () => {
    const { resize, toggle, startCollapsed, contentWidth } = setup();
    startCollapsed();
    const readerWidth = contentWidth();
    toggle(false);
    expect(resize).toHaveBeenLastCalledWith(484, 0);
    expect(contentWidth()).toBe(readerWidth);
  });

  it("does not resize twice for repeated hide/show commands", () => {
    const { resize, toggle } = setup();
    toggle(true);
    toggle(true);
    toggle(false);
    toggle(false);
    expect(resize.mock.calls).toEqual([
      [-484, 0],
      [484, 0],
    ]);
  });

  it("preserves manual reader resizing while chat is hidden", () => {
    const { win, toggle, contentWidth } = setup();
    toggle(true);
    win.innerWidth += 100;
    win.outerWidth += 100;
    const readerWidth = contentWidth();
    toggle(false);
    expect(contentWidth()).toBe(readerWidth);
  });

  it("removes the note area on hide and reopens only the AI area", () => {
    const { resize, toggle, contentWidth } = setup(304);
    const readerWidth = contentWidth();
    toggle(true);
    expect(resize).toHaveBeenLastCalledWith(-788, 0);
    expect(contentWidth()).toBe(readerWidth);
    toggle(false);
    expect(resize).toHaveBeenLastCalledWith(484, 0);
    expect(contentWidth()).toBe(readerWidth);
  });
});
