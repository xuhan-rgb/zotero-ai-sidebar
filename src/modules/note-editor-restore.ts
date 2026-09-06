import { closestElement as closestNoteElement } from "./dom-utils";
export interface ZoteroNoteEditorElement extends Element {
  mode?: string;
  viewMode?: string;
  item?: Zotero.Item;
  notitle?: boolean;
  focus?: () => Promise<void>;
  saveSync?: () => void;
  destroy?: () => void;
  initEditor?: (...args: unknown[]) => Promise<void> | void;
  getCurrentInstance?: () => { _iframeWindow?: Window } | null;
  _id?: (id: string) => Element | null;
  _zaiPdfJumpCleanup?: () => void;
  _zaiPdfJumpWindow?: Window;
  _zaiPointerMemoryCleanup?: () => void;
  _zaiCaretMemoryCleanup?: () => void;
  _zaiRestoreHookCleanup?: () => void;
}

export interface NoteEditorRestoreState {
  noteMount: HTMLElement;
  noteItemID?: number;
  notePointerSnapshot?: NotePointerSnapshot;
  noteCaretSnapshot?: NoteCaretSnapshot;
  noteRestoreSnapshot?: NoteScrollSnapshot;
  noteSuppressAutoFocusUntil?: number;
  noteCaretUserMovedAt?: number;
}

export interface NoteScrollSnapshot {
  top: number;
  left: number;
  windowX?: number;
  windowY?: number;
  pointer?: NotePointerSnapshot;
  caret?: NoteCaretSnapshot;
}

export interface NotePointerSnapshot {
  noteID?: number;
  text: string;
  blockIndex: number;
  viewportY: number;
  blockOffsetY: number;
  capturedAt: number;
}

export interface NoteCaretSnapshot {
  noteID?: number;
  anchor: number;
  head: number;
  from: number;
  to: number;
  docSize: number;
  empty: boolean;
  text: string;
  beforeText: string;
  afterText: string;
  capturedAt: number;
  restoredAt?: number;
}

const NOTE_ANCHOR_BLOCK_SELECTOR =
  "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, th, td, figure";
const NOTE_ANCHOR_TEXT_LIMIT = 260;

export function findActiveNoteEditor(
  sidebar: Pick<NoteEditorRestoreState, "noteMount">,
): ZoteroNoteEditorElement | null {
  const editor = sidebar.noteMount.querySelector(
    "note-editor",
  ) as ZoteroNoteEditorElement | null;
  return editor ?? null;
}

export function installZoteroNotePointerMemory(
  sidebar: NoteEditorRestoreState,
  editor: ZoteroNoteEditorElement,
) {
  const iframeWindow = editor.getCurrentInstance?.()?._iframeWindow;
  if (!iframeWindow || editor._zaiPointerMemoryCleanup) return;

  let lastMoveAt = 0;
  const rememberAt = (clientX: number, clientY: number) => {
    const snapshot = captureNotePointerSnapshot(
      iframeWindow.document,
      clientX,
      clientY,
      sidebar.noteItemID,
    );
    if (snapshot) sidebar.notePointerSnapshot = snapshot;
  };
  const onPointerMove = (event: PointerEvent) => {
    const now = Date.now();
    if (now - lastMoveAt < 140) return;
    lastMoveAt = now;
    rememberAt(event.clientX, event.clientY);
  };
  const onPointerDown = (event: PointerEvent) => {
    rememberAt(event.clientX, event.clientY);
  };
  const onClick = (event: MouseEvent) => {
    rememberAt(event.clientX, event.clientY);
  };
  const onWheel = (event: WheelEvent) => {
    const clientX = event.clientX;
    const clientY = event.clientY;
    iframeWindow.setTimeout(() => rememberAt(clientX, clientY), 0);
  };

  debugZai("note-restore.pointer-memory.installed", {
    noteID: sidebar.noteItemID,
    roots: noteEditorDebugRoots(editor),
  });
  iframeWindow.addEventListener("pointermove", onPointerMove, true);
  iframeWindow.addEventListener("pointerdown", onPointerDown, true);
  iframeWindow.addEventListener("click", onClick, true);
  iframeWindow.addEventListener("wheel", onWheel, true);
  editor._zaiPointerMemoryCleanup = () => {
    iframeWindow.removeEventListener("pointermove", onPointerMove, true);
    iframeWindow.removeEventListener("pointerdown", onPointerDown, true);
    iframeWindow.removeEventListener("click", onClick, true);
    iframeWindow.removeEventListener("wheel", onWheel, true);
  };
}

