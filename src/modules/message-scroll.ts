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

export function scrollMessagesToBottom(mount: HTMLElement) {
  const messages = mount.querySelector(".messages") as HTMLElement | null;
  if (!messages) return;
  messages.scrollTop = messages.scrollHeight;
  syncMessagesScrollState(mount);
}

export function syncMessagesScrollState(mount: HTMLElement) {
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
  const messages = mount.querySelector(".messages") as HTMLElement | null;
  if (!messages) return null;
  return {
    top: messages.scrollTop,
    atBottom: isMessagesElementNearBottom(messages),
  };
}

export function activeMessagesScrollLock(
  state: PanelState | undefined,
): MessagesScrollSnapshot | null {
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
  if (!snapshot) return;
  const messages = mount.querySelector(".messages") as HTMLElement | null;
  if (!messages) return;
  const maxTop = Math.max(0, messages.scrollHeight - messages.clientHeight);
  messages.scrollTop = snapshot.atBottom
    ? maxTop
    : Math.min(snapshot.top, maxTop);
  const state = states.get(mount);
  if (state) {
    state.messagesScrollTop = messages.scrollTop;
    state.autoFollowMessages = snapshot.atBottom;
  }
}

export function scheduleMessagesScrollRestore(
  mount: HTMLElement,
  snapshot: MessagesScrollSnapshot | null,
) {
  restoreMessagesScrollSnapshot(mount, snapshot);
  const win = mount.ownerDocument?.defaultView;
  if (!win) return;
  win.requestAnimationFrame(() => {
    restoreMessagesScrollSnapshot(mount, snapshot);
    win.requestAnimationFrame(() =>
      restoreMessagesScrollSnapshot(mount, snapshot),
    );
  });
  win.setTimeout(() => restoreMessagesScrollSnapshot(mount, snapshot), 0);
  win.setTimeout(() => restoreMessagesScrollSnapshot(mount, snapshot), 80);
  win.setTimeout(() => restoreMessagesScrollSnapshot(mount, snapshot), 250);
}

export function preserveMessagesScroll(
  mount: HTMLElement,
  mutate: () => void,
  snapshot = captureMessagesScrollSnapshot(mount),
) {
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
  const snapshot = captureMessagesScrollSnapshot(mount);
  mutate();
  if (!snapshot) return;
  const intended = followBottom ? { ...snapshot, atBottom: true } : snapshot;
  restoreMessagesScrollSnapshot(mount, intended);
  const win = mount.ownerDocument?.defaultView;
  if (!win) return;
  win.requestAnimationFrame(() => {
    const messages = mount.querySelector(".messages") as HTMLElement | null;
    if (!messages) return;
    if (followBottom || (snapshot.top > 0 && messages.scrollTop === 0)) {
      restoreMessagesScrollSnapshot(mount, intended);
    }
  });
}

export function isMessagesNearBottom(mount: HTMLElement): boolean {
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
