import { spawnSync } from "node:child_process";
import process from "node:process";
import { URL } from "node:url";

export function readClipboardText(options = {}) {
  const platform = options.platform || process.platform;
  const spawn = options.spawn || spawnSync;
  try {
    const command = readCommand(platform);
    const result = spawn(command.executable, command.args, {
      encoding: "utf8",
      timeout: 3_000,
    });
    return result.status === 0 ? result.stdout || "" : "";
  } catch {
    return "";
  }
}

export function writeClipboard(target, input, options = {}) {
  const platform = options.platform || process.platform;
  const spawn = options.spawn || spawnSync;
  const command = writeCommand(platform, target, input);
  const result = spawn(command.executable, command.args, {
    input: command.input,
    encoding: "utf8",
    timeout: 3_000,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `${command.executable} failed`);
  }
}

export function clipboardPasteShortcut(platform = process.platform) {
  return platform === "darwin" ? "Meta+V" : "Control+V";
}

function readCommand(platform) {
  if (platform === "darwin") return { executable: "pbpaste", args: [] };
  if (platform === "win32") {
    return {
      executable: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"],
    };
  }
  return {
    executable: "xclip",
    args: ["-selection", "clipboard", "-o", "-target", "UTF8_STRING"],
  };
}

function writeCommand(platform, target, input) {
  const filePath =
    target === "text/uri-list" ? uriListPath(input, platform) : "";
  if (platform === "darwin") {
    if (filePath) {
      return {
        executable: "osascript",
        args: [
          "-e",
          "on run argv",
          "-e",
          "set the clipboard to POSIX file (item 1 of argv)",
          "-e",
          "end run",
          "--",
          filePath,
        ],
      };
    }
    return { executable: "pbcopy", args: [], input };
  }
  if (platform === "win32") {
    if (filePath) {
      return {
        executable: "powershell.exe",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Set-Clipboard -LiteralPath $args[0]",
          filePath,
        ],
      };
    }
    return {
      executable: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Console]::In.ReadToEnd() | Set-Clipboard",
      ],
      input,
    };
  }
  return {
    executable: "xclip",
    args: ["-selection", "clipboard", "-i", "-target", target],
    input,
  };
}

function uriListPath(input, platform) {
  const raw = String(input)
    .split(/\r?\n/)
    .find((line) => line && !line.startsWith("#"));
  if (!raw) return "";
  const url = new URL(raw);
  if (url.protocol !== "file:") return "";
  let pathname = decodeURIComponent(url.pathname);
  if (platform === "win32") {
    pathname = pathname.replace(/^\/([A-Za-z]:\/)/, "$1").replace(/\//g, "\\");
  }
  return pathname;
}