export function installZoteroNoteCaretMemory(
  sidebar: NoteEditorRestoreState,
  editor: ZoteroNoteEditorElement,
) {
  const iframeWindow = editor.getCurrentInstance?.()?._iframeWindow;
  const doc = iframeWindow?.document;
  if (!iframeWindow || !doc || editor._zaiCaretMemoryCleanup) return;

  const remember = () => {
    const snapshot = captureNoteCaretSnapshot(editor, sidebar.noteItemID);
    if (snapshot) sidebar.noteCaretSnapshot = snapshot;
  };
  const rememberSoon = () => iframeWindow.setTimeout(remember, 0);
  const markUserMovedCaret = () => {
    sidebar.noteCaretUserMovedAt = Date.now();
    rememberSoon();
  };

  iframeWindow.addEventListener("keydown", markUserMovedCaret, true);
  iframeWindow.addEventListener("keyup", rememberSoon, true);
  iframeWindow.addEventListener("pointerdown", markUserMovedCaret, true);
  iframeWindow.addEventListener("mouseup", rememberSoon, true);
  iframeWindow.addEventListener("pointerup", rememberSoon, true);
  iframeWindow.addEventListener("focusin", rememberSoon, true);
  doc.addEventListener("selectionchange", rememberSoon, true);
  debugZai("note-restore.caret-memory.installed", {
    noteID: sidebar.noteItemID,
  });
  rememberSoon();

  editor._zaiCaretMemoryCleanup = () => {
    iframeWindow.removeEventListener("keydown", markUserMovedCaret, true);
    iframeWindow.removeEventListener("keyup", rememberSoon, true);
    iframeWindow.removeEventListener("pointerdown", markUserMovedCaret, true);
    iframeWindow.removeEventListener("mouseup", rememberSoon, true);
    iframeWindow.removeEventListener("pointerup", rememberSoon, true);
    iframeWindow.removeEventListener("focusin", rememberSoon, true);
    doc.removeEventListener("selectionchange", rememberSoon, true);
  };
}

export function captureNoteCaretSnapshot(
  editor: ZoteroNoteEditorElement,
  noteID?: number,
): NoteCaretSnapshot | null {
  const core = zoteroNoteEditorCore(editor);
  const state = core?.view?.state;
  const selection = state?.selection;
  const doc = state?.doc;
  if (!selection || !doc) return null;

  const docSize = proseMirrorDocSize(doc);
  const anchor = clampProseMirrorPosition(
    finiteNumber(selection.anchor) ?? finiteNumber(selection.$anchor?.pos) ?? 0,
    docSize,
  );
  const head = clampProseMirrorPosition(
    finiteNumber(selection.head) ?? finiteNumber(selection.$head?.pos) ?? anchor,
    docSize,
  );
  const from = clampProseMirrorPosition(
    finiteNumber(selection.from) ?? Math.min(anchor, head),
    docSize,
  );
  const to = clampProseMirrorPosition(
    finiteNumber(selection.to) ?? Math.max(anchor, head),
    docSize,
  );
  return {
    noteID,
    anchor,
    head,
    from,
    to,
    docSize,
    empty: Boolean(selection.empty ?? from === to),
    text: proseMirrorTextBetween(doc, from, to).slice(0, 200),
    beforeText: proseMirrorTextBetween(
      doc,
      Math.max(0, from - 160),
      from,
    ).slice(-160),
    afterText: proseMirrorTextBetween(
      doc,
      to,
      Math.min(docSize, to + 160),
    ).slice(0, 160),
    capturedAt: Date.now(),
  };
}

