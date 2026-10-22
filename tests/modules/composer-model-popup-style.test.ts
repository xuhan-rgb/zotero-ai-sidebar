import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

const css = readFileSync('addon/content/sidebar.css', 'utf8');

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe('composer model popup overflow', () => {
  it('lets the upward model menu escape the API actions row', () => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    document.body.innerHTML = `
      <div class="composer">
        <div class="input-row"><textarea></textarea></div>
        <div class="composer-footer composer-footer-status-empty">
          <div class="composer-send-mode"></div>
          <div class="composer-footer-actions composer-footer-actions-api">
            <div class="model-switcher">
              <button class="model-switcher-trigger" aria-expanded="true">Model A</button>
              <div class="model-switcher-popup" role="menu">
                <button class="model-switcher-item" role="menuitem">Model B</button>
              </div>
            </div>
          </div>
        </div>
      </div>`;

    const actions = document.querySelector('.composer-footer-actions')!;
    const popup = document.querySelector('.model-switcher-popup')!;
    expect(getComputedStyle(popup).position).toBe('absolute');
    expect(getComputedStyle(actions).flexWrap).toBe('wrap');
    expect(getComputedStyle(actions).overflow).toBe('visible');
  });
});
