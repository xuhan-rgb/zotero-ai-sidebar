import { resolveSidebarMount } from "./sidebar-mount";
// Scroll preservation for the chat messages list.
// =====================================================================
// CLAUDE.md rule: streaming output should auto-scroll only when the user
// is already near the bottom; if they've scrolled up, preserve their
// position while new chunks arrive.
//
// State lives in `state.messagesScrollTop` so it survives re-renders
// (every chunk triggers `renderPanel`). `state.autoFollowMessages` toggles
// based on near-bottom detection — once the user scrolls up, we don't
// re-engage auto-follow until they scroll back to the bottom themselves.
//
// Pure DOM/scroll helpers over a mount + PanelState — no Zotero runtime and
// no calls back into sidebar.ts, so they live in their own module.

import {
  states,
  type MessagesScrollSnapshot,
  type PanelState,
} from "./sidebar-state";

export function resetMessagesScrollForConversation(state: PanelState) {
  state.messagesScrollTop = 0;
  state.autoFollowMessages = true;
  state.scrollToBottom = true;
  // Discard the previous conversation and any empty history-loading frame.
  state.skipNextMessagesScrollCapture = true;
  state.messagesScrollLock = undefined;
  pendingRebuilds.delete(state);
  collapsedSnapshots.delete(state);
}

const scrollUpdates = new WeakMap<HTMLElement, object>();
const pendingLayouts = new WeakMap<HTMLElement, () => void>();

export function cancelMessagesScrollRestore(mount: HTMLElement) {
  mount = resolveSidebarMount(mount);
  pendingLayouts.get(mount)?.();
  scrollUpdates.delete(mount);
  const state = states.get(mount);
  if (!state) return;
  pendingRebuilds.delete(state);
  state.messagesScrollLock = undefined;
  state.scrollToBottom = false;
  state.autoFollowMessages = false;
  state.messagesScrollTop =
    mount.querySelector<HTMLElement>(".messages")?.scrollTop ??
    state.messagesScrollTop;
}

function beginScrollUpdate(mount: HTMLElement): () => boolean {
  mount = resolveSidebarMount(mount);
  pendingLayouts.get(mount)?.();
  const update = {};
  const messages = mount.querySelector(".messages");
  scrollUpdates.set(mount, update);
  return () =>
    scrollUpdates.get(mount) === update &&
    mount.querySelector(".messages") === messages;
}

export function scrollMessagesToBottom(mount: HTMLElement) {
  mount = resolveSidebarMount(mount);
  const messages = mount.querySelector(".messages") as HTMLElement | null;
  if (!messages) return;
  messages.scrollTop = messages.scrollHeight;
  syncMessagesScrollState(mount);
}

export function syncMessagesScrollState(mount: HTMLElement) {
  mount = resolveSidebarMount(mount);
  const state = states.get(mount);
  const messages = mount.querySelector(".messages") as HTMLElement | null;
  if (state && messages) {
    const lockedScroll = activeMessagesScrollLock(state);
    if (lockedScroll) {
      state.messagesScrollTop = lockedScroll.top;
      state.autoFollowMessages = lockedScroll.atBottom;
      return;
    }
    state.messagesScrollTop = messages.scrollTop;
  }
}

// Wraps a local DOM mutation (e.g. swapping a single bubble element) so the
// messages-list scroll position is preserved across the swap.
// WHY: Zotero/Firefox may collapse `.messages` scrollTop to 0 mid-mutation
// when a focused descendant is replaced; without this guard the chat
// visibly pages back to the top after operations like "save annotation".
// We restore both synchronously and on the next animation frame to cover
// async layout passes that arrive after the sync swap completes.
function captureMessagesScrollSnapshot(
  mount: HTMLElement,
): MessagesScrollSnapshot | null {
  mount = resolveSidebarMount(mount);
  const messages = mount.querySelector(".messages") as HTMLElement | null;
  if (!messages) return null;
  return {
    top: messages.scrollTop,
    atBottom: isMessagesElementNearBottom(messages),
  };
}

const collapsedSnapshots = new WeakMap<
  PanelState,
  {
    conversationID: string;
    networkTarget: PanelState["networkDiagramTarget"];
    snapshot: MessagesScrollSnapshot;
  }
>();

// Moving/hiding the column can reset scrollTop and emit scroll events. Keep a
// separate snapshot for the entire hidden interval, then restore after layout.
export function preserveMessagesScrollOnToggle(
  mount: HTMLElement,
  collapsed: boolean,
  changeVisibility: () => void,
  followLatest = false,
) {
  mount = resolveSidebarMount(mount);
  const state = states.get(mount);
  if (!state) return changeVisibility();
  const saved = collapsedSnapshots.get(state);
  const sameConversation =
    saved?.conversationID === state.activeConversationID &&
    saved?.networkTarget === state.networkDiagramTarget;
  if (collapsed) {
    if (!sameConversation) {
      const snapshot =
        activeMessagesScrollLock(state) ?? captureMessagesScrollSnapshot(mount);
      if (snapshot)
        collapsedSnapshots.set(state, {
          conversationID: state.activeConversationID,
          networkTarget: state.networkDiagramTarget,
          snapshot,
        });
    }
    changeVisibility();
    return;
  }
  collapsedSnapshots.delete(state);
  if (followLatest) pendingRebuilds.delete(state);
  const snapshot = followLatest
    ? { top: 0, atBottom: true }
    : sameConversation
      ? saved!.snapshot
      : state.networkDiagramTarget
        ? {
            top: state.networkDiagramMessagesScrollTop ?? 0,
            atBottom: state.networkDiagramAutoFollowMessages !== false,
          }
        : {
            top: state.messagesScrollTop,
            atBottom:
              !!state.scrollToBottom || state.autoFollowMessages !== false,
          };
  lockMessagesScroll(mount, snapshot, 300);
  changeVisibility();
  scheduleMessagesScrollRestore(mount, snapshot);
}

