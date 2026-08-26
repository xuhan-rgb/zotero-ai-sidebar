import { describe, expect, it, vi } from "vitest";

import {
  clipboardPasteShortcut,
  readClipboardText,
  writeClipboard,
} from "../../web-agent/clipboard.mjs";

describe("Web Agent clipboard", () => {
  it("uses the native clipboard tools and paste shortcut on each platform", () => {
    const spawn = vi.fn(() => ({ status: 0, stdout: "copied", stderr: "" }));

    expect(readClipboardText({ platform: "linux", spawn })).toBe("copied");
    expect(spawn).toHaveBeenLastCalledWith(
      "xclip",
      ["-selection", "clipboard", "-o", "-target", "UTF8_STRING"],
      expect.objectContaining({ encoding: "utf8" }),
    );
    expect(clipboardPasteShortcut("linux")).toBe("Control+V");

    expect(readClipboardText({ platform: "darwin", spawn })).toBe("copied");
    expect(spawn).toHaveBeenLastCalledWith(
      "pbpaste",
      [],
      expect.objectContaining({ encoding: "utf8" }),
    );
    writeClipboard("text/uri-list", "file:///Users/ada/paper.pdf\r\n", {
      platform: "darwin",
      spawn,
    });
    expect(spawn).toHaveBeenLastCalledWith(
      "osascript",
      expect.arrayContaining(["--", "/Users/ada/paper.pdf"]),
      expect.objectContaining({ encoding: "utf8" }),
    );
    expect(clipboardPasteShortcut("darwin")).toBe("Meta+V");

    expect(readClipboardText({ platform: "win32", spawn })).toBe("copied");
    expect(spawn).toHaveBeenLastCalledWith(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"],
      expect.objectContaining({ encoding: "utf8" }),
    );
    writeClipboard("text/uri-list", "file:///C:/Users/Ada/paper.pdf\r\n", {
      platform: "win32",
      spawn,
    });
    expect(spawn).toHaveBeenLastCalledWith(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Set-Clipboard -LiteralPath $args[0]",
        "C:\\Users\\Ada\\paper.pdf",
      ],
      expect.objectContaining({ encoding: "utf8" }),
    );
    expect(clipboardPasteShortcut("win32")).toBe("Control+V");
  });
});
