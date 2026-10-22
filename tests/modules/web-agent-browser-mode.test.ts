import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  browserModeFromVersion,
  chromeLaunchArguments,
  firefoxLaunchOptions,
  isFirefoxBrowser,
} from "../../web-agent/browser-mode.mjs";

describe("Web Agent browser modes", () => {
  it("recognizes existing custom Firefox entries by executable path", () => {
    expect(isFirefoxBrowser({ browser: "firefox", chromePath: "/portable/browser" })).toBe(true);
    expect(isFirefoxBrowser({ browser: "custom-123", chromePath: "/usr/bin/firefox" })).toBe(true);
    expect(isFirefoxBrowser({ chromePath: "C:\\Program Files\\Mozilla Firefox\\firefox.exe" })).toBe(true);
    expect(isFirefoxBrowser({ chromePath: "/usr/bin/google-chrome" })).toBe(false);
  });

  it("uses Firefox BiDi with a persistent profile and Firefox headless options", () => {
    const options = firefoxLaunchOptions({ chromePath: "/usr/bin/firefox" }, "headless");
    expect(options).toMatchObject({ channel: "moz-firefox", executablePath: "/usr/bin/firefox", headless: true });
    expect(options).not.toHaveProperty("args");
    expect(firefoxLaunchOptions({ chromePath: "/usr/bin/firefox" }, "visible").headless).toBe(false);
  });

  it("places Snap Firefox downloads inside its accessible profile", () => {
    const options = firefoxLaunchOptions({ chromePath: "/snap/bin/firefox", firefoxSnap: true, profileDir: "/home/ada/snap/firefox/common/profile" }, "headless");
    expect(options.downloadsPath).toBe("/home/ada/snap/firefox/common/profile/browser-downloads");
  });

  it("uses the allocated nonzero debugging port for a visible Z.ai session", () => {
    const args = chromeLaunchArguments(
      { profileDir: "/existing profile" },
      "visible",
      41357,
    );
    expect(args).toContain("--user-data-dir=/existing profile");
    expect(args).toContain("--remote-debugging-port=41357");
    expect(args).not.toContain("--remote-debugging-port=0");
    expect(args).not.toContain("--headless=new");
    expect(args).not.toContain("--enable-automation");
  });

  it("lets Chrome bind an unused port even when the saved CDP port is occupied", () => {
    const args = chromeLaunchArguments(
      { profileDir: "/profile", cdpPort: 9224 },
      "headless",
    );
    expect(args).toContain("--remote-debugging-port=0");
    expect(args).not.toContain("--remote-debugging-port=9224");
  });

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
      'await ensureDedicatedBrowserMode(task.hideBrowser ? "headless" : "visible", adapter)',
    );
    expect(agent).toMatch(
      /async function openDedicatedBrowser[\s\S]*?ensureDedicatedBrowserMode\("visible", adapter\)/,
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
