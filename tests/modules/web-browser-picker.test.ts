import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync("src/modules/sidebar.ts", "utf8");
const outsideClickSource = source.slice(
  source.indexOf("let browserPickerDebugSequence"),
  source.indexOf("function compactMenu("),
);
const text = outsideClickSource + source.slice(
  source.indexOf("function renderWebBrowserPicker("),
  source.indexOf("function configureWebAccount("),
);
const js = ts.transpileModule(text, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
function setup() {
  const configure = vi.fn(),
    change = vi.fn(async () => {}),
    render = vi.fn();
  const detectBrowser = vi.fn(async () => "/detected/chrome");
  const addBrowser = vi.fn(async () => {});
  const pickFile = vi.fn(async () => "/portable/edge");
  const el = (doc: Document, tag: string, cls = "", text = "") => {
    const e = doc.createElement(tag);
    e.className = cls;
    e.textContent = text;
    return e;
  };
  const choices = vi.fn(async () => ({
    selected: "chrome",
    available: [
      { browser: "chrome", name: "Google Chrome", path: "/chrome" },
      { browser: "edge", name: "Microsoft Edge", path: "/edge" },
    ],
  }));
  const make = new Function(
    "el",
    "buttonEl",
    "getWebAgentBrowsers",
    "selectWebAgentBrowser",
    "errorMessage",
    "webProviderName",
    "customWebProviderFor",
    "webAccountIcon",
    "configureWebAccount",
    "renderPanel",
    "pickWebAgentRuntimeFile",
    "addWebAgentBrowser",
    "detectWebAgentBrowser",
    "traceBrowserPicker",
    `${js}; return renderWebAccountButton;`,
  )(
    el,
    (d: Document, t: string) => el(d, "button", "", t),
    choices,
    change,
    String,
    () => "DeepSeek",
    () => undefined,
    (d: Document) => el(d, "span"),
    configure,
    render,
    pickFile,
    addBrowser,
    detectBrowser,
    vi.fn(),
  );
  const state = {
    localUiSettings: { webPromptProvider: "deepseek" },
    sending: false,
  };
  return {
    root: make(document, document.createElement("div"), state) as HTMLElement,
    configure,
    change,
    render,
    state,
    pickFile,
    addBrowser,
  };
}

function chooseBrowser(root: HTMLElement, value: string) {
  const select = root.querySelector("select")!;
  select.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  // Model the native popup's retargeted press before selection completes.
  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  document.body.click();
}

describe("account browser picker", () => {
  it("keeps the main account click and browser selection separate", async () => {
    const { root, configure, change } = setup();
    await vi.waitFor(() =>
      expect(root.querySelectorAll("option")).toHaveLength(3),
    );
    root.querySelector("summary")!.click();
    expect(configure).not.toHaveBeenCalled();
    root
      .querySelector<HTMLButtonElement>(".composer-web-account-button")!
      .click();
    expect(configure).toHaveBeenCalledOnce();
    expect(change).not.toHaveBeenCalled();
  });
  it("lets the browser popup extend outside the footer without changing API clipping", async () => {
    const style = document.createElement("style");
    style.textContent = readFileSync("addon/content/sidebar.css", "utf8");
    const actions = document.createElement("div");
    actions.className = "composer-footer-actions";
    const { root } = setup();
    actions.append(root);
    document.head.append(style);
    document.body.append(actions);
    try {
      await vi.waitFor(() => expect(root.querySelectorAll("option")).toHaveLength(3));
      root.querySelector<HTMLDetailsElement>("details")!.open = true;
      expect(getComputedStyle(actions).overflow).toBe("visible");
      root.remove();
      expect(getComputedStyle(actions).overflow).toBe("hidden");
    } finally {
      actions.remove();
      style.remove();
    }
  });
  it("displays the detected executable path and updates it with the browser selection", async () => {
    const { root, change } = setup();
    await vi.waitFor(() => expect(root.querySelectorAll("option")).toHaveLength(3));
    const input = root.querySelector<HTMLInputElement>('input[aria-label="浏览器程序路径"]')!;
    expect(input.value).toBe("/chrome");
    chooseBrowser(root, "edge");
    expect(input.value).toBe("/edge");
    expect(change).not.toHaveBeenCalled();
  });
  it("adds a user-named browser without changing it into Chrome", async () => {
    const { root, addBrowser, change, render } = setup();
    await vi.waitFor(() => expect(root.querySelectorAll("option")).toHaveLength(3));
    chooseBrowser(root, "__new");
    const name = root.querySelector<HTMLInputElement>('input[aria-label="浏览器名称"]')!;
    expect(name.parentElement!.hidden).toBe(false);
    name.value = "My Browser";
    root.querySelector<HTMLInputElement>('input[aria-label="浏览器程序路径"]')!.value = "/portable/browser";
    root.querySelector<HTMLButtonElement>(".composer-browser-apply")!.click();
    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
    expect(addBrowser).toHaveBeenCalledWith("My Browser", "/portable/browser");
    expect(change).not.toHaveBeenCalled();
  });
  it("redetects a mistaken path and only saves automatic detection on Apply", async () => {
    const { root, change, render } = setup();
    await vi.waitFor(() => expect(root.querySelectorAll("option")).toHaveLength(3));
    const input = root.querySelector<HTMLInputElement>('input[aria-label="浏览器程序路径"]')!;
    input.value = "/wrong/file.txt";
    root.querySelector<HTMLButtonElement>(".composer-browser-detect")!.click();
    await vi.waitFor(() => expect(input.value).toBe("/detected/chrome"));
    expect(change).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>(".composer-browser-apply")!.click();
    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
    expect(change).toHaveBeenCalledWith("chrome", undefined, "");
  });
  it("closes on an outside click while preserving inside interactions", async () => {
    const { root, change, addBrowser } = setup();
    document.body.append(root);
    try {
      await vi.waitFor(() => expect(root.querySelectorAll("option")).toHaveLength(3));
      const menu = root.querySelector<HTMLDetailsElement>("details")!;
      menu.open = true;
      chooseBrowser(root, "edge");
      expect(menu.open).toBe(true);
      expect(root.querySelector<HTMLInputElement>('input[aria-label="浏览器程序路径"]')!.value).toBe("/edge");
      expect(root.querySelector("select")).not.toBeNull();
      root.querySelector<HTMLInputElement>('input[aria-label="浏览器程序路径"]')!.click();
      expect(menu.open).toBe(true);
      // Native select popups may dispatch their final click on the document.
      document.body.click();
      expect(menu.open).toBe(true);
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      document.body.click();
      expect(menu.open).toBe(false);
      expect(change).not.toHaveBeenCalled();
      expect(addBrowser).not.toHaveBeenCalled();
    } finally { root.remove(); }
  });
  it("keeps the picker open for native XUL options before any change event", async () => {
    const { root, change } = setup();
    document.body.append(root);
    const popup = document.createElement("menupopup");
    const option = document.createElement("menuitem");
    option.className = "ContentSelectDropdown-item-0";
    popup.append(option);
    document.body.append(popup);
    try {
      await vi.waitFor(() => expect(root.querySelectorAll("option")).toHaveLength(3));
      const menu = root.querySelector<HTMLDetailsElement>("details")!;
      menu.open = true;
      const select = root.querySelector("select")!;
      select.focus();
      option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      option.click();
      expect(menu.open).toBe(true);
      select.value = "edge";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      expect(menu.open).toBe(true);
      expect(change).not.toHaveBeenCalled();
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      document.body.click();
      expect(menu.open).toBe(false);
    } finally { popup.remove(); root.remove(); }
  });
  it("fills the path from the file picker without applying it immediately", async () => {
    const { root, pickFile, change } = setup();
    await vi.waitFor(() => expect(root.querySelectorAll("option")).toHaveLength(3));
    const browse = Array.from(root.querySelectorAll("button")).find(button => button.textContent === "选择程序文件…")!;
    browse.click();
    await vi.waitFor(() => expect(root.querySelector<HTMLInputElement>('input[aria-label="浏览器程序路径"]')!.value).toBe("/portable/edge"));
    expect(pickFile).toHaveBeenCalledWith(document, "browser");
    expect(change).not.toHaveBeenCalled();
  });
  it("saves a custom executable path even when the browser stays Chrome", async () => {
    const { root, change, render } = setup();
    await vi.waitFor(() => expect(root.querySelectorAll("option")).toHaveLength(3));
    root.querySelector<HTMLInputElement>('input[aria-label="浏览器程序路径"]')!.value = "/custom/chrome";
    root.querySelector<HTMLButtonElement>(".composer-browser-apply")!.click();
    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
    expect(change).toHaveBeenCalledWith("chrome", undefined, "/custom/chrome");
  });
  it("applies Edge only when requested without opening the account page", async () => {
    const { root, configure, change, render } = setup();
    await vi.waitFor(() =>
      expect(root.querySelectorAll("option")).toHaveLength(3),
    );
    chooseBrowser(root, "edge");
    expect(change).not.toHaveBeenCalled();
    root
      .querySelector<HTMLButtonElement>(".composer-browser-apply")!
      .click();
    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
    expect(change).toHaveBeenCalledWith("edge", undefined, undefined);
    expect(configure).not.toHaveBeenCalled();
  });
});
