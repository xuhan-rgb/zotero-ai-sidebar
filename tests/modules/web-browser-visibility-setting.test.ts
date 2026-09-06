import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCAL_UI_SETTINGS,
  normalizeLocalUiSettings,
} from "../../src/settings/local-ui-settings";

const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("WEB browser background preference", () => {
  it("is enabled by default and persists an explicit opt-out", () => {
    expect(DEFAULT_LOCAL_UI_SETTINGS.hideWebBrowser).toBe(true);
    expect(normalizeLocalUiSettings({ hideWebBrowser: false }).hideWebBrowser).toBe(
      false,
    );
  });

  it("renders a checked account-dialog option and sends it with each task", () => {
    const sidebar = source("src/modules/sidebar.ts");
    const client = source("src/modules/web-agent-client.ts");

    expect(sidebar).toContain("对话时在后台隐藏浏览器");
    expect(sidebar).toContain('"composer-web-account-label", "账号"');
    expect(sidebar).toContain("checkbox.checked = state.localUiSettings.hideWebBrowser");
    expect(sidebar).toContain("hideBrowser: state.localUiSettings.hideWebBrowser");
    expect(client).toContain("hideBrowser: boolean");
  });

  it("passes the background preference and provider to browser mode selection", () => {
    const agent = source("web-agent/agent.mjs");

    expect(agent).toContain("hideBrowser: value.hideBrowser !== false");
    expect(agent).toContain("if (!task.hideBrowser) visibleTaskIDs.add(task.id)");
    expect(agent).toContain("visibleTaskIDs.delete(task.id)");
    expect(agent).toContain(
      'await ensureDedicatedBrowserMode(task.hideBrowser ? "headless" : "visible", adapter)',
    );
    expect(agent).toMatch(
      /async function applyTaskWindowPolicy[\s\S]*?if \(!task\.hideBrowser\)[\s\S]*?await showBrowserWindow\(page\)/,
    );
    expect(agent).toMatch(
      /async function enforceHiddenWindowPolicy[\s\S]*?await stopDedicatedBrowser\(\)/,
    );
  });
});
