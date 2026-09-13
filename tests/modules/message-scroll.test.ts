import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  prepareMessagesScrollRestore,
  resetMessagesScrollForConversation,
  preserveStreamingMessagesScroll,
  preserveThinkingScroll,
  restoreMessagesScroll,
  scheduleMessagesScrollRestore,
  syncMessagesScrollState,
} from '../../src/modules/message-scroll';
import {
  states,
  type PanelState,
} from '../../src/modules/sidebar-state';

describe('preserveStreamingMessagesScroll', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('does not let an older delayed restore undo newer streaming scroll', () => {
    vi.useFakeTimers();
    const mount = document.createElement('div');
    const messages = document.createElement('div');
    messages.className = 'messages';
    mount.append(messages);
    document.body.append(mount);
    Object.defineProperties(messages, {
      scrollHeight: { value: 1200 }, clientHeight: { value: 300 },
    });
    states.set(mount, { messagesScrollTop: 100, autoFollowMessages: false } as PanelState);
    scheduleMessagesScrollRestore(mount, { top: 100, atBottom: false });
    preserveStreamingMessagesScroll(mount, true, () => {});
    expect(messages.scrollTop).toBe(900);
    vi.advanceTimersByTime(300);
    expect(messages.scrollTop).toBe(900);
  });

  it('re-applies a requested startup scroll after delayed layout collapse', () => {
    vi.useFakeTimers();
    const mount = document.createElement('div');
    const messages = document.createElement('div');
    messages.className = 'messages';
    mount.append(messages);
    document.body.append(mount);
    let scrollHeight = 1200;
    Object.defineProperties(messages, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 300 },
    });
    const state = {
      messagesScrollTop: 0,
      autoFollowMessages: true,
    } as PanelState;
    states.set(mount, state);

    restoreMessagesScroll(mount, state, true);
    scrollHeight = 1800;
    messages.scrollTop = 0;
    state.messagesScrollTop = 0;
    vi.advanceTimersByTime(100);

    expect(messages.scrollTop).toBe(1500);
    expect(state.messagesScrollTop).toBe(1500);
  });

  it('restores a pinned chat when a bubble mutation collapses scrollTop to zero', () => {
    const mount = document.createElement('div');
    const messages = document.createElement('div');
    messages.className = 'messages';
    mount.append(messages);
    document.body.append(mount);
    Object.defineProperties(messages, {
      scrollHeight: { configurable: true, value: 1200 },
      clientHeight: { configurable: true, value: 300 },
    });
    messages.scrollTop = 640;
    const state = {
      messagesScrollTop: 640,
      autoFollowMessages: false,
    } as PanelState;
    states.set(mount, state);

    preserveStreamingMessagesScroll(mount, false, () => {
      messages.scrollTop = 0;
      syncMessagesScrollState(mount);
    });

    expect(messages.scrollTop).toBe(640);
    expect(state.messagesScrollTop).toBe(640);
    expect(state.autoFollowMessages).toBe(false);
  });

  it('keeps following the bottom when a streaming mutation collapses scrollTop', () => {
    const mount = document.createElement('div');
    const messages = document.createElement('div');
    messages.className = 'messages';
    mount.append(messages);
    document.body.append(mount);
    Object.defineProperties(messages, {
      scrollHeight: { configurable: true, value: 1200 },
      clientHeight: { configurable: true, value: 300 },
    });
    messages.scrollTop = 900;
    const state = {
      messagesScrollTop: 900,
      autoFollowMessages: true,
    } as PanelState;
    states.set(mount, state);

    preserveStreamingMessagesScroll(mount, true, () => {
      messages.scrollTop = 0;
      syncMessagesScrollState(mount);
    });

    expect(messages.scrollTop).toBe(900);
    expect(state.messagesScrollTop).toBe(900);
    expect(state.autoFollowMessages).toBe(true);
  });
});


describe('thinking block auto-follow', () => {
  it.each([
    [700, 1200],
    [300, 300],
    [0, 0],
  ])('preserves intent from scrollTop %i when content grows', (top, expected) => {
    const body = document.createElement('div');
    let height = 1000;
    Object.defineProperties(body, {
      scrollHeight: { get: () => height },
      clientHeight: { value: 300 },
    });
    body.scrollTop = top;
    preserveThinkingScroll(body, () => {
      height = 1500;
      body.scrollTop = 0; // Firefox can reset it during Markdown replacement.
    });
    expect(body.scrollTop).toBe(expected);
  });

  it('follows when the first overflowing content arrives', () => {
    const body = document.createElement('div');
    let height = 200;
    Object.defineProperties(body, {
      scrollHeight: { get: () => height },
      clientHeight: { value: 300 },
    });
    preserveThinkingScroll(body, () => { height = 600; });
    expect(body.scrollTop).toBe(300);
  });
});


