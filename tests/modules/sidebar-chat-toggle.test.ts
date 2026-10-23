import { readFileSync } from "node:fs";
import ts from "typescript";
import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync("src/modules/sidebar.ts", "utf8");
const toggleSource = source.slice(
  source.indexOf("function updateToggleButton("),
  source.indexOf("// Monkey-patches `ZoteroPane.itemSelected`"),
);
const js = ts.transpileModule(
  source.slice(
    source.indexOf("function installFloatingToggle("),
    source.indexOf("\nfunction setColumnCollapsed("),
  ) + toggleSource,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

function setup() {
  const host = new Window();
  host.document.body.innerHTML =
    '<div id="zotero-pane-stack"></div><div id="zotero-tabs-toolbar"><button class="tabs-menu">Tabs</button></div>';
  const reader = new Window();
  reader.document.body.innerHTML =
    '<div class="toolbar"><div class="end"><button class="find">Search</button><button class="context-pane-toggle">Sidebar</button></div></div>';
  const mount = host.document.createElement("div");
  mount.innerHTML = '<button class="zai-collapse-btn">»</button>';
  host.document.body.append(mount);
  const state: any = { mount, collapsed: true };
  const toggle = vi.fn();
  const controls = new Function(
    "XHTML_NS",
    "FLOATING_TOGGLE_ID",
    "addon",
    "uiText",
    "getActiveReader",
    "activeReaderWindows",
    "setColumnCollapsed",
    "isColumnCollapsed",
    `${js}; return { install: installFloatingToggle, update: updateToggleButton };`,
  )(
    "http://www.w3.org/1999/xhtml",
    "zai-floating-toggle",
    { data: { config: { addonRef: "zai" } } },
    (zh: string) => zh,
    () => reader,
    (r: Window) => [r],
    toggle,
    () => state.collapsed,
  );
  return {
    host,
    reader,
    state,
    toggle,
    install: () => controls.install(host, state),
    update: () => controls.update(state),
  };
}

describe("reader AI chat entry", () => {
  it("occupies its own toolbar slot before native controls, without an overlay", () => {
    const { host, reader, state, toggle, install } = setup();
    install();
    const end = reader.document.querySelector(".toolbar .end")!;
    expect(state.floatingButton?.parentElement).toBe(end);
    expect(end.children[1].className).toBe("find");
    expect(end.children[2].className).toBe("context-pane-toggle");
    expect(host.document.querySelector("#zai-floating-toggle")).toBeNull();
    expect(state.floatingButton.style.position).not.toBe("fixed");
    expect(state.floatingButton.style.position).not.toBe("absolute");
    state.floatingButton.click();
    expect(toggle).toHaveBeenCalledWith(host, state, false);
  });

  it("keeps a visible vector AI label when toolbar text styling suppresses glyphs", () => {
    const { reader, state, install } = setup();
    const style = reader.document.createElement("style");
    style.textContent =
      ".toolbar { font-size: 0; } .toolbar-button { color: transparent !important; text-indent: -9999px; }";
    reader.document.head.append(style);
    install();
    const button = state.floatingButton;
    expect(button.classList.contains("toolbar-button")).toBe(false);
    const label = button.querySelector("svg");
    expect(label?.getAttribute("width")).toBe("18");
    expect(label?.getAttribute("height")).toBe("14");
    expect(label?.querySelector("path")?.getAttribute("fill")).toBe("#a94e25");
    expect(label?.querySelector("path")?.getAttribute("d")).toContain("M7.2");
    expect(label?.querySelector("text")).toBeNull();
    expect(button.getAttribute("aria-label")).toContain("AI");
  });

  it("keeps AI available when chat is open and hides the duplicate collapse control", () => {
    const { host, state, toggle, install, update } = setup();
    install();
    state.collapsed = false;
    update();
    expect(state.floatingButton.hidden).toBe(false);
    expect(state.floatingButton.getAttribute("aria-pressed")).toBe("true");
    expect(state.mount.querySelector(".zai-collapse-btn").hidden).toBe(true);
    state.floatingButton.click();
    expect(toggle).toHaveBeenLastCalledWith(host, state, true);
    state.collapsed = true;
    update();
    expect(state.floatingButton.hidden).toBe(false);
    expect(state.floatingButton.getAttribute("aria-pressed")).toBe("false");
  });

  it("reuses the entry and restores it after a toolbar rebuild", () => {
    const { reader, state, install } = setup();
    install();
    const button = state.floatingButton;
    install();
    expect(state.floatingButton).toBe(button);
    reader.document.querySelector(".end")!.replaceChildren();
    install();
    expect(state.floatingButton.isConnected).toBe(true);
    expect(
      reader.document.querySelectorAll("#zai-floating-toggle"),
    ).toHaveLength(1);
  });

  it("moves AI to the upper toolbar when narrow, without hiding it or native controls", () => {
    const { host, reader, state, toggle, install } = setup();
    let resize = () => {};
    const disconnect = vi.fn();
    (reader as any).ResizeObserver = class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    };
    const toolbar = reader.document.querySelector(".toolbar")!;
    const end = reader.document.querySelector(".end")!;
    const upper = host.document.querySelector("#zotero-tabs-toolbar")!;
    // Gecko chrome documents reject adoption across docgroups; happy-dom
    // otherwise silently adopts and would miss the real Zotero failure.
    for (const target of [end, upper]) {
      const prepend = target.prepend.bind(target);
      target.prepend = (...nodes) => {
        if (
          nodes.some(
            (node) =>
              typeof node !== "string" &&
              node.ownerDocument !== target.ownerDocument,
          )
        ) {
          throw new reader.DOMException(
            "Element.prepend: Adopting nodes across docgroups in chrome documents is unsupported",
            "SecurityError",
          );
        }
        prepend(...nodes);
      };
    }
    let width = 120;
    Object.defineProperty(toolbar, "clientWidth", { get: () => width });
    end.getBoundingClientRect = () =>
      ({
        width: 100 + (end.querySelector(".zai-reader-chat-toggle") ? 36 : 0),
      }) as DOMRect;
    install();
    const button = state.floatingButton;
    expect(button.parentElement).toBe(upper);
    expect(button.querySelector("svg path")).not.toBeNull();
    expect(button.hidden).toBe(false);
    expect(button.style.display).not.toBe("none");
    expect(state.mount.querySelector(".zai-collapse-btn").hidden).toBe(true);
    expect(Array.from(end.children).map((child) => child.className)).toEqual([
      "find",
      "context-pane-toggle",
    ]);
    resize();
    install();
    expect(state.floatingButton).toBe(button);
    expect(button.parentElement).toBe(upper);
    button.click();
    expect(toggle).toHaveBeenLastCalledWith(host, state, false);
    width = 200;
    resize();
    const readerButton = state.floatingButton;
    expect(readerButton.parentElement).toBe(end);
    expect(readerButton.ownerDocument).toBe(reader.document);
    expect(button.isConnected).toBe(false);
    expect(readerButton.querySelector("svg path")?.getAttribute("fill")).toBe(
      "#a94e25",
    );
    readerButton.click();
    expect(toggle).toHaveBeenLastCalledWith(host, state, false);
    expect(upper.querySelector(".tabs-menu")).not.toBeNull();
    expect(state.mount.querySelector(".zai-collapse-btn").hidden).toBe(true);
    width = 80;
    resize();
    expect(state.floatingButton.parentElement).toBe(upper);
    expect(state.floatingButton.ownerDocument).toBe(host.document);
    expect(readerButton.isConnected).toBe(false);
    expect(upper.querySelectorAll(".zai-reader-chat-toggle")).toHaveLength(1);
    toolbar.remove();
    install();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(button.isConnected).toBe(false);
    expect(state.mount.querySelector(".zai-collapse-btn").hidden).toBe(true);
  });

  it("does not fall back to an overlay when the reader toolbar is unavailable", () => {
    const { host, reader, state, install } = setup();
    reader.document.body.replaceChildren();
    install();
    expect(state.floatingButton).toBeUndefined();
    expect(host.document.querySelector("#zai-floating-toggle")).toBeNull();
  });
});
