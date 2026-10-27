import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { renderMarkdownInto } from '../../src/modules/markdown-render';

const css = readFileSync('addon/content/sidebar.css', 'utf8');

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

function heading(role: 'user' | 'assistant'): HTMLElement {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  const bubble = document.createElement('div');
  bubble.className = `bubble bubble-${role}`;
  bubble.style.setProperty('--zai-chat-font-size', '14px');
  const body = document.createElement('div');
  body.className = 'bubble-body';
  renderMarkdownInto(body, 'Summarize this paper:\n\n## Research background and problem\n\n## Core method');
  bubble.append(body);
  document.body.append(bubble);
  return body.querySelector('h2')!;
}

describe('user message heading typography', () => {
  it('keeps prompt headings at the body font size with compact spacing', () => {
    const style = getComputedStyle(heading('user'));
    expect(style.fontSize).toBe('14px');
    expect(style.marginTop).toBe('6px');
    expect(style.marginBottom).toBe('4px');
  });

  it('preserves assistant answer heading sizes and spacing', () => {
    const style = getComputedStyle(heading('assistant'));
    expect(style.fontSize).toBe('16px');
    expect(style.marginTop).toBe('14px');
    expect(style.marginBottom).toBe('8px');
  });
});


describe('user message alignment', () => {
  it.each(['', 'zai-reading-tight'])('keeps user bubbles on the right in %s layout', (layout) => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    document.body.innerHTML = `<div id="zai-root" class="${layout}"><div class="messages"><div class="bubble bubble-user">hello</div><div class="bubble bubble-assistant">answer</div></div></div>`;
    const user = getComputedStyle(document.querySelector('.bubble-user')!);
    const assistant = getComputedStyle(document.querySelector('.bubble-assistant')!);
    expect(user.marginLeft).toBe('auto');
    expect(user.marginRight).toBe('0px');
    expect(assistant.width).toBe('100%');
    expect(assistant.marginLeft).toBe('0px');
  });
});