// A new message container starts at zero. Keep the pre-rebuild position until
// the latest render restores it, including when another render arrives first.
const pendingRebuilds = new WeakMap<
  PanelState,
  {
    conversationID: string;
    snapshot: MessagesScrollSnapshot;
  }
>();

export function prepareMessagesScrollRestore(state: PanelState) {
  const snapshot = activeMessagesScrollLock(state) ?? {
    top: state.messagesScrollTop,
    atBottom: !!state.scrollToBottom,
  };
  const pending = { conversationID: state.activeConversationID, snapshot };
  pendingRebuilds.set(state, pending);
  return (mount: HTMLElement, scrollToBottom: boolean) => {
    if (
      pendingRebuilds.get(state) !== pending ||
      state.activeConversationID !== pending.conversationID
    )
      return;
    pendingRebuilds.delete(state);
    const locked = activeMessagesScrollLock(state);
    if (locked || scrollToBottom || snapshot.atBottom) {
      scheduleMessagesScrollRestore(
        mount,
        locked ?? { ...snapshot, atBottom: true },
      );
    } else {
      restoreMessagesScrollSnapshot(mount, snapshot);
    }
  };
}

export function activeMessagesScrollLock(
  state: PanelState | undefined,
): MessagesScrollSnapshot | null {
  const pending = state && pendingRebuilds.get(state);
  if (pending && pending.conversationID === state?.activeConversationID) {
    return pending.snapshot;
  }
  if (!state?.messagesScrollLock) return null;
  if (Date.now() <= state.messagesScrollLock.until) {
    return state.messagesScrollLock.snapshot;
  }
  state.messagesScrollLock = undefined;
  return null;
}

export function lockMessagesScroll(
  mount: HTMLElement,
  snapshot: MessagesScrollSnapshot | null = captureMessagesScrollSnapshot(
    mount,
  ),
  durationMs = 3000,
): MessagesScrollSnapshot | null {
  mount = resolveSidebarMount(mount);
  const state = states.get(mount);
  if (state && snapshot) {
    state.messagesScrollLock = {
      snapshot,
      until: Date.now() + durationMs,
    };
    const win = mount.ownerDocument?.defaultView;
    win?.setTimeout(() => activeMessagesScrollLock(state), durationMs + 50);
  }
  return snapshot;
}

function restoreMessagesScrollSnapshot(
  mount: HTMLElement,
  snapshot: MessagesScrollSnapshot | null,
) {
  mount = resolveSidebarMount(mount);
  if (!snapshot) return;
  const messages = mount.querySelector(".messages") as HTMLElement | null;
  if (!messages) return;
  const maxTop = Math.max(0, messages.scrollHeight - messages.clientHeight);
  messages.scrollTop = snapshot.atBottom
    ? maxTop
    : Math.min(snapshot.top, maxTop);
  const state = states.get(mount);
  if (state) {
    if (messages.dataset.conversationKind === "network") {
      state.networkDiagramMessagesScrollTop = messages.scrollTop;
      state.networkDiagramAutoFollowMessages = snapshot.atBottom;
    } else {
      state.messagesScrollTop = messages.scrollTop;
      state.autoFollowMessages = snapshot.atBottom;
    }
  }
}

// A hidden/new chrome column can stay at zero height beyond the timed retries.
// Retain the requested position until real layout arrives, unless the user intervenes.
function waitForMessagesLayout(
  mount: HTMLElement,
  snapshot: MessagesScrollSnapshot | null,
  isCurrent: () => boolean,
) {
  const messages = mount.querySelector<HTMLElement>(".messages");
  const win = mount.ownerDocument?.defaultView;
  const ResizeObserverClass = win?.ResizeObserver;
  if (
    !snapshot ||
    !messages ||
    messages.clientHeight > 0 ||
    !ResizeObserverClass
  )
    return;
  const state = states.get(mount);
  const lock = { snapshot, until: Infinity };
  if (state) state.messagesScrollLock = lock;
  let stopped = false;
  const events = ["wheel", "touchstart", "mousedown", "keydown"];
  const stop = () => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    for (const event of events)
      messages.removeEventListener(event, cancel, true);
    if (state?.messagesScrollLock === lock)
      state.messagesScrollLock = undefined;
    if (pendingLayouts.get(mount) === stop) pendingLayouts.delete(mount);
  };
  const cancel = () => {
    if (isCurrent()) cancelMessagesScrollRestore(mount);
    else stop();
  };
  const observer = new ResizeObserverClass(() => {
    if (stopped) return;
    if (!isCurrent() || !messages.isConnected) return stop();
    if (messages.clientHeight <= 0 || messages.scrollHeight <= 0) return;
    restoreMessagesScrollSnapshot(mount, snapshot);
    stop();
  });
  pendingLayouts.set(mount, stop);
  for (const event of events) messages.addEventListener(event, cancel, true);
  observer.observe(messages);
  for (const child of messages.children) observer.observe(child);
}

