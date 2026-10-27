import { Window as HappyWindow } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFloatingDesktopWorkspace } from "../../src/modules/floating-desktop-workspace";
import { DEFAULT_FLOATING_PANEL_LAYOUT } from "../../src/settings/local-ui-settings";

const workspaces: Array<ReturnType<typeof createFloatingDesktopWorkspace>> = [];
const desktopWindows: HappyWindow[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) workspace.destroy();
  for (const win of desktopWindows.splice(0)) win.happyDOM.abort();
  document.body.replaceChildren();
});

function setNumber(target: object, key: string, value: number) {
  Object.defineProperty(target, key, { configurable: true, value });
}

function makePanel(mount: HTMLElement) {
  const app = mount.ownerDocument.createElement("div");
  app.className = "zai-app";
  const messages = mount.ownerDocument.createElement("div");
  messages.className = "messages";
  const composer = mount.ownerDocument.createElement("div");
  composer.className = "composer";
  app.append(messages, composer);
  mount.replaceChildren(app);
}

function setup(readerWindows: () => Window[] = () => []) {
  const host = window;
  setNumber(host, "windowState", 1);
  setNumber(host, "innerWidth", 1200);
  setNumber(host, "innerHeight", 800);
  setNumber(host, "outerWidth", 1200);
  setNumber(host, "outerHeight", 900);
  setNumber(host, "screenX", 20);
  setNumber(host, "screenY", 30);

  const home = document.createElement("div");
  home.id = "zai-root";
  document.body.append(home);
  makePanel(home);

  let target: HappyWindow | null = null;
  const openDialog = vi.fn((url: string) => {
    target = new HappyWindow({ url });
    desktopWindows.push(target);
    const container = target.document.createElement("div");
    container.id = "zai-desktop-container";
    target.document.body.append(container);
    setNumber(target, "innerWidth", 900);
    setNumber(target, "innerHeight", 700);
    setNumber(target, "outerWidth", 900);
    setNumber(target, "outerHeight", 760);
    setNumber(target, "screenX", 2200);
    setNumber(target, "screenY", 120);
    setNumber(target, "closed", false);
    for (const method of [
      "resizeTo",
      "moveTo",
      "focus",
      "minimize",
      "restore",
      "close",
    ])
      Object.defineProperty(target, method, {
        configurable: true,
        value: vi.fn(),
      });
    return target as unknown as Window;
  });
  Object.defineProperty(host, "openDialog", {
    configurable: true,
    value: openDialog,
  });
  const onMountChange = vi.fn((mount: HTMLElement) => makePanel(mount));
  const onVisibilityChange = vi.fn();
  const onLayoutChange = vi.fn();
  const workspace = createFloatingDesktopWorkspace(host, home, {
    windowURL: "chrome://zotero-ai-sidebar/content/floating-window.xhtml",
    readerWindows,
    layout: {
      ...DEFAULT_FLOATING_PANEL_LAYOUT,
      answer: { ...DEFAULT_FLOATING_PANEL_LAYOUT.answer, x: 2200, y: 120 },
    },
    onMountChange,
    onVisibilityChange,
    onLayoutChange,
  });
  workspaces.push(workspace);
  return {
    home,
    workspace,
    onMountChange,
    onVisibilityChange,
    onLayoutChange,
    openDialog,
    get target() {
      return target!;
    },
  };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createFloatingDesktopWorkspace", () => {
  it("renders fresh destination-document nodes and keeps native geometry off the main viewport", async () => {
    const state = setup();
    await settle();
    const mount = state.onMountChange.mock.calls[0]?.[0];
    expect(mount).toBeDefined();
    expect(mount.ownerDocument).toBe(state.target.document);
    expect(mount.classList.contains("zai-root-independent")).toBe(true);
    expect(mount.querySelector(".zai-floating-header")).toBeNull();
    expect(mount.querySelector("[data-zai-float-action]")).toBeNull();
    for (const selector of [".zai-app", ".messages", ".composer"])
      expect(mount.querySelector(selector)?.ownerDocument).toBe(
        state.target.document,
      );
    expect(state.onMountChange).toHaveBeenCalledTimes(1);
    expect(state.target.screenX).toBe(2200);
    expect(state.target.moveTo).toHaveBeenCalledWith(2200, 120);
    expect(state.target.focus).toHaveBeenCalledOnce();
  });

  it("hides and shows the same native shell", async () => {
    const state = setup();
    await settle();
    const target = state.target;
    state.workspace.setVisible(false);
    expect(state.workspace.isHidden()).toBe(true);
    expect(target.minimize).toHaveBeenCalledOnce();
    state.workspace.setVisible(true);
    expect(state.workspace.isHidden()).toBe(false);
    expect(state.openDialog).toHaveBeenCalledOnce();
    expect(target.restore).toHaveBeenCalledOnce();
    expect(target.focus).toHaveBeenCalledTimes(2);
  });

  it("restores home on native unload and reopens when shown", async () => {
    const state = setup();
    await settle();
    const first = state.target;
    first.dispatchEvent(new Event("unload"));
    expect(state.onMountChange.mock.calls.at(-1)?.[0]).toBe(state.home);
    expect(state.onVisibilityChange).toHaveBeenCalled();
    state.workspace.setVisible(true);
    await settle();
    expect(state.openDialog).toHaveBeenCalledTimes(2);
    expect(state.target).not.toBe(first);
    expect(state.onMountChange.mock.calls.at(-1)?.[0].ownerDocument).toBe(
      state.target.document,
    );
  });

  it("destroy closes the native window and restores home once", async () => {
    const state = setup();
    await settle();
    const target = state.target;
    state.workspace.destroy();
    expect(target.close).toHaveBeenCalledOnce();
    expect(state.onMountChange.mock.calls.at(-1)?.[0]).toBe(state.home);
    const calls = state.onMountChange.mock.calls.length;
    target.dispatchEvent(new Event("unload"));
    state.workspace.destroy();
    expect(state.onMountChange).toHaveBeenCalledTimes(calls);
  });

  it("does not mount a delayed native document after destruction", async () => {
    const state = setup();
    const target = state.target;
    state.workspace.destroy();
    target.dispatchEvent(new Event("load"));
    await settle();
    expect(state.onMountChange).toHaveBeenCalledTimes(1);
    expect(state.onMountChange.mock.calls[0]?.[0]).toBe(state.home);
  });
  it("aligns PDF away from the desktop window without reserving a full-height strip", async () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    Object.defineProperties(iframe, {
      offsetWidth: { value: 1200 },
      offsetHeight: { value: 800 },
    });
    iframe.getBoundingClientRect = () => new DOMRect(0, 0, 1200, 800);
    const reader = iframe.contentWindow!;
    reader.document.body.innerHTML =
      '<div id="split-view"><div class="pdfViewer"><div class="page">PDF</div></div></div>';
    const split = reader.document.getElementById("split-view")!;
    split.getBoundingClientRect = () => new DOMRect(0, 0, 1200, 800);
    const state = setup(() => [reader]);
    await settle();
    state.workspace.refreshReaderAlignment();
    expect(split.classList.contains("zai-floating-reader-space")).toBe(false);
    setNumber(state.target, "screenX", 720);
    state.workspace.refreshReaderAlignment();
    expect(split.classList.contains("zai-floating-reader-space")).toBe(false);
    expect(
      reader.document.getElementById("zai-floating-pdf-align")?.textContent,
    ).toContain("flex-start");
    setNumber(state.target, "screenX", -400);
    state.workspace.refreshReaderAlignment();
    expect(split.classList.contains("zai-floating-reader-space")).toBe(false);
    expect(
      reader.document.getElementById("zai-floating-pdf-align")?.textContent,
    ).toContain("safe flex-end");
    setNumber(state.target, "screenX", 2200);
    state.workspace.refreshReaderAlignment();
    expect(split.classList.contains("zai-floating-reader-space")).toBe(false);
    expect(reader.document.getElementById("zai-floating-pdf-align")).toBeNull();
  });

  it("treats native minimization as hidden and restores its view on activation", async () => {
    const state = setup();
    await settle();
    setNumber(state.target, "windowState", 2);
    state.workspace.refreshReaderAlignment();
    expect(state.workspace.isHidden()).toBe(true);
    expect(
      state.target.document.querySelector<HTMLElement>(
        "[data-zai-floating-window]",
      )!.hidden,
    ).toBe(true);
    setNumber(state.target, "windowState", 1);
    state.target.dispatchEvent(new Event("focus"));
    expect(state.workspace.isHidden()).toBe(false);
    expect(
      state.target.document.querySelector<HTMLElement>(
        "[data-zai-floating-window]",
      )!.hidden,
    ).toBe(false);
  });
  it("minimizes and restores the floating chat with its PDF host", async () => {
    const state = setup();
    await settle();
    const messages = state.target.document.querySelector(".messages");
    setNumber(window, "windowState", 2);
    window.dispatchEvent(new Event("sizemodechange"));
    expect(state.target.minimize).toHaveBeenCalledOnce();
    setNumber(state.target, "windowState", 2);
    setNumber(window, "windowState", 1);
    window.dispatchEvent(new Event("sizemodechange"));
    expect(state.target.restore).toHaveBeenCalledOnce();
    expect(state.target.document.querySelector(".messages")).toBe(messages);
  });
});
