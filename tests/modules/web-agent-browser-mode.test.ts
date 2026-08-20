import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  browserModeFromVersion,
  chromeLaunchArguments,
} from "../../web-agent/browser-mode.mjs";

describe("Web Agent browser modes", () => {
  it("starts hidden conversations in a browser with no desktop window", () => {
    const args = chromeLaunchArguments(
      { profileDir: "/profile", cdpPort: 9224 },
      "headless",
    );

    expect(args).toContain("--headless=new");
    expect(args).not.toContain("--start-minimized");
  });

  it("starts account configuration in a visible browser", () => {
    const args = chromeLaunchArguments(
      { profileDir: "/profile", cdpPort: 9224 },
      "visible",
    );

    expect(args).not.toContain("--headless=new");
    expect(args).not.toContain("--start-minimized");
  });

  it("recognizes an existing headless Chrome after the Agent restarts", () => {
    expect(
      browserModeFromVersion({
        Product: "Chrome/151.0.0.0",
        "User-Agent": "Mozilla/5.0 HeadlessChrome/151.0.0.0",
      }),
    ).toBe("headless");
    expect(
      browserModeFromVersion({
        Product: "Chrome/151.0.0.0",
        "User-Agent": "Mozilla/5.0 Chrome/151.0.0.0",
      }),
    ).toBe("visible");
  });

  it("switches browser mode before opening a task page", () => {
    const agent = readFileSync(
      resolve(process.cwd(), "web-agent/agent.mjs"),
      "utf8",
    );
    const runTask = agent.slice(
      agent.indexOf("async function runTask(task)"),
      agent.indexOf("async function restoreComposerPrompt"),
    );

    expect(runTask).toContain(
      'await ensureDedicatedBrowserMode(task.hideBrowser ? "headless" : "visible")',
    );
    expect(agent).toMatch(
      /async function openDedicatedBrowser[\s\S]*?ensureDedicatedBrowserMode\("visible"\)/,
    );
    expect(agent).toMatch(
      /async function hideDedicatedBrowser[\s\S]*?await stopDedicatedBrowser\(\)/,
    );
    expect(agent).toMatch(
      /async function browserAccountStatus[\s\S]*?ensureDedicatedBrowserMode\([\s\S]*?"headless"[\s\S]*?page\.goto\(adapter\.accountUrl \|\| adapter\.url/,
    );
    expect(agent).toMatch(
      /async function shutdown[\s\S]*?await stopDedicatedBrowser\(\)/,
    );
  });
});
