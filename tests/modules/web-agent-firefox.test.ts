import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  firefoxLaunchOptions,
  isFirefoxBrowser,
} from "../../web-agent/browser-mode.mjs";

const source = readFileSync("web-agent/agent.mjs", "utf8");

// Exercise the Agent's actual lifecycle functions without starting a GUI browser.
function fixture() {
  const contexts: any[] = [];
  const launchPersistentContext = vi.fn(async () => {
    const ctx = new EventEmitter() as any;
    const page = {
      url: vi.fn(() => "about:blank"),
      goto: vi.fn(async (url: string) => page.url.mockReturnValue(url)),
    };
    ctx.pages = () => [page];
    ctx.newPage = vi.fn(async () => page);
    ctx.close = vi.fn(async () => ctx.emit("close"));
    contexts.push(ctx);
    return ctx;
  });
  const readDevToolsEndpoint = vi.fn(async () => {
    throw new Error("Firefox must not use Chrome's DevTools endpoint");
  });
  const names = [
    "ensureContext",
    "openDedicatedBrowser",
    "hideDedicatedBrowser",
    "ensureDedicatedBrowserMode",
    "startDedicatedBrowser",
    "stopDedicatedBrowser",
    "resetBrowserConnection",
    "currentBrowserMode",
  ];
  const functions = names
    .map((name) => {
      const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
      const rest = source.slice(start);
      const end = rest.slice(1).search(/\n(?:async )?function /);
      return end < 0 ? rest : rest.slice(0, end + 1);
    })
    .join("\n");
  const create = new Function(
    "firefox",
    "isFirefoxBrowser",
    "firefoxLaunchOptions",
    "readDevToolsEndpoint",
    `
    const config = { browser: "custom-existing", chromePath: "/usr/bin/firefox", profileDir: "/firefox-profile" };
    let context, cdpBrowser, contextConnecting, browserLaunching, browserTransition, browserMode;
    let accountWindowVisible = false, preserveBrowserSession = false;
    const sessions = new Map(), activeTasks = new Map();
    const providerDefinition = () => ({ host: "chat.deepseek.com", url: "https://chat.deepseek.com/" });
    const isGLMAdapter = () => false;
    const showBrowserWindow = async () => true;
    const accountReady = async () => true;
    const pageVerificationRequired = async () => false;
    const restoreFirefoxSessionCookies = async () => {};
    const saveFirefoxSessionCookies = async () => {};
    ${functions}
    return { openDedicatedBrowser, hideDedicatedBrowser, ensureDedicatedBrowserMode, currentBrowserMode, sessions,
      currentContext: () => context };
  `,
  );
  const agent = create(
    { launchPersistentContext },
    isFirefoxBrowser,
    firefoxLaunchOptions,
    readDevToolsEndpoint,
  );
  return { agent, contexts, launchPersistentContext, readDevToolsEndpoint };
}

describe("Firefox Agent lifecycle", () => {
  it("reuses Firefox's initial blank page for account login", async () => {
    const { agent, contexts } = fixture();
    await agent.openDedicatedBrowser("deepseek");
    expect(contexts[0].newPage).not.toHaveBeenCalled();
  });

  it("serializes concurrent requests to switch Firefox into background mode", async () => {
    const { agent, launchPersistentContext } = fixture();
    const launch = launchPersistentContext.getMockImplementation()!;
    launchPersistentContext.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 1));
      return launch();
    });
    await agent.openDedicatedBrowser("deepseek");
    await Promise.all([
      agent.ensureDedicatedBrowserMode("headless", { host: "chat.deepseek.com" }),
      agent.ensureDedicatedBrowserMode("headless", { host: "chat.deepseek.com" }),
    ]);
    expect(launchPersistentContext).toHaveBeenCalledTimes(2);
  });

  it("opens the DeepSeek login URL over Firefox BiDi without waiting for Chrome", async () => {
    const { agent, contexts, launchPersistentContext, readDevToolsEndpoint } =
      fixture();
    expect(await agent.openDedicatedBrowser("deepseek")).toMatchObject({
      browserOpen: true,
      url: "https://chat.deepseek.com/",
      configured: true,
    });
    expect(launchPersistentContext).toHaveBeenCalledWith(
      "/firefox-profile",
      expect.objectContaining({
        channel: "moz-firefox",
        executablePath: "/usr/bin/firefox",
        headless: false,
      }),
    );
    expect(contexts[0].pages()[0].goto).toHaveBeenCalledWith(
      "https://chat.deepseek.com/",
      expect.any(Object),
    );
    expect(await agent.currentBrowserMode()).toBe("visible");
    expect(readDevToolsEndpoint).not.toHaveBeenCalled();
  });

  it("closes the login context and reuses its profile for hidden tasks", async () => {
    const { agent, contexts, launchPersistentContext } = fixture();
    await agent.openDedicatedBrowser("deepseek");
    agent.sessions.set("deepseek", {});
    expect(await agent.hideDedicatedBrowser("deepseek")).toMatchObject({
      browserOpen: false,
      configured: true,
    });
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(agent.sessions.size).toBe(0);
    expect(await agent.currentBrowserMode()).toBeUndefined();
    await agent.ensureDedicatedBrowserMode("headless", {
      host: "chat.deepseek.com",
    });
    expect(launchPersistentContext).toHaveBeenLastCalledWith(
      "/firefox-profile",
      expect.objectContaining({ headless: true }),
    );
    await agent.ensureDedicatedBrowserMode("headless", {
      host: "chat.deepseek.com",
    });
    expect(launchPersistentContext).toHaveBeenCalledTimes(2);
    await agent.ensureDedicatedBrowserMode("visible", {
      host: "chat.deepseek.com",
    });
    expect(contexts[1].close).toHaveBeenCalledOnce();
    expect(launchPersistentContext).toHaveBeenCalledTimes(3);
  });

  it("clears stale context and sessions after the user closes Firefox", async () => {
    const { agent, contexts } = fixture();
    await agent.openDedicatedBrowser("deepseek");
    agent.sessions.set("deepseek", {});
    contexts[0].emit("close");
    expect(agent.currentContext()).toBeUndefined();
    expect(agent.sessions.size).toBe(0);
    expect(await agent.currentBrowserMode()).toBeUndefined();
  });

  it("reports Firefox startup errors without leaving a connected context", async () => {
    const { agent, launchPersistentContext } = fixture();
    launchPersistentContext.mockRejectedValueOnce(
      new Error("Firefox cannot access profile"),
    );
    await expect(agent.openDedicatedBrowser("deepseek")).rejects.toThrow(
      "Firefox cannot access profile",
    );
    expect(agent.currentContext()).toBeUndefined();
    expect(await agent.currentBrowserMode()).toBeUndefined();
    await expect(agent.openDedicatedBrowser("deepseek")).resolves.toMatchObject(
      { browserOpen: true },
    );
  });
});