describe('panel rebuild scroll snapshot', () => {
  it('keeps the original position across consecutive replacements before restoration', () => {
    const mount = document.createElement('div');
    const state = { messagesScrollTop: 640, autoFollowMessages: false,
      activeConversationID: 'a' } as PanelState;
    states.set(mount, state);
    const replace = () => {
      const messages = document.createElement('div');
      messages.className = 'messages';
      Object.defineProperties(messages, {
        scrollHeight: { value: 2000 }, clientHeight: { value: 300 },
      });
      mount.replaceChildren(messages);
      return messages;
    };
    const first = prepareMessagesScrollRestore(state);
    replace();
    syncMessagesScrollState(mount);
    expect(state.messagesScrollTop).toBe(640);
    const second = prepareMessagesScrollRestore(state);
    const messages = replace();
    first(mount, false);
    expect(messages.scrollTop).toBe(0);
    second(mount, false);
    expect(messages.scrollTop).toBe(640);
    messages.scrollTop = 320;
    syncMessagesScrollState(mount);
    expect(state.messagesScrollTop).toBe(320);
  });

  it('does not reuse a snapshot from another conversation', () => {
    const state = { messagesScrollTop: 640, activeConversationID: 'a' } as PanelState;
    prepareMessagesScrollRestore(state);
    state.activeConversationID = 'b';
    state.messagesScrollTop = 90;
    const restore = prepareMessagesScrollRestore(state);
    const mount = document.createElement('div');
    const messages = document.createElement('div');
    messages.className = 'messages';
    Object.defineProperties(messages, {
      scrollHeight: { value: 2000 }, clientHeight: { value: 300 },
    });
    mount.append(messages);
    states.set(mount, state);
    restore(mount, false);
    expect(messages.scrollTop).toBe(90);
  });
});


it('opens a switched conversation at the end instead of restoring its old position', () => {
  const state = { messagesScrollTop: 640, autoFollowMessages: false } as PanelState;
  resetMessagesScrollForConversation(state);
  expect(state.messagesScrollTop).toBe(0);
  expect(state.scrollToBottom).toBe(true);
  expect(state.skipNextMessagesScrollCapture).toBe(true);
});

it('still follows an explicit request to show the latest message after a rebuild', () => {
  vi.useFakeTimers();
  try {
    const mount = document.createElement('div');
    const state = { messagesScrollTop: 640, activeConversationID: 'a' } as PanelState;
    states.set(mount, state);
    const restore = prepareMessagesScrollRestore(state);
    const messages = document.createElement('div');
    messages.className = 'messages';
    Object.defineProperties(messages, {
      scrollHeight: { value: 2000 }, clientHeight: { value: 300 },
    });
    mount.append(messages);
    restore(mount, true);
    expect(messages.scrollTop).toBe(1700);
    vi.runAllTimers();
  } finally {
    vi.useRealTimers();
  }
});

it('retains a pending bottom request when another render arrives before the first frame', () => {
  vi.useFakeTimers();
  try {
    const mount = document.createElement('div');
    const state = { messagesScrollTop: 0, activeConversationID: 'a',
      scrollToBottom: true } as PanelState;
    states.set(mount, state);
    prepareMessagesScrollRestore(state);
    state.scrollToBottom = false;
    const restore = prepareMessagesScrollRestore(state);
    const messages = document.createElement('div');
    messages.className = 'messages';
    Object.defineProperties(messages, {
      scrollHeight: { value: 2000 }, clientHeight: { value: 300 },
    });
    mount.append(messages);
    restore(mount, false);
    expect(messages.scrollTop).toBe(1700);
    vi.runAllTimers();
  } finally {
    vi.useRealTimers();
  }
});

it('discards an empty loading frame snapshot when history loads the same conversation', () => {
  const mount = document.createElement('div');
  const state = { itemID: 1, activeConversationID: 'default', historyLoaded: true,
    messagesScrollTop: 640, autoFollowMessages: false } as PanelState;
  states.set(mount, state);
  state.messagesScrollTop = 0;
  const stale = prepareMessagesScrollRestore(state);
  resetMessagesScrollForConversation(state);
  const restore = prepareMessagesScrollRestore(state);
  const messages = document.createElement('div');
  messages.className = 'messages';
  Object.defineProperties(messages, {
    scrollHeight: { value: 2000 }, clientHeight: { value: 300 },
  });
  mount.append(messages);
  stale(mount, false);
  restore(mount, true);
  expect(messages.scrollTop).toBe(1700);
});
