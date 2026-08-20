import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  preserveStreamingMessagesScroll,
  restoreMessagesScroll,
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
