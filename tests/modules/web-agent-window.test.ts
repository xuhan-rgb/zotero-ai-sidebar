import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  hideBrowserWindow,
  showBrowserWindow,
} from "../../web-agent/window-visibility.mjs";

function browserPage() {
  const send = vi.fn(async (method: string) => {
    if (method === "Browser.getWindowForTarget") return { windowId: 7 };
    return {};
  });
  const detach = vi.fn(async () => undefined);
  const session = { send, detach };
  const newCDPSession = vi.fn(async () => session);
  const bringToFront = vi.fn(async () => undefined);
  const page = {
    context: () => ({ newCDPSession }),
    bringToFront,
  };
  return { page, send, detach, bringToFront };
}

describe("Web Agent browser window visibility", () => {
  it("minimizes the dedicated browser through CDP", async () => {
    const { page, send, detach, bringToFront } = browserPage();

    await expect(hideBrowserWindow(page)).resolves.toBe(true);

    expect(send).toHaveBeenCalledWith("Browser.setWindowBounds", {
      windowId: 7,
      bounds: { windowState: "minimized" },
    });
    expect(bringToFront).not.toHaveBeenCalled();
    expect(detach).toHaveBeenCalledOnce();
  });

  it("restores and focuses the browser only for account interaction", async () => {
    const { page, send, bringToFront } = browserPage();

    await expect(showBrowserWindow(page)).resolves.toBe(true);

    expect(send).toHaveBeenCalledWith("Browser.setWindowBounds", {
      windowId: 7,
      bounds: { windowState: "normal" },
    });
    expect(bringToFront).toHaveBeenCalledOnce();
  });

  it("does not fail a task when window control is unavailable", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const page = {
      context: () => ({
        newCDPSession: vi.fn(async () => {
          throw new Error("CDP unavailable");
        }),
      }),
      bringToFront: vi.fn(async () => {
        throw new Error("window manager unavailable");
      }),
    };

    await expect(hideBrowserWindow(page)).resolves.toBe(false);
    await expect(showBrowserWindow(page)).resolves.toBe(false);
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });

  it("keeps normal tasks hidden and shows only the login path", () => {
    const agent = readFileSync(
      resolve(process.cwd(), "web-agent/agent.mjs"),
      "utf8",
    );
    const runTask = agent.slice(
      agent.indexOf("async function runTask(task)"),
      agent.indexOf("async function restoreComposerPrompt"),
    );
    const installer = readFileSync(
      resolve(process.cwd(), "scripts/install-web-agent.sh"),
      "utf8",
    );

    expect(runTask).not.toContain("page.bringToFront()");
    expect(agent).toMatch(
      /async function openDedicatedBrowser[\s\S]*?await showBrowserWindow\(page\)/,
    );
    expect(runTask.match(/applyTaskWindowPolicy\(page, task\)/g)).toHaveLength(1);
    expect(runTask).toContain(
      'await ensureDedicatedBrowserMode(task.hideBrowser ? "headless" : "visible")',
    );
    expect(agent).toContain('ensureDedicatedBrowserMode("visible")');
    expect(agent).toContain("await stopDedicatedBrowser()");
    expect(agent).not.toContain('"--start-minimized"');
    expect(installer).toContain("browser-mode.mjs");
    expect(installer).toContain("window-visibility.mjs");
  });

  it("lets the Zotero account dialog explicitly hide the login browser", () => {
    const agent = readFileSync(
      resolve(process.cwd(), "web-agent/agent.mjs"),
      "utf8",
    );
    const client = readFileSync(
      resolve(process.cwd(), "src/modules/web-agent-client.ts"),
      "utf8",
    );
    const sidebar = readFileSync(
      resolve(process.cwd(), "src/modules/sidebar.ts"),
      "utf8",
    );

    expect(agent).toContain('request.url === "/browser/hide"');
    expect(agent).toContain("await hideDedicatedBrowser(");
    expect(agent).toContain("let accountWindowVisible = false");
    expect(agent).toContain("void enforceHiddenWindowPolicy()");
    expect(agent).toMatch(
      /async function openDedicatedBrowser[\s\S]*?accountWindowVisible = true/,
    );
    expect(agent).toMatch(
      /async function hideDedicatedBrowser[\s\S]*?accountWindowVisible = false/,
    );
    expect(client).toContain("export async function hideWebAccount(");
    expect(client).toContain("/browser/hide");
    expect(sidebar).toContain("function configureWebAccount(");
    expect(sidebar).toContain("await hideWebAccount(provider, customProvider)");
    expect(sidebar).toContain("完成并隐藏");
    expect(sidebar).toContain("getWebAccountStatus(");
    expect(sidebar).toContain("重新检查环境");
    expect(sidebar).toContain("安装 Web Agent");
    expect(sidebar).toContain("修复 Web Agent");
    expect(sidebar).toContain("打开 Node.js 下载页");
    expect(sidebar).toContain("打开 Chrome 下载页");
    expect(sidebar).toContain("复制 xclip 安装说明");
    expect(sidebar).toContain("https://nodejs.org/en/download");
    expect(sidebar).toContain("https://www.google.com/chrome/");
    expect(sidebar).toContain("sudo apt install xclip");
    expect(sidebar).toContain(
      "系统依赖需要由用户安装，插件不会自动执行安装程序或系统命令。",
    );
    expect(sidebar).toMatch(
      /if \(report\.state !== "blocked"\) return;[\s\S]*?dependencyActions\.hidden = false/,
    );
    expect(sidebar).toMatch(
      /report\.state === "blocked"[\s\S]*?\? "重新检查环境"/,
    );
    expect(sidebar).toContain("inspectWebAgentInstallation()");
    expect(sidebar).toContain("repairWebAgentInstallation()");
    expect(sidebar).toContain("WebAgentRuntimeDownloadError");
    expect(sidebar).toContain("installLocalWebAgentRuntime(");
    expect(sidebar).toContain("pickWebAgentRuntimeFile(");
    expect(sidebar).toContain("打开下载页面");
    expect(sidebar).toContain("复制下载链接");
    expect(sidebar).toContain("选择已下载的运行包");
  });
});
