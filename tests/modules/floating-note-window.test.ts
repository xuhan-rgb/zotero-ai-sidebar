import { usesNativeNoteWindow } from "../../src/settings/local-ui-settings";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync("src/modules/sidebar.ts", "utf8");
const js = ts.transpileModule(
  source.slice(
    source.indexOf("async function showNoteWindow("),
    source.indexOf("\nfunction renderNoteWindow("),
  ),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

function setup(
  mode: "floating" | "embedded" | "docked",
  modern = true,
  noteWindowMode: "inline" | "window" = "inline",
) {
  const sidebar: any = { mount: {}, noteMount: document.createElement("div") };
  const open = vi.fn(async () => undefined);
  const legacy = vi.fn();
  const save = vi.fn(async () => undefined);
  const close = vi.fn();
  const visible = vi.fn();
  const render = vi.fn();
  const dependencies = {
    usesNativeNoteWindow,
    findSidebarStateByDocument: () => sidebar,
    states: new Map([
      [
        sidebar.mount,
        { localUiSettings: { sidebarDisplayMode: mode, noteWindowMode } },
      ],
    ]),
    saveVisibleNoteBeforeSwitch: save,
    hostWindowForSidebar: () => ({
      ZoteroPane: modern
        ? { openNote: open, openNoteWindow: legacy }
        : { openNoteWindow: legacy },
    }),
    closeSidebarNoteColumn: close,
    updateOpenNoteButton: vi.fn(),
    setNoteColumnVisible: visible,
    renderNoteWindow: render,
    uiText: (zh: string) => zh,
  };
  const show = new Function(
    ...Object.keys(dependencies),
    `${js}; return showNoteWindow;`,
  )(...Object.values(dependencies));
  return {
    sidebar,
    open,
    legacy,
    save,
    close,
    visible,
    render,
    show: (note: object) => show(document, note),
  };
}

describe("floating notes use native Zotero windows", () => {
  it("flushes edits and opens the existing note through the native window API", async () => {
    const state = setup("floating");
    const note = { id: 42 };
    await state.show(note);
    expect(state.save).toHaveBeenCalledWith(state.sidebar);
    expect(state.open).toHaveBeenCalledExactlyOnceWith(42, {
      openInWindow: true,
    });
    expect(state.save.mock.invocationCallOrder[0]).toBeLessThan(
      state.open.mock.invocationCallOrder[0],
    );
    expect(state.close).toHaveBeenCalledWith(state.sidebar);
    expect(state.legacy).not.toHaveBeenCalled();
    expect(state.render).not.toHaveBeenCalled();
    expect(state.visible).not.toHaveBeenCalled();
  });

  it.each(["embedded", "docked"] as const)(
    "opens a separate note from %s when configured",
    async (mode) => {
      const state = setup(mode, true, "window");
      await state.show({ id: 42 });
      expect(state.open).toHaveBeenCalledExactlyOnceWith(42, {
        openInWindow: true,
      });
      expect(state.save).toHaveBeenCalledOnce();
      expect(state.close).toHaveBeenCalledOnce();
      expect(state.render).not.toHaveBeenCalled();
    },
  );

  it("supports the legacy native note-window API", async () => {
    const state = setup("floating", false);
    await state.show({ id: 42 });
    expect(state.legacy).toHaveBeenCalledExactlyOnceWith(42);
    expect(state.render).not.toHaveBeenCalled();
  });

  it.each(["embedded", "docked"] as const)(
    "keeps the existing note column for %s mode",
    async (mode) => {
      const state = setup(mode);
      const note = { id: 42 };
      await state.show(note);
      expect(state.sidebar.noteItemID).toBe(42);
      expect(state.visible).toHaveBeenCalledWith(state.sidebar, true);
      expect(state.render).toHaveBeenCalledWith(state.sidebar, note);
      expect(state.open).not.toHaveBeenCalled();
      expect(state.legacy).not.toHaveBeenCalled();
    },
  );

  it("does not close the inline editor if native opening fails", async () => {
    const state = setup("floating");
    state.open.mockRejectedValueOnce(new Error("native open failed"));
    await expect(state.show({ id: 42 })).rejects.toThrow("native open failed");
    expect(state.close).not.toHaveBeenCalled();
    expect(state.render).not.toHaveBeenCalled();
  });
});
