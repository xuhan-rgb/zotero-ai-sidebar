import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FLOATING_PANEL_LAYOUT,
  type FloatingPanelLayout,
} from "../../src/settings/local-ui-settings";
import { createFloatingWorkspace } from "../../src/modules/floating-workspace";

const workspaces: Array<ReturnType<typeof createFloatingWorkspace>> = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) workspace.destroy();
  document.body.replaceChildren();
});

function pointer(type: string, values: Record<string, unknown> = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({
    button: 0,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    ...values,
  }))
    Object.defineProperty(event, key, { value });
  return event;
}

function setup(layout: FloatingPanelLayout = DEFAULT_FLOATING_PANEL_LAYOUT) {
  const parent = document.createElement("div");
  const before = document.createElement("i");
  const mount = document.createElement("div");
  const after = document.createElement("b");
  parent.append(before, mount, after);
  document.body.append(parent);

  const app = document.createElement("div");
  app.className = "zai-app";
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  const context = document.createElement("div");
  context.className = "context";
  const messages = document.createElement("div");
  messages.className = "messages";
  const composer = document.createElement("div");
  composer.className = "composer";
  const draft = document.createElement("textarea");
  draft.value = "unsent draft";
  composer.append(draft);
  app.append(toolbar, context, messages, composer);
  mount.append(app);

  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 900,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 700,
  });
  const onLayoutChange = vi.fn();
  const onVisibilityChange = vi.fn();
  const workspace = createFloatingWorkspace(window, mount, {
    layout,
    onLayoutChange,
    onVisibilityChange,
  });
  workspaces.push(workspace);
  const frame = (id: "answer" | "composer") =>
    mount.querySelector<HTMLElement>(`[data-zai-floating-panel="${id}"]`)!;
  const header = (id: "answer" | "composer") =>
    mount.querySelector<HTMLElement>(`[data-zai-float-drag="${id}"]`)!;
  const grip = (id: "answer" | "composer") =>
    mount.querySelector<HTMLElement>(`[data-zai-float-resize="${id}"]`)!;
  const action = (id: "answer" | "composer", kind: string) =>
    mount.querySelector<HTMLButtonElement>(
      `[data-zai-float-action="${kind}"]`,
    )!;
  return {
    window: () =>
      mount.querySelector<HTMLElement>("[data-zai-floating-window]")!,
    parent,
    before,
    mount,
    after,
    app,
    toolbar,
    context,
    messages,
    composer,
    draft,
    workspace,
    frame,
    header,
    grip,
    action,
    onLayoutChange,
    onVisibilityChange,
  };
}

function drag(
  target: Element,
  from: [number, number],
  to: [number, number],
  pointerId = 1,
) {
  target.dispatchEvent(
    pointer("pointerdown", { pointerId, clientX: from[0], clientY: from[1] }),
  );
  window.dispatchEvent(
    pointer("pointermove", { pointerId, clientX: to[0], clientY: to[1] }),
  );
  window.dispatchEvent(
    pointer("pointerup", { pointerId, clientX: to[0], clientY: to[1] }),
  );
}

