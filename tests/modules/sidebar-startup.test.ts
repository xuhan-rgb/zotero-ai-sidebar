import { readFileSync } from "node:fs";
import ts from "typescript";
import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync("src/modules/sidebar.ts", "utf8");
const registration = source.slice(
  source.indexOf("export function registerSidebarForWindow("),
  source.indexOf("\nfunction scheduleWindowRegisterRetry("),
);
const js = ts.transpileModule(registration, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;

function setup(mode: "embedded" | "docked", aiOpen = false) {
  const doc = new Window({ settings: { disableCSSFileLoading: true } })
    .document;
  const pane = doc.createElement("div");
  pane.id = "zotero-context-pane";
  doc.body.append(pane);
  (doc as any).createXULElement = (tag: string) => doc.createElement(tag);
  const win = { document: doc };
  const sidebars = new WeakMap();
  const states = new WeakMap();
  const reconcile = vi.fn((_win, sidebar) => {
    if (mode === "docked") sidebar.column.removeAttribute("collapsed");
  });
  const dependencies = {
    exports: {},
    registered: true,
    windowSidebars: sidebars,
    windowRegisterRetries: new WeakMap(),
    mountedWindows: new Set(),
    states,
    XHTML_NS: "http://www.w3.org/1999/xhtml",
    SPLITTER_ID: "zai-column-splitter",
    COLUMN_ID: "zai-column",
    NOTE_SPLITTER_ID: "zai-note-column-splitter",
    NOTE_COLUMN_ID: "zai-note-column",
    ROOT_ID: "zai-root",
    NOTE_ROOT_ID: "zai-note-root",
    DEFAULT_AI_COLUMN_WIDTH: 380,
    DEFAULT_NOTE_COLUMN_WIDTH: 560,
    MIN_AI_COLUMN_WIDTH: 320,
    MIN_NOTE_COLUMN_WIDTH: 260,
    MAX_AI_COLUMN_WIDTH: 760,
    MAX_NOTE_COLUMN_WIDTH: 700,
    addon: { data: { config: { addonRef: "zotero-ai-sidebar" } } },
    loadReaderLayoutPrefs: () => ({ aiWidth: 420, aiOpen }),
    renderWindowSidebar: () => {
      states.set(sidebars.get(win).mount, {
        localUiSettings: { sidebarDisplayMode: mode },
      });
    },
    reconcileSidebarDisplayMode: reconcile,
    isColumnCollapsed: (sidebar: any) =>
      sidebar.column.getAttribute("collapsed") === "true",
    ...Object.fromEntries(
      [
        "scheduleWindowRegisterRetry",
        "updateToggleButton",
        "syncFullTranslationHostLayout",
        "installReaderLayoutMemory",
        "installToggleButton",
        "installFloatingToggle",
        "patchItemSelection",
        "startSelectionMonitor",
        "installSidebarCopyHandler",
        "installSidebarSelectionMenu",
        "installReaderPromptShortcutHandler",
        "scheduleInitialSidebarRefresh",
      ].map((name) => [name, vi.fn()]),
    ),
  };
  const register = new Function(
    ...Object.keys(dependencies),
    `${js}; return registerSidebarForWindow;`,
  )(...Object.values(dependencies));
  register(win);
  return { sidebar: sidebars.get(win), register, win, doc, reconcile, states };
}

describe("sidebar startup", () => {
  it("round-trips the open state without losing saved widths", () => {
    let raw = JSON.stringify({ aiWidth: 420 });
    const prefsSource = source.slice(
      source.indexOf("function loadReaderLayoutPrefs("),
      source.indexOf("\nfunction syncReaderTranslateButtons("),
    );
    const prefsJs = ts.transpileModule(prefsSource, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const { load, save } = new Function(
      "Zotero",
      "READER_LAYOUT_PREF_KEY",
      "MIN_AI_COLUMN_WIDTH",
      "MAX_AI_COLUMN_WIDTH",
      "MIN_NOTE_COLUMN_WIDTH",
      "MAX_NOTE_COLUMN_WIDTH",
      `${prefsJs}; return { load: loadReaderLayoutPrefs, save: saveReaderLayoutPrefs };`,
    )(
      {
        Prefs: {
          get: () => raw,
          set: (_key: string, value: string) => {
            raw = value;
          },
        },
      },
      "readerLayout",
      320,
      760,
      260,
      700,
    );
    for (const aiOpen of [true, false]) {
      save({ aiOpen });
      expect(load()).toMatchObject({ aiOpen, aiWidth: 420 });
    }
  });

  it.each([true, false])(
    "saves open=%s on window close and before teardown",
    (aiOpen) => {
      const win = new Window({ settings: { disableCSSFileLoading: true } });
      const sidebar = {
        column: win.document.createElement("div"),
        splitter: win.document.createElement("div"),
        noteColumn: win.document.createElement("div"),
        noteSplitter: win.document.createElement("div"),
        layoutCleanup: undefined as undefined | (() => void),
      };
      const save = vi.fn();
      const memorySource = source.slice(
        source.indexOf("function installReaderLayoutMemory("),
        source.indexOf("\nfunction isNoteColumnVisible("),
      );
      const memoryJs = ts.transpileModule(memorySource, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText;
      new Function(
        "saveReaderLayoutPrefs",
        "isColumnCollapsed",
        "rememberLastAiWidth",
        "rememberLastNoteWidth",
        "syncFullTranslationHostLayout",
        `${memoryJs}; return installReaderLayoutMemory;`,
      )(
        save,
        () => !aiOpen,
        vi.fn(),
        vi.fn(),
        vi.fn(),
      )(win, sidebar);
      win.dispatchEvent(new win.Event("beforeunload"));
      expect(save).toHaveBeenLastCalledWith({ aiOpen });
      save.mockClear();
      sidebar.layoutCleanup?.();
      expect(save).toHaveBeenLastCalledWith({ aiOpen });
      save.mockClear();
      win.dispatchEvent(new win.Event("beforeunload"));
      expect(save).not.toHaveBeenCalled();
    },
  );

  it.each(["embedded", "docked"] as const)(
    "restores an open sidebar with %s layout selected",
    (mode) => {
      const { sidebar, reconcile } = setup(mode, true);
      expect(sidebar.column.hasAttribute("collapsed")).toBe(false);
      expect(sidebar.splitter.hasAttribute("hidden")).toBe(false);
      expect(reconcile).toHaveBeenCalledOnce();
    },
  );
  it.each(["embedded", "docked"] as const)(
    "starts collapsed with %s layout selected",
    (mode) => {
      const { sidebar, reconcile } = setup(mode);
      expect(sidebar.column.getAttribute("collapsed")).toBe("true");
      expect(sidebar.splitter.getAttribute("hidden")).toBe("true");
      expect(sidebar.column.getAttribute("width")).toBe("420");
      expect(reconcile).not.toHaveBeenCalled();
    },
  );

  it("does not reset an opened sidebar when registration repeats", () => {
    const { sidebar, register, win, doc } = setup("embedded");
    sidebar.column.removeAttribute("collapsed");
    register(win);
    expect(sidebar.column.hasAttribute("collapsed")).toBe(false);
    expect(doc.querySelectorAll("#zai-column")).toHaveLength(1);
  });

  it.each(["embedded", "docked"] as const)(
    "opens on demand using the saved %s layout",
    (mode) => {
      const { sidebar, win, states } = setup(mode);
      const toggleSource = source.slice(
        source.indexOf("function setColumnCollapsed("),
        source.indexOf("\nfunction hideCurrentSidebar("),
      );
      const toggleJs = ts.transpileModule(toggleSource, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText;
      const enterDocked = vi.fn();
      const toggle = new Function(
        "states",
        "enterDockedSidebarLayout",
        "leaveDockedSidebarLayout",
        "updateToggleButton",
        "renderWindowSidebar",
        "closeSidebarNoteColumn",
        `${toggleJs}; return setColumnCollapsed;`,
      )(states, enterDocked, vi.fn(), vi.fn(), vi.fn(), vi.fn());
      toggle(win, sidebar, false);
      if (mode === "docked") {
        expect(enterDocked).toHaveBeenCalledWith(win, sidebar);
      } else {
        expect(sidebar.column.hasAttribute("collapsed")).toBe(false);
        expect(sidebar.splitter.hasAttribute("hidden")).toBe(false);
        expect(enterDocked).not.toHaveBeenCalled();
      }
    },
  );
});