export function notePointerSnapshotForSidebar(
  sidebar: NoteEditorRestoreState,
): NotePointerSnapshot | undefined {
  const pointer = sidebar.notePointerSnapshot;
  if (!pointer) return undefined;
  if (
    pointer.noteID != null &&
    sidebar.noteItemID != null &&
    pointer.noteID !== sidebar.noteItemID
  ) {
    return undefined;
  }
  return pointer;
}

export function noteCaretSnapshotForSidebar(
  sidebar: NoteEditorRestoreState,
): NoteCaretSnapshot | undefined {
  const caret = sidebar.noteCaretSnapshot;
  if (!caret) return undefined;
  if (
    caret.noteID != null &&
    sidebar.noteItemID != null &&
    caret.noteID !== sidebar.noteItemID
  ) {
    return undefined;
  }
  return caret;
}

export function noteScrollSnapshotDebugInfo(
  snapshot: NoteScrollSnapshot,
): Record<string, unknown> {
  return {
    top: snapshot.top,
    left: snapshot.left,
    windowX: snapshot.windowX,
    windowY: snapshot.windowY,
    pointer: snapshot.pointer
      ? notePointerSnapshotDebugInfo(snapshot.pointer)
      : null,
    caret: snapshot.caret ? noteCaretSnapshotDebugInfo(snapshot.caret) : null,
  };
}

export function noteCaretSnapshotDebugInfo(
  snapshot: NoteCaretSnapshot,
): Record<string, unknown> {
  return {
    noteID: snapshot.noteID,
    anchor: snapshot.anchor,
    head: snapshot.head,
    from: snapshot.from,
    to: snapshot.to,
    docSize: snapshot.docSize,
    empty: snapshot.empty,
    ageMs: Math.max(0, Date.now() - snapshot.capturedAt),
    restored: Boolean(snapshot.restoredAt),
    text: previewText(snapshot.text, 80),
    beforeText: previewText(snapshot.beforeText, 80),
    afterText: previewText(snapshot.afterText, 80),
  };
}

export function noteElementDebugInfo(
  element: HTMLElement,
): Record<string, unknown> {
  const rect = element.getBoundingClientRect();
  let overflowY = "";
  try {
    const computed =
      element.ownerDocument?.defaultView?.getComputedStyle(element);
    overflowY = computed?.getPropertyValue("overflow-y") ?? "";
  } catch {
    overflowY = "";
  }
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id || "",
    className: String(element.className || ""),
    scrollTop: Math.round(element.scrollTop),
    scrollHeight: Math.round(element.scrollHeight),
    clientHeight: Math.round(element.clientHeight),
    overflowY,
    rectTop: Math.round(rect.top),
    rectHeight: Math.round(rect.height),
  };
}

export function noteEditorDebugRoots(
  editor: ZoteroNoteEditorElement | null,
): Array<Record<string, unknown>> {
  const doc = editor?.getCurrentInstance?.()?._iframeWindow?.document;
  if (!doc) return [];
  return noteEditorScrollCandidates(doc).map((node) =>
    noteElementDebugInfo(node),
  );
}