describe("floating workspace", () => {
  it("uses one movable window with answers above the fixed composer", () => {
    const state = setup();
    const window = state.mount.querySelector<HTMLElement>(
      "[data-zai-floating-window]",
    )!;
    expect(window).not.toBeNull();
    expect(state.mount.querySelectorAll(".zai-floating-module")).toHaveLength(
      1,
    );
    expect(window.contains(state.frame("answer"))).toBe(true);
    expect(window.contains(state.frame("composer"))).toBe(true);
    expect([...window.children].indexOf(state.frame("answer"))).toBeLessThan(
      [...window.children].indexOf(state.frame("composer")),
    );
    expect(state.mount.querySelectorAll("[data-zai-float-drag]")).toHaveLength(
      1,
    );
    expect(
      state.mount.querySelectorAll("[data-zai-float-resize]"),
    ).toHaveLength(1);
    expect(state.frame("composer").contains(state.draft)).toBe(true);
    expect(state.frame("answer").contains(state.messages)).toBe(true);
    expect(state.mount.ownerDocument).toBe(document);
  });
  it("moves and resizes the entire window, preserving draft and scroll", () => {
    const state = setup();
    state.messages.scrollTop = 75;
    const initial = parseFloat(state.window().style.left);
    drag(state.header("answer"), [100, 100], [130, 115]);
    expect(parseFloat(state.window().style.left)).toBe(initial + 30);
    expect(state.onLayoutChange).toHaveBeenCalledOnce();
    expect(state.onLayoutChange.mock.calls[0]![0].answer.x).toBe(initial + 30);
    const width = parseFloat(state.window().style.width);
    drag(state.grip("answer"), [0, 0], [40, 40], 2);
    expect(parseFloat(state.window().style.width)).toBe(width + 40);
    expect(state.frame("answer").style.left).toBe("");
    expect(state.frame("composer").style.left).toBe("");
    expect(state.draft.value).toBe("unsent draft");
    expect(state.messages.scrollTop).toBe(75);
  });

  it("collapses only answers and uses content height without a blank fixed area", () => {
    const state = setup();
    const expandedHeight = state.window().style.height;
    state.action("answer", "hide").click();
    expect(state.frame("answer").hidden).toBe(true);
    expect(state.frame("composer").hidden).toBe(false);
    expect(state.window().style.height).toBe("auto");
    expect(state.workspace.isHidden()).toBe(false);
    expect(state.workspace.showAnswer()).toBe(true);
    expect(state.window().style.height).toBe(expandedHeight);
    expect(state.workspace.showAnswer()).toBe(false);
    expect(state.draft.value).toBe("unsent draft");
  });

  it("starts empty conversations compact and reveals them for a request", () => {
    const state = setup();
    state.workspace.destroy();
    workspaces.pop();
    state.messages.classList.add("messages-empty");
    const workspace = createFloatingWorkspace(window, state.mount, {
      layout: DEFAULT_FLOATING_PANEL_LAYOUT,
      onLayoutChange: vi.fn(),
      onVisibilityChange: vi.fn(),
    });
    workspaces.push(workspace);
    expect(state.frame("answer").hidden).toBe(true);
    expect(state.window().style.height).toBe("auto");
    expect(workspace.showAnswer()).toBe(true);
    expect(state.frame("answer").hidden).toBe(false);
  });

  it("keeps collapse state across hide/show and streaming renders", () => {
    const state = setup();
    state.action("answer", "hide").click();
    state.workspace.setVisible(false);
    expect(state.window().hidden).toBe(true);
    expect(state.workspace.isHidden()).toBe(true);
    state.workspace.setVisible(true);
    expect(state.window().hidden).toBe(false);
    expect(state.frame("answer").hidden).toBe(true);
    const next = document.createElement("div");
    next.className = "zai-app";
    next.innerHTML =
      '<div class="messages">streamed response</div><div class="composer"><textarea>next draft</textarea></div>';
    state.mount.replaceChildren(next);
    state.workspace.arrange(next);
    expect(state.frame("answer").hidden).toBe(true);
    expect(state.workspace.showAnswer()).toBe(true);
    expect(state.frame("answer").textContent).toBe("streamed response");
    expect(state.mount.querySelector("textarea")!.value).toBe("next draft");
  });

  it("finishes dragging after a streamed render and ignores duplicate resize events", () => {
    const state = setup();
    state
      .header("answer")
      .dispatchEvent(pointer("pointerdown", { pointerId: 3, clientX: 100 }));
    window.dispatchEvent(pointer("pointermove", { pointerId: 3, clientX: 80 }));
    const left = parseFloat(state.window().style.left);
    const next = document.createElement("div");
    next.className = "zai-app";
    next.innerHTML =
      '<div class="messages">streaming</div><div class="composer"></div>';
    state.mount.replaceChildren(next);
    state.workspace.arrange(next);
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(pointer("pointermove", { pointerId: 3, clientX: 60 }));
    window.dispatchEvent(pointer("pointerup", { pointerId: 3 }));
    expect(parseFloat(state.window().style.left)).toBe(left - 20);
    expect(state.onLayoutChange).toHaveBeenCalledOnce();
  });

  it("rolls back dragging on Escape and does not drag from text inputs", () => {
    const state = setup();
    const original = state.window().style.cssText;
    state
      .header("answer")
      .dispatchEvent(pointer("pointerdown", { pointerId: 4 }));
    window.dispatchEvent(pointer("pointermove", { pointerId: 4, clientX: 50 }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(state.window().style.cssText).toBe(original);
    drag(state.draft, [0, 0], [50, 50], 5);
    expect(state.window().style.cssText).toBe(original);
    expect(state.onLayoutChange).not.toHaveBeenCalled();
  });

  it("allows a compact window near the bottom and keeps expanded answers on screen", () => {
    const state = setup();
    state.action("answer", "hide").click();
    Object.defineProperty(state.window(), "offsetHeight", {
      configurable: true,
      value: 220,
    });
    drag(state.header("answer"), [0, 0], [0, 500], 8);
    expect(parseFloat(state.window().style.top)).toBe(472);
    state.workspace.showAnswer();
    expect(
      parseFloat(state.window().style.top) +
        parseFloat(state.window().style.height),
    ).toBeLessThanOrEqual(692);
  });

  it("uses saved answer geometry for one window and clamps after viewport changes", () => {
    const state = setup({
      answer: { x: 100, y: 120, width: 400, height: 450 },
      composer: { x: 500, y: 500, width: 350, height: 200 },
    });
    expect(state.window().style.left).toBe("100px");
    expect(state.window().style.width).toBe("400px");
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 350,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 300,
    });
    window.dispatchEvent(new Event("resize"));
    expect(state.window().style.width).toBe("334px");
    expect(state.window().style.height).toBe("284px");
    expect(state.window().style.left).toBe("8px");
    expect(state.window().style.top).toBe("8px");
    expect(state.onLayoutChange).not.toHaveBeenCalled();
  });

  it("routes answer collapse and expand through the scroll-preservation callback", () => {
    const state = setup();
    state.workspace.destroy();
    workspaces.pop();
    const toggle = vi.fn((_id, _visible, apply: () => void) => apply());
    const workspace = createFloatingWorkspace(window, state.mount, {
      layout: DEFAULT_FLOATING_PANEL_LAYOUT,
      onLayoutChange: vi.fn(),
      onVisibilityChange: vi.fn(),
      onPanelToggle: toggle,
    });
    workspaces.push(workspace);
    state.action("answer", "hide").click();
    expect(toggle).toHaveBeenLastCalledWith(
      "answer",
      false,
      expect.any(Function),
    );
    workspace.showAnswer();
    expect(toggle).toHaveBeenLastCalledWith(
      "answer",
      true,
      expect.any(Function),
    );
  });

  it("moves PDF to the opposite side of the entire conversation after dragging", () => {
    const state = setup();
    state.workspace.destroy();
    workspaces.pop();
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    Object.defineProperties(iframe, {
      offsetWidth: { value: 900 },
      offsetHeight: { value: 660 },
    });
    iframe.getBoundingClientRect = () => new DOMRect(0, 40, 900, 660);
    const reader = iframe.contentWindow!;
    reader.document.body.innerHTML =
      '<div id="split-view"><div class="pdfViewer"><div class="page">PDF</div></div></div>';
    const split = reader.document.getElementById("split-view")!;
    split.getBoundingClientRect = () => new DOMRect(0, 0, 900, 660);
    const workspace = createFloatingWorkspace(window, state.mount, {
      layout: {
        ...DEFAULT_FLOATING_PANEL_LAYOUT,
        answer: { x: 550, y: 80, width: 330, height: 560 },
      },
      readerWindows: () => [reader],
      onLayoutChange: vi.fn(),
      onVisibilityChange: vi.fn(),
    });
    workspaces.push(workspace);
    expect(reader.getComputedStyle(split).paddingRight).toBe("358px");
    expect(reader.getComputedStyle(split).paddingBottom).toBe("0px");
    state
      .header("answer")
      .dispatchEvent(pointer("pointerdown", { pointerId: 10, clientX: 550 }));
    window.dispatchEvent(
      pointer("pointermove", { pointerId: 10, clientX: 20 }),
    );
    expect(reader.getComputedStyle(split).paddingRight).toBe("358px");
    window.dispatchEvent(pointer("pointerup", { pointerId: 10 }));
    expect(reader.getComputedStyle(split).paddingLeft).toBe("358px");
    expect(reader.getComputedStyle(split).paddingRight).toBe("0px");
    state.action("answer", "hide").click();
    expect(split.classList.contains("zai-floating-reader-space")).toBe(false);
    expect(reader.document.querySelector("#zai-floating-pdf-align")).toBeNull();
    workspace.showAnswer();
    expect(reader.getComputedStyle(split).paddingLeft).toBe("358px");
    workspace.setVisible(false);
    expect(split.classList.contains("zai-floating-reader-space")).toBe(false);
    workspace.setVisible(true);
    workspace.destroy();
    expect(split.classList.contains("zai-floating-reader-space")).toBe(false);
  });

  it("restores original content order on exit and displays recovery views", () => {
    const state = setup();
    state.workspace.destroy();
    expect([...state.app.children]).toEqual([
      state.toolbar,
      state.context,
      state.messages,
      state.composer,
    ]);
    expect(state.mount.parentElement).toBe(state.parent);
    expect(state.mount.nextSibling).toBe(state.after);
    expect(state.draft.value).toBe("unsent draft");
    workspaces.pop();
    const next = document.createElement("div");
    next.className = "zai-app";
    next.innerHTML = "<p>Recovery message</p>";
    state.mount.replaceChildren(next);
    const workspace = createFloatingWorkspace(window, state.mount, {
      layout: DEFAULT_FLOATING_PANEL_LAYOUT,
      onLayoutChange: vi.fn(),
      onVisibilityChange: vi.fn(),
    });
    workspaces.push(workspace);
    expect(state.frame("answer").textContent).toBe("Recovery message");
  });
});
