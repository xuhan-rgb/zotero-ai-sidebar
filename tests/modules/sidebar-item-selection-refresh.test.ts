import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

// Execute the actual hook without loading the Zotero host or unrelated sidebar modules.
const source = readFileSync('src/modules/sidebar.ts', 'utf8');
const hook = source.slice(source.indexOf('function patchItemSelection('),
  source.indexOf('\nfunction getSelectedItemID(', source.indexOf('function patchItemSelection(')));
const js = ts.transpileModule(hook, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function setup() {
  const mount = document.createElement('div');
  mount.innerHTML = '<div class="messages">Existing conversation</div>';
  const state = { mount };
  const panel = { itemID: 1 };
  let selected = 1;
  const render = vi.fn();
  const win = { ZoteroPane: { itemSelected: vi.fn(() => Promise.resolve(false)) } };
  new Function('states', 'safeSelectedItemID', 'renderWindowSidebar',
    `${js}; return patchItemSelection;`)(new Map([[mount, panel]]), () => selected, render)(win, state);
  return { win, render, mount, select: (id: number) => { selected = id; } };
}

describe('item selection refresh', () => {
  it('ignores repeated notifications for the displayed paper', async () => {
    const { win, render, mount } = setup();
    const messages = mount.firstChild;
    await win.ZoteroPane.itemSelected();
    await win.ZoteroPane.itemSelected();
    expect(render).not.toHaveBeenCalled();
    expect(mount.firstChild).toBe(messages);
  });
  it('refreshes when the selected paper changes', async () => {
    const { win, render, select } = setup();
    select(2);
    await win.ZoteroPane.itemSelected();
    expect(render).toHaveBeenCalledOnce();
  });
});

