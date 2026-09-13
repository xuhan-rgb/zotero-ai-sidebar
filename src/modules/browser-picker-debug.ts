import { debugZai } from "./debug-utils";
import { appendLocalPath } from "../utils/local-path";

const lines: string[] = [];
let sequence = 0;
let pending = Promise.resolve();

// Temporary, bounded diagnostics for native select/menu dismissal. No field values.
export function traceBrowserPicker(reason: string, menu: Element, event?: Event): void {
  const describe = (node: EventTarget | null | undefined) => {
    const el = node as Element | undefined;
    return el?.nodeType === 1 ? `${el.localName}.${el.getAttribute("class") ?? ""}` : null;
  };
  const rect = menu.getBoundingClientRect();
  const mouse = event as MouseEvent | undefined;
  const detail = {
    seq: ++sequence, time: new Date().toISOString(), reason,
    picker: menu.getAttribute("data-browser-debug-id"),
    open: menu.hasAttribute("open"), connected: menu.isConnected,
    event: event?.type, target: describe(event?.target),
    originalTarget: describe((event as Event & { originalTarget?: EventTarget })?.originalTarget),
    active: describe(menu.ownerDocument?.activeElement),
    path: event?.composedPath().map(describe).filter(Boolean),
    x: mouse?.clientX, y: mouse?.clientY,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
  debugZai("browser-picker", detail);
  lines.push(JSON.stringify(detail));
  if (lines.length > 300) lines.shift();
  const globals = globalThis as unknown as {
    Zotero?: { DataDirectory?: { dir?: string } };
    IOUtils?: { writeUTF8(path: string, text: string): Promise<unknown> };
  };
  const root = globals.Zotero?.DataDirectory?.dir;
  const io = globals.IOUtils;
  if (root && io) {
    pending = pending.then(async () => {
      await io.writeUTF8(appendLocalPath(root, "zai-browser-picker-debug.jsonl"), lines.join("\n") + "\n");
    }).catch(() => {});
  }
}