export function restoreVisibleNoteScroll(
  sidebar: NoteEditorRestoreState,
  snapshot: NoteScrollSnapshot | null,
  reason = "restore",
) {
  if (!snapshot) {
    debugZai("note-restore.skip", { reason, noSnapshot: true });
    return;
  }
  const win = sidebar.noteMount.ownerDocument?.defaultView;
  let restoredPointer = false;
  let attempt = 0;
  const restore = () => {
    attempt++;
    const pointerRestored = Boolean(
      snapshot.pointer &&
        restoreVisibleNotePointer(
          sidebar,
          snapshot.pointer,
          `${reason}#${attempt}`,
        ),
    );
    if (pointerRestored) {
      restoredPointer = true;
      if (snapshot.caret) {
        restoreVisibleNoteCaret(sidebar, snapshot.caret, `${reason}#${attempt}`);
      }
      return;
    }
    if (restoredPointer) {
      if (snapshot.caret) {
        restoreVisibleNoteCaret(sidebar, snapshot.caret, `${reason}#${attempt}`);
      }
      return;
    }
    const editor = findActiveNoteEditor(sidebar);
    const iframeWin = editor?.getCurrentInstance?.()?._iframeWindow;
    const scrollRoot = noteEditorScrollRoot(editor);
    const target =
      scrollRoot ??
      (sidebar.noteMount.querySelector(
        ".zai-note-rich-editor",
      ) as HTMLElement | null);
    if (!target) {
      debugZai("note-restore.no-target", { reason, attempt });
      return;
    }
    target.scrollTop = snapshot.top;
    target.scrollLeft = snapshot.left;
    if (iframeWin && snapshot.windowY != null) {
      iframeWin.scrollTo(snapshot.windowX ?? 0, snapshot.windowY);
    }
    debugZai("note-restore.scrollTop", {
      reason,
      attempt,
      target: noteElementDebugInfo(target),
      snapshot: noteScrollSnapshotDebugInfo(snapshot),
      windowY: iframeWin?.scrollY,
    });
    if (snapshot.caret) {
      restoreVisibleNoteCaret(sidebar, snapshot.caret, `${reason}#${attempt}`);
    }
  };
  restore();
  win?.requestAnimationFrame(() => {
    restore();
    win.requestAnimationFrame(restore);
  });
  win?.setTimeout(restore, 0);
  win?.setTimeout(restore, 80);
  win?.setTimeout(restore, 250);
  win?.setTimeout(restore, 600);
  win?.setTimeout(restore, 1200);
  win?.setTimeout(restore, 2000);
}

export function noteEditorScrollRoot(
  editor: ZoteroNoteEditorElement | null,
): HTMLElement | null {
  const doc = editor?.getCurrentInstance?.()?._iframeWindow?.document;
  if (!doc) return null;
  return noteEditorScrollRootForDocument(doc);
}

export function tryInsertHTMLAtCursor(
  editor: ZoteroNoteEditorElement,
  html: string,
  caret: NoteCaretSnapshot | null | undefined = undefined,
): boolean {
  try {
    const core = zoteroNoteEditorCore(editor);
    if (!core?.view?.state || typeof core.insertHTML !== "function") {
      return false;
    }
    if (caret) {
      restoreCaretInZoteroNoteEditor(editor, caret, "import-selection");
    }
    // `undefined` takes Zotero's replaceSelection path, so the snippet lands
    // at the remembered caret instead of being appended after the current block.
    core.insertHTML(undefined, html);
    core.view?.focus?.();
    return true;
  } catch (err) {
    debugZai("import-selection:cursor-insert-failed", {
      error: errorMessage(err),
    });
    return false;
  }
}

export function noteAutoFocusSuppressed(
  sidebar: NoteEditorRestoreState,
): boolean {
  return Date.now() < (sidebar.noteSuppressAutoFocusUntil ?? 0);
}

function restoreVisibleNoteCaret(
  sidebar: NoteEditorRestoreState,
  snapshot: NoteCaretSnapshot,
  reason = "caret",
): boolean {
  if (snapshot.restoredAt) {
    return true;
  }
  if ((sidebar.noteCaretUserMovedAt ?? 0) > snapshot.capturedAt) {
    debugZai("note-restore.caret.skip-user-moved", {
      reason,
      movedAt: sidebar.noteCaretUserMovedAt,
      snapshot: noteCaretSnapshotDebugInfo(snapshot),
    });
    return false;
  }
  if (
    snapshot.noteID != null &&
    sidebar.noteItemID != null &&
    snapshot.noteID !== sidebar.noteItemID
  ) {
    debugZai("note-restore.caret.skip-note", {
      reason,
      snapshotNoteID: snapshot.noteID,
      currentNoteID: sidebar.noteItemID,
    });
    return false;
  }
  const editor = findActiveNoteEditor(sidebar);
  if (!editor) return false;
  if (!restoreCaretInZoteroNoteEditor(editor, snapshot, reason)) {
    return false;
  }
  snapshot.restoredAt = Date.now();
  return true;
}

