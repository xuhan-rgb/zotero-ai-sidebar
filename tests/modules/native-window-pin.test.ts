import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearNoteWindowPins,
  installNoteWindowPin,
  setNativeWindowPinned,
} from "../../src/modules/native-window-pin";

let exec: ReturnType<typeof vi.fn>;
beforeEach(() => {
  exec = vi.fn(async () => true);
  vi.stubGlobal("Zotero", {
    isLinux: true,
    Utilities: { Internal: { exec } },
    debug: vi.fn(),
  });
  document.title = "AI 总结";
  document.body.innerHTML =
    "<menubar><menu>文件</menu><menu>编辑</menu></menubar><textarea>unsaved note</textarea>";
});
afterEach(() => {
  clearNoteWindowPins();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 10));
};

describe("native window pinning", () => {
  it("targets the exact native window and restores its title without taking focus", async () => {
    const focus = vi.spyOn(window, "focus");
    await setNativeWindowPinned(window, true);
    expect(exec).toHaveBeenCalledWith("/usr/bin/wmctrl", [
      "-F",
      "-r",
      expect.stringMatching(/^AI 总结 \[zai-pin-/),
      "-b",
      "add,above",
    ]);
    expect(document.title).toBe("AI 总结");
    expect(focus).not.toHaveBeenCalled();
    focus.mockRestore();
  });
  it("removes the above state and restores the title even when the manager fails", async () => {
    exec.mockResolvedValue(false);
    await expect(setNativeWindowPinned(window, false)).rejects.toThrow();
    expect(exec.mock.calls[0][1].at(-1)).toBe("remove,above");
    expect(document.title).toBe("AI 总结");
  });
  it("does not overwrite a note title changed during the operation", async () => {
    let finish!: (value: boolean) => void;
    exec.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = setNativeWindowPinned(window, true);
    await settle();
    document.title = "Renamed note";
    finish(true);
    await pending;
    expect(document.title).toBe("Renamed note");
  });
  it("serializes rapid changes while a streaming render rebuilds the menu", async () => {
    await Promise.all([
      setNativeWindowPinned(window, true),
      setNativeWindowPinned(window, false),
    ]);
    expect(exec.mock.calls.map((call) => call[1].at(-1))).toEqual([
      "add,above",
      "remove,above",
    ]);
    expect(document.title).toBe("AI 总结");
    for (const call of exec.mock.calls)
      expect(call[1][2].match(/zai-pin/g)).toHaveLength(1);
  });

  it("adds one note pin beside menus, persists toggles, and preserves the editor", async () => {
    const editor = document.querySelector("textarea")!;
    const onChange = vi.fn();
    installNoteWindowPin(window, { pinned: false, onChange });
    await settle();
    const button = document.getElementById(
      "zai-note-window-pin",
    ) as HTMLButtonElement;
    expect(button.parentElement?.tagName.toLowerCase()).toBe("menubar");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(
      button.previousElementSibling?.getAttribute("data-zai-note-pin-spacer"),
    ).toBe("");
    expect(button.previousElementSibling?.getAttribute("flex")).toBe("1");
    expect(button.parentElement?.lastElementChild).toBe(button);
    expect(exec.mock.calls[0][1].at(-1)).toBe("remove,above");
    expect(onChange).not.toHaveBeenCalled();
    button.click();
    await settle();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
    installNoteWindowPin(window, { pinned: true, onChange });
    expect(document.querySelectorAll("#zai-note-window-pin")).toHaveLength(1);
    expect(document.querySelector("textarea")).toBe(editor);
    expect(editor.value).toBe("unsaved note");
    clearNoteWindowPins();
    expect(document.getElementById("zai-note-window-pin")).toBeNull();
    expect(document.querySelector("[data-zai-note-pin-spacer]")).toBeNull();
    expect(document.querySelector("textarea")).toBe(editor);
  });
  it("retains the previous setting when toggling fails", async () => {
    const onChange = vi.fn();
    installNoteWindowPin(window, { pinned: false, onChange });
    await settle();
    exec.mockResolvedValue(false);
    const button = document.getElementById(
      "zai-note-window-pin",
    ) as HTMLButtonElement;
    button.click();
    await settle();
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(onChange).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
  });
});
