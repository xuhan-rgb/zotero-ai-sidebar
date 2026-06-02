// note-autosave: debounced autosave of the dedicated note editor + dirty/save
// state tracking. Pure move from sidebar.ts.

import { editableNoteHTML, restoreEditableSelectionIfLost, saveEditableSelection } from "./note-html-utils";
import type { WindowSidebarState } from "./sidebar-state";

export function scheduleAutosaveNote(
  sidebar: WindowSidebarState,
  note: Zotero.Item,
  editor: HTMLElement,
  status: HTMLElement,
  saveButton: HTMLButtonElement,
) {
  const win = editor.ownerDocument?.defaultView;
  if (sidebar.noteAutosaveTimer && win) {
    win.clearTimeout(sidebar.noteAutosaveTimer);
  }
  if (!isNoteEditorDirty(editor)) {
    updateNoteSaveState(editor, saveButton);
    return;
  }
  status.textContent = "未保存";
  sidebar.noteAutosaveTimer = win?.setTimeout(() => {
    sidebar.noteAutosaveTimer = undefined;
    void autosaveNoteNow(sidebar, note, editor, status, saveButton);
  }, 1800);
}

export async function autosaveNoteNow(
  sidebar: WindowSidebarState,
  note: Zotero.Item,
  editor: HTMLElement,
  status: HTMLElement,
  saveButton: HTMLButtonElement,
) {
  const win = editor.ownerDocument?.defaultView;
  if (sidebar.noteAutosaveTimer && win) {
    win.clearTimeout(sidebar.noteAutosaveTimer);
    sidebar.noteAutosaveTimer = undefined;
  }
  if (!isNoteEditorDirty(editor)) {
    updateNoteSaveState(editor, saveButton);
    return;
  }
  if (sidebar.noteAutosavePromise) {
    await sidebar.noteAutosavePromise;
  }
  status.textContent = "保存中...";
  saveButton.disabled = true;
  const selection = saveEditableSelection(editor);
  sidebar.noteAutosavePromise = (async () => {
    const html = editableNoteHTML(editor);
    note.setNote(html || "<p></p>");
    await note.saveTx();
  })();
  try {
    await sidebar.noteAutosavePromise;
    editor.dataset.savedHTML = editableNoteHTML(editor);
    status.textContent = "已保存";
    updateNoteSaveState(editor, saveButton);
    restoreEditableSelectionIfLost(editor, selection);
  } catch (err) {
    status.textContent = "保存失败";
    status.title = err instanceof Error ? err.message : String(err);
    updateNoteSaveState(editor, saveButton);
    restoreEditableSelectionIfLost(editor, selection);
    throw err;
  } finally {
    sidebar.noteAutosavePromise = undefined;
  }
}

export function isNoteEditorDirty(editor: HTMLElement): boolean {
  return editableNoteHTML(editor) !== (editor.dataset.savedHTML ?? "");
}

export function updateNoteSaveState(
  editor: HTMLElement,
  saveButton: HTMLButtonElement,
) {
  const dirty = isNoteEditorDirty(editor);
  saveButton.disabled = !dirty;
  saveButton.title = dirty ? "保存当前修改 (Ctrl+S)" : "没有未保存修改";
}
