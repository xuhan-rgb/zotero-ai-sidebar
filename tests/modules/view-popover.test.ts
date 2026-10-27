import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  captureViewPopover,
  positionViewPopover,
  restoreViewPopover,
} from "../../src/modules/view-popover";

function createMenu({
  left = 20,
  top = 20,
  width = 300,
  contentWidth = width,
  contentHeight = 240,
  doc = document,
}: {
  left?: number;
  top?: number;
  width?: number;
  contentWidth?: number;
  contentHeight?: number;
  doc?: Document;
} = {}) {
  const menu = doc.createElement("details");
  menu.className = "header-view-menu";
  const summary = doc.createElement("summary");
  const content = doc.createElement("div");
  content.className = "zai-compact-menu-content";
  Object.defineProperty(content, "scrollHeight", { value: contentHeight });
  content.getBoundingClientRect = vi.fn(
    () => ({ width: contentWidth }) as DOMRect,
  );
  summary.getBoundingClientRect = vi.fn(
    () =>
      ({
        left,
        top,
        right: left + 40,
        bottom: top + 30,
        width: 40,
        height: 30,
        x: left,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect,
  );
  menu.getBoundingClientRect = vi.fn(() => ({ width }) as DOMRect);
  menu.append(summary, content);
  return { menu, content };
}

describe("view popover", () => {
  it("keeps the width and left edge inside the viewport", () => {
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 500 },
      innerHeight: { configurable: true, value: 700 },
    });
    const { menu } = createMenu({ left: 450, width: 400 });
    positionViewPopover(menu);
    expect(menu.style.position).toBe("");
    expect(menu.querySelector("summary")?.getAttribute("style")).toBeNull();
    const content = menu.querySelector<HTMLElement>(
      ".zai-compact-menu-content",
    )!;
    expect(content.style.width).toBe("400px");
    expect(content.style.left).toBe("92px");
    expect(content.style.position).toBe("fixed");
  });

  it("places a tall menu above the summary when there is more room", () => {
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 600 },
      innerHeight: { configurable: true, value: 500 },
    });
    const { menu } = createMenu({ top: 300, contentHeight: 250 });
    positionViewPopover(menu);
    const content = menu.querySelector<HTMLElement>(
      ".zai-compact-menu-content",
    )!;
    expect(content.style.top).toBe("auto");
    expect(content.style.bottom).toBe("208px");
    expect(content.style.maxHeight).toBe("292px");
  });

  it("limits width and height in a small viewport", () => {
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 240 },
      innerHeight: { configurable: true, value: 120 },
    });
    const { menu } = createMenu({
      left: 4,
      top: 40,
      width: 500,
      contentHeight: 500,
    });
    positionViewPopover(menu);
    const content = menu.querySelector<HTMLElement>(
      ".zai-compact-menu-content",
    )!;
    expect(content.style.width).toBe("224px");
    expect(content.style.left).toBe("8px");
    expect(content.style.maxHeight).toBe("42px");
    expect(content.style.overflowY).toBe("auto");
  });

  it("captures and restores the open menu scroll on rebuilt nodes", () => {
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 600 },
      innerHeight: { configurable: true, value: 500 },
    });
    const oldMount = document.createElement("div");
    const old = createMenu();
    old.menu.open = true;
    old.content.scrollTop = 123;
    oldMount.append(old.menu);
    const snapshot = captureViewPopover(oldMount);

    const newMount = document.createElement("div");
    const rebuilt = createMenu();
    newMount.append(rebuilt.menu);
    restoreViewPopover(newMount, snapshot);
    expect(rebuilt.menu.open).toBe(true);
    expect(rebuilt.content.scrollTop).toBe(123);
    expect(rebuilt.content.style.position).toBe("fixed");
  });

  it("uses the owning document viewport", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const doc = frame.contentDocument!;
    const view = doc.defaultView!;
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 1000 },
      innerHeight: { configurable: true, value: 800 },
    });
    Object.defineProperties(view, {
      innerWidth: { configurable: true, value: 240 },
      innerHeight: { configurable: true, value: 120 },
    });
    const { menu } = createMenu({ left: 4, top: 40, contentWidth: 500, doc });
    positionViewPopover(menu);
    expect(
      menu.querySelector<HTMLElement>(".zai-compact-menu-content")?.style.width,
    ).toBe("224px");
    frame.remove();
  });

  it("grows back to its measured width after the viewport expands", () => {
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 240 },
      innerHeight: { configurable: true, value: 500 },
    });
    const { menu, content } = createMenu({ contentWidth: 400 });
    positionViewPopover(menu);
    expect(content.style.width).toBe("224px");

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 600,
    });
    positionViewPopover(menu);
    expect(content.style.width).toBe("400px");
  });
  it("keeps popup labels, controls and whitespace outside the docked window drag region", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const doc = frame.contentDocument!;
    const style = doc.createElement("style");
    style.textContent = readFileSync("addon/content/sidebar.css", "utf8");
    doc.head.append(style);
    doc.documentElement.classList.add("zai-docked-window");
    doc.body.innerHTML =
      '<div id="zai-root" class="zai-root-docked"><div class="preset-switcher-bottom"><details class="header-view-menu" open><summary>View</summary><div class="zai-compact-menu-content"><label class="chat-font-size-control">Font size<button>13px</button></label><small>Help</small></div></details></div></div>';
    const view = doc.defaultView!;
    expect(
      view
        .getComputedStyle(doc.querySelector(".preset-switcher-bottom")!)
        .getPropertyValue("-moz-window-dragging"),
    ).toBe("drag");
    doc.documentElement.classList.add("zai-view-menu-open");
    // Fresh nodes avoid Happy DOM's cached ancestor selector results.
    const guarded = doc.querySelector(".preset-switcher-bottom")!;
    guarded.replaceWith(guarded.cloneNode(true));
    expect(
      view
        .getComputedStyle(doc.querySelector(".preset-switcher-bottom")!)
        .getPropertyValue("-moz-window-dragging"),
    ).toBe("no-drag");
    doc.documentElement.classList.remove("zai-view-menu-open");
    const released = doc.querySelector(".preset-switcher-bottom")!;
    released.replaceWith(released.cloneNode(true));
    expect(
      view
        .getComputedStyle(doc.querySelector(".preset-switcher-bottom")!)
        .getPropertyValue("-moz-window-dragging"),
    ).toBe("drag");
    for (const selector of [
      ".zai-compact-menu-content",
      "label",
      "button",
      "small",
    ]) {
      expect(
        view
          .getComputedStyle(doc.querySelector(selector)!)
          .getPropertyValue("-moz-window-dragging"),
      ).toBe("no-drag");
    }
    frame.remove();
  });
});
