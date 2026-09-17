import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSystemProxyPort } from "../../src/context/latex-download";
import { renderLatexSourceControls } from "../../src/modules/latex-source-controls";
import { loadLatexProxy } from "../../src/settings/latex-proxy";
import { zoteroPrefs } from "../../src/settings/storage";
import {
  checkLatexSourceAvailability,
  resetLatexSourceAvailability,
} from "../../src/modules/latex-source-availability";

vi.mock("../../src/modules/latex-source-availability", () => ({
  checkLatexSourceAvailability: vi.fn(),
  resetLatexSourceAvailability: vi.fn(),
}));
vi.mock("../../src/context/latex-download", () => ({
  readSystemProxyPort: vi.fn(() => 7890),
}));
vi.mock("../../src/context/arxiv-source", () => ({
  arxivSourceError: () => "下载超时（60 秒）",
}));
const check = vi.mocked(checkLatexSourceAvailability);
const click = (root: HTMLElement, text: string) =>
  Array.from(root.querySelectorAll("button"))
    .find((b) => b.textContent === text)!
    .click();
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readSystemProxyPort).mockReturnValue(7890);
  const prefs = new Map();
  vi.stubGlobal("Zotero", {
    Prefs: {
      get: (key: string) => prefs.get(key),
      set: (key: string, value: string) => prefs.set(key, value),
    },
  });
  check.mockResolvedValue("error");
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("LaTeX proxy controls", () => {
  it("keeps the action row intact while opening and closing settings below it", async () => {
    check.mockResolvedValue("available");
    const root = renderLatexSourceControls(document, "stable-actions", vi.fn());
    await flush();
    const toolbar = root.querySelector(".latex-source-toolbar");
    expect(toolbar).not.toBeNull();
    const actions = Array.from(toolbar!.children);
    click(root, "代理设置");
    const panel = root.querySelector(".latex-proxy-settings")!;
    expect(toolbar!.contains(panel)).toBe(false);
    expect(panel.previousElementSibling).toBe(toolbar);
    expect(Array.from(toolbar!.children)).toEqual(actions);
    click(root, "取消");
    expect(root.querySelector(".latex-source-toolbar")).toBe(toolbar);
    expect(Array.from(toolbar!.children)).toEqual(actions);
  });

  it("saves a manual port and restores the current system port", async () => {
    const root = renderLatexSourceControls(document, "port-edit", vi.fn());
    await flush();
    click(root, "代理设置");
    const port = root.querySelector<HTMLInputElement>(
      '[aria-label="代理端口"]',
    )!;
    expect(port.value).toBe("7890");
    port.value = "8088";
    port.dispatchEvent(new Event("input"));
    click(root, "保存并重试");
    expect(loadLatexProxy(zoteroPrefs())).toEqual({
      mode: "system",
      portOverride: 8088,
    });
    click(root, "代理设置");
    expect(root.querySelector<HTMLInputElement>("input")?.value).toBe("8088");
    vi.mocked(readSystemProxyPort).mockReturnValue(9090);
    click(root, "恢复跟随系统");
    expect(root.querySelector<HTMLInputElement>("input")?.value).toBe("9090");
    click(root, "保存并重试");
    expect(loadLatexProxy(zoteroPrefs())).toEqual({ mode: "system" });
  });

  it("rejects invalid manual ports without retrying", async () => {
    const root = renderLatexSourceControls(document, "invalid-port", vi.fn());
    await flush();
    click(root, "代理设置");
    const port = root.querySelector<HTMLInputElement>("input")!;
    port.value = "65536";
    port.dispatchEvent(new Event("input"));
    click(root, "保存并重试");
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      "1–65535",
    );
    expect(check).toHaveBeenCalledTimes(1);
    expect(loadLatexProxy(zoteroPrefs())).toEqual({ mode: "system" });
  });

  it("shows timeout and saves a shared proxy before retrying", async () => {
    const root = renderLatexSourceControls(document, "paper-one", vi.fn());
    document.body.append(root);
    await flush();
    expect(root.querySelector(".arxiv-source-badge")?.textContent).toBe(
      "LaTeX 下载超时",
    );
    click(root, "代理设置");
    const mode = root.querySelector("select")!;
    expect(
      Array.from(mode.options).map((option) => option.textContent),
    ).toEqual(["系统代理", "不使用代理"]);
    expect(mode.value).toBe("system");
    expect(root.querySelector<HTMLInputElement>("input")?.value).toBe("7890");
    mode.value = "direct";
    check.mockResolvedValue("available");
    click(root, "保存并重试");
    await flush();
    expect(loadLatexProxy(zoteroPrefs())).toEqual({
      mode: "direct",
    });
    expect(resetLatexSourceAvailability).toHaveBeenCalledWith("paper-one");
    expect(check).toHaveBeenCalledTimes(2);
    expect(root.querySelector(".arxiv-source-badge")?.textContent).toBe(
      "LaTeX 源",
    );
    const otherPaper = renderLatexSourceControls(
      document,
      "paper-two",
      vi.fn(),
    );
    click(otherPaper, "代理设置");
    expect(otherPaper.querySelector("select")?.value).toBe("direct");
  });

  it("cancels changes without saving or retrying", async () => {
    const root = renderLatexSourceControls(document, "cancel", vi.fn());
    await flush();
    click(root, "代理设置");
    root.querySelector("select")!.value = "direct";
    click(root, "取消");
    expect(check).toHaveBeenCalledTimes(1);
    expect(loadLatexProxy(zoteroPrefs()).mode).toBe("system");
    expect(root.querySelector(".latex-proxy-settings")).toBeNull();
  });

  it("offers MinerU full translation when there is no LaTeX source", async () => {
    check.mockResolvedValue("no-source");
    const translate = vi.fn();
    const root = renderLatexSourceControls(document, "no-tex", translate);
    await flush();
    expect(root.querySelector(".arxiv-source-badge")?.textContent).toBe(
      "无 LaTeX 源",
    );
    click(root, "全文翻译");
    expect(translate).toHaveBeenCalledOnce();
  });

  it("keeps translation available and supports using system proxy settings", async () => {
    check.mockResolvedValue("available");
    const translate = vi.fn();
    const root = renderLatexSourceControls(document, "cached", translate);
    await flush();
    click(root, "全文翻译");
    expect(translate).toHaveBeenCalledOnce();
    click(root, "代理设置");
    click(root, "保存并重试");
    expect(loadLatexProxy(zoteroPrefs()).mode).toBe("system");
  });
});