function restoreCaretInZoteroNoteEditor(
  editor: ZoteroNoteEditorElement,
  snapshot: NoteCaretSnapshot,
  reason = "caret",
): boolean {
  const core = zoteroNoteEditorCore(editor);
  const view = core?.view;
  const state = view?.state;
  const doc = state?.doc;
  const transaction = state?.tr;
  if (!view || !state || !doc || !transaction) {
    debugZai("note-restore.caret.no-view", { reason });
    return false;
  }

  const docSize = proseMirrorDocSize(doc);
  const anchor = clampProseMirrorPosition(snapshot.anchor, docSize);
  const head = clampProseMirrorPosition(snapshot.head, docSize);
  const selection = createProseMirrorSelection(
    state.selection,
    doc,
    anchor,
    head,
    snapshot.empty,
  );
  if (!selection || typeof transaction.setSelection !== "function") {
    debugZai("note-restore.caret.no-selection", {
      reason,
      snapshot: noteCaretSnapshotDebugInfo(snapshot),
      docSize,
    });
    return false;
  }

  try {
    view.dispatch(transaction.setSelection(selection));
    view.focus?.();
    debugZai("note-restore.caret", {
      reason,
      anchor,
      head,
      docSize,
      snapshot: noteCaretSnapshotDebugInfo(snapshot),
    });
    return true;
  } catch (err) {
    debugZai("note-restore.caret.failed", {
      reason,
      error: errorMessage(err),
      snapshot: noteCaretSnapshotDebugInfo(snapshot),
      docSize,
    });
    return false;
  }
}

function createProseMirrorSelection(
  currentSelection: any,
  doc: any,
  anchor: number,
  head: number,
  empty: boolean,
): any {
  const SelectionCtor = currentSelection?.constructor;
  const docSize = proseMirrorDocSize(doc);
  const safeAnchor = clampProseMirrorPosition(anchor, docSize);
  const safeHead = clampProseMirrorPosition(head, docSize);

  try {
    if (
      !empty &&
      typeof SelectionCtor?.create === "function" &&
      Math.min(safeAnchor, safeHead) !== Math.max(safeAnchor, safeHead)
    ) {
      return SelectionCtor.create(
        doc,
        Math.min(safeAnchor, safeHead),
        Math.max(safeAnchor, safeHead),
      );
    }
  } catch {
    // Fall through to `near()`, which can recover if the old range vanished.
  }

  try {
    if (typeof SelectionCtor?.near === "function") {
      return SelectionCtor.near(
        doc.resolve(safeHead),
        safeHead >= safeAnchor ? 1 : -1,
      );
    }
  } catch {
    return null;
  }
  return null;
}

function restoreVisibleNotePointer(
  sidebar: NoteEditorRestoreState,
  snapshot: NotePointerSnapshot,
  reason = "pointer",
): boolean {
  if (
    snapshot.noteID != null &&
    sidebar.noteItemID != null &&
    snapshot.noteID !== sidebar.noteItemID
  ) {
    debugZai("note-restore.pointer.skip-note", {
      reason,
      snapshotNoteID: snapshot.noteID,
      currentNoteID: sidebar.noteItemID,
    });
    return false;
  }
  const editor = findActiveNoteEditor(sidebar);
  const iframeWin = editor?.getCurrentInstance?.()?._iframeWindow;
  const doc = iframeWin?.document;
  if (!iframeWin || !doc) {
    debugZai("note-restore.pointer.no-doc", { reason });
    return false;
  }

  const block = findNotePointerBlock(doc, snapshot);
  if (!block) {
    debugZai("note-restore.pointer.no-block", {
      reason,
      snapshot: notePointerSnapshotDebugInfo(snapshot),
      blocks: noteAnchorBlocks(doc).length,
    });
    return false;
  }
  const rect = block.getBoundingClientRect();
  const offsetY = Math.max(
    0,
    Math.min(snapshot.blockOffsetY, rect.height || 0),
  );
  const deltaY = rect.top + offsetY - snapshot.viewportY;
  if (!Number.isFinite(deltaY)) {
    debugZai("note-restore.pointer.bad-delta", {
      reason,
      snapshot: notePointerSnapshotDebugInfo(snapshot),
      block: noteElementDebugInfo(block),
    });
    return false;
  }
  if (Math.abs(deltaY) < 1) {
    debugZai("note-restore.pointer.already-at-target", {
      reason,
      block: noteElementDebugInfo(block),
      snapshot: notePointerSnapshotDebugInfo(snapshot),
    });
    return true;
  }

  const scrollRoot = noteEditorScrollRootForDocument(doc);
  if (
    scrollRoot &&
    scrollRoot !== doc.documentElement &&
    scrollRoot !== doc.body &&
    scrollRoot !== doc.scrollingElement
  ) {
    scrollRoot.scrollTop += deltaY;
  } else {
    iframeWin.scrollTo(iframeWin.scrollX, iframeWin.scrollY + deltaY);
  }
  debugZai("note-restore.pointer", {
    reason,
    deltaY,
    scrollRoot: scrollRoot ? noteElementDebugInfo(scrollRoot) : null,
    block: noteElementDebugInfo(block),
    snapshot: notePointerSnapshotDebugInfo(snapshot),
    windowY: iframeWin.scrollY,
  });
  return true;
}