export function scheduleMessagesScrollRestore(
  mount: HTMLElement,
  snapshot: MessagesScrollSnapshot | null,
) {
  mount = resolveSidebarMount(mount);
  const state = states.get(mount);
  const pending = state && pendingRebuilds.get(state);
  if (pending && pending.conversationID === state?.activeConversationID) return;
  const isCurrent = beginScrollUpdate(mount);
  const restore = () => {
    if (isCurrent()) restoreMessagesScrollSnapshot(mount, snapshot);
  };
  restore();
  const win = mount.ownerDocument?.defaultView;
  if (!win) return;
  win.requestAnimationFrame(() => {
    restore();
    win.requestAnimationFrame(restore);
  });
  win.setTimeout(restore, 0);
  win.setTimeout(restore, 80);
  win.setTimeout(restore, 250);
  waitForMessagesLayout(mount, snapshot, isCurrent);
}

export function preserveMessagesScroll(
  mount: HTMLElement,
  mutate: () => void,
  snapshot = captureMessagesScrollSnapshot(mount),
) {
  mount = resolveSidebarMount(mount);
  mutate();
  scheduleMessagesScrollRestore(mount, snapshot);
}

// Streaming repeatedly rebuilds the active bubble. Firefox can synchronously
// collapse the parent list to scrollTop=0 during replaceChildren(), and the
// scroll listener then persists that transient zero. Capture before the DOM
// mutation and restore immediately; the single guarded animation-frame retry
// covers a delayed layout collapse without continually fighting a user's
// deliberate scroll while tokens are arriving.
export function preserveStreamingMessagesScroll(
  mount: HTMLElement,
  followBottom: boolean,
  mutate: () => void,
) {
  mount = resolveSidebarMount(mount);
  beginScrollUpdate(mount);
  const snapshot = captureMessagesScrollSnapshot(mount);
  mutate();
  if (!snapshot) return;
  const intended = followBottom ? { ...snapshot, atBottom: true } : snapshot;
  restoreMessagesScrollSnapshot(mount, intended);
  const isCurrent = beginScrollUpdate(mount);
  const win = mount.ownerDocument?.defaultView;
  if (!win) return;
  win.requestAnimationFrame(() => {
    if (!isCurrent()) return;
    const messages = mount.querySelector(".messages") as HTMLElement | null;
    if (!messages) return;
    if (followBottom || (snapshot.top > 0 && messages.scrollTop === 0)) {
      restoreMessagesScrollSnapshot(mount, intended);
    }
  });
}

export function isMessagesNearBottom(mount: HTMLElement): boolean {
  mount = resolveSidebarMount(mount);
  const messages = mount.querySelector(".messages") as HTMLElement | null;
  if (!messages) return true;
  return isMessagesElementNearBottom(messages);
}

// 40px = roughly one body line of slack. Below this we treat the user as
// "at the bottom" and re-engage auto-follow. Tuned by hand: large enough
// to absorb sub-pixel scroll snap, small enough that scrolling up by one
// full message disengages follow mode.
export function isMessagesElementNearBottom(messages: HTMLElement): boolean {
  return (
    messages.scrollHeight - messages.scrollTop - messages.clientHeight < 40
  );
}

export function restoreSavedMessagesScroll(mount: HTMLElement) {
  mount = resolveSidebarMount(mount);
  const state = states.get(mount);
  const messages = mount.querySelector(".messages") as HTMLElement | null;
  if (!state || !messages) return;
  messages.scrollTop = state.messagesScrollTop;
}

export function restoreMessagesScroll(
  mount: HTMLElement,
  state: PanelState,
  scrollToBottom: boolean,
) {
  mount = resolveSidebarMount(mount);
  const messages = mount.querySelector(".messages") as HTMLElement | null;
  if (!messages) return;
  if (scrollToBottom) {
    scheduleMessagesScrollRestore(mount, {
      top: state.messagesScrollTop,
      atBottom: true,
    });
    return;
  }
  messages.scrollTop = state.messagesScrollTop;
}

// Preserve the independent scroll position inside a streaming thinking block.
export function preserveThinkingScroll(body: HTMLElement, mutate: () => void) {
  const top = body.scrollTop;
  const followBottom = isMessagesElementNearBottom(body);
  mutate();
  const maxTop = Math.max(0, body.scrollHeight - body.clientHeight);
  body.scrollTop = followBottom ? maxTop : Math.min(top, maxTop);
}