function notePointerSnapshotDebugInfo(
  snapshot: NotePointerSnapshot,
): Record<string, unknown> {
  return {
    noteID: snapshot.noteID,
    blockIndex: snapshot.blockIndex,
    viewportY: Math.round(snapshot.viewportY),
    blockOffsetY: Math.round(snapshot.blockOffsetY),
    ageMs: Math.max(0, Date.now() - snapshot.capturedAt),
    text: previewText(snapshot.text, 120),
  };
}

function captureNotePointerSnapshot(
  doc: Document,
  clientX: number,
  clientY: number,
  noteID?: number,
): NotePointerSnapshot | null {
  const block = noteAnchorBlockFromPoint(doc, clientX, clientY);
  if (!block) return null;
  const text = normalizeNoteAnchorText(block.textContent || "");
  if (!text) return null;
  const blocks = noteAnchorBlocks(doc);
  const blockIndex = Math.max(0, blocks.indexOf(block));
  const rect = block.getBoundingClientRect();
  return {
    noteID,
    text: text.slice(0, NOTE_ANCHOR_TEXT_LIMIT),
    blockIndex,
    viewportY: clientY,
    blockOffsetY: Math.max(0, Math.min(clientY - rect.top, rect.height || 0)),
    capturedAt: Date.now(),
  };
}

function noteAnchorBlockFromPoint(
  doc: Document,
  clientX: number,
  clientY: number,
): HTMLElement | null {
  const hit = doc.elementFromPoint(clientX, clientY);
  const direct = closestNoteElement(
    hit,
    NOTE_ANCHOR_BLOCK_SELECTOR,
  ) as HTMLElement | null;
  if (direct && isUsableNoteAnchorBlock(direct)) return direct;

  return (
    noteAnchorBlocks(doc).find((block) => {
      const rect = block.getBoundingClientRect();
      return (
        clientY >= rect.top &&
        clientY <= rect.bottom &&
        clientX >= rect.left &&
        clientX <= rect.right
      );
    }) ?? null
  );
}

function noteAnchorBlocks(doc: Document): HTMLElement[] {
  const root = noteContentRoot(doc);
  const elements = Array.from(
    root.querySelectorAll(NOTE_ANCHOR_BLOCK_SELECTOR),
  ) as HTMLElement[];
  return elements.filter((element) => isUsableNoteAnchorBlock(element));
}

function noteContentRoot(doc: Document): HTMLElement {
  return ((
    doc.querySelector<HTMLElement>(".ProseMirror") ??
    doc.querySelector<HTMLElement>(".primary-editor") ??
    doc.querySelector<HTMLElement>(".note-editor") ??
    doc.body ??
    doc.documentElement
  ) as HTMLElement);
}

function isUsableNoteAnchorBlock(element: HTMLElement): boolean {
  if (!normalizeNoteAnchorText(element.textContent || "")) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function findNotePointerBlock(
  doc: Document,
  snapshot: NotePointerSnapshot,
): HTMLElement | null {
  const blocks = noteAnchorBlocks(doc);
  if (!blocks.length) return null;
  const target = normalizeNoteAnchorText(snapshot.text);
  let best: HTMLElement | null = null;
  let bestScore = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!;
    const score = noteAnchorMatchScore(
      normalizeNoteAnchorText(block.textContent || ""),
      target,
    );
    const distance = Math.abs(index - snapshot.blockIndex);
    if (
      score > bestScore ||
      (score === bestScore && distance < bestDistance)
    ) {
      best = block;
      bestScore = score;
      bestDistance = distance;
    }
  }

  if (best && bestScore > 0) return best;
  return blocks[snapshot.blockIndex] ?? null;
}

function noteAnchorMatchScore(blockText: string, target: string): number {
  if (!blockText || !target) return 0;
  if (blockText === target) return 1000;
  if (blockText.includes(target)) return 900 + Math.min(target.length, 90);
  if (target.includes(blockText) && blockText.length >= 16) {
    return 800 + Math.min(blockText.length, 80);
  }

  const head = target.slice(0, Math.min(100, target.length));
  if (head.length >= 16 && blockText.includes(head)) {
    return 700 + Math.min(head.length, 70);
  }
  const shorterHead = target.slice(0, Math.min(48, target.length));
  if (shorterHead.length >= 16 && blockText.includes(shorterHead)) {
    return 600 + Math.min(shorterHead.length, 48);
  }
  return 0;
}

function noteEditorScrollRootForDocument(doc: Document): HTMLElement | null {
  const candidates = noteEditorScrollCandidates(doc);
  return (
    candidates.find((node) => node.scrollHeight > node.clientHeight + 1) ??
    candidates[0] ??
    null
  );
}

function noteEditorScrollCandidates(doc: Document): HTMLElement[] {
  return [
    doc.querySelector<HTMLElement>(".editor-core"),
    doc.querySelector<HTMLElement>(".note-editor"),
    doc.querySelector<HTMLElement>(".editor-container"),
    doc.querySelector<HTMLElement>(".editor"),
    doc.querySelector<HTMLElement>(".primary-editor"),
    doc.querySelector<HTMLElement>(".ProseMirror"),
    doc.scrollingElement as HTMLElement | null,
    doc.documentElement,
    doc.body,
  ].filter((node): node is HTMLElement => !!node);
}

function zoteroNoteEditorCore(editor: ZoteroNoteEditorElement): any {
  const instance = editor.getCurrentInstance?.() as any;
  if (instance?._editorCore) return instance._editorCore;
  const iframeWin = instance?._iframeWindow as
    | (Window & { wrappedJSObject?: any })
    | undefined;
  const wrapped = iframeWin?.wrappedJSObject ?? iframeWin;
  return wrapped?._currentEditorInstance?._editorCore ?? null;
}

function proseMirrorDocSize(doc: any): number {
  return (
    finiteNumber(doc?.content?.size) ??
    Math.max(0, (finiteNumber(doc?.nodeSize) ?? 2) - 2)
  );
}

function proseMirrorTextBetween(doc: any, from: number, to: number): string {
  try {
    const docSize = proseMirrorDocSize(doc);
    const start = clampProseMirrorPosition(Math.min(from, to), docSize);
    const end = clampProseMirrorPosition(Math.max(from, to), docSize);
    if (end <= start || typeof doc?.textBetween !== "function") return "";
    return String(doc.textBetween(start, end, "\n", "\n"));
  } catch {
    return "";
  }
}

function clampProseMirrorPosition(position: number, docSize: number): number {
  const safeDocSize = Math.max(0, Number.isFinite(docSize) ? docSize : 0);
  const safePosition = Number.isFinite(position) ? position : 0;
  return Math.max(0, Math.min(safePosition, safeDocSize));
}

function normalizeNoteAnchorText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function debugZai(label: string, detail?: unknown): void {
  try {
    const suffix =
      detail === undefined
        ? ""
        : ` ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
    Zotero.debug(`[zai-debug] ${label}${suffix}`);
  } catch {
    // Diagnostics must not break note editing.
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function previewText(text: string, limit = 240): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > limit
    ? `${normalized.slice(0, limit)}...`
    : normalized;
}
