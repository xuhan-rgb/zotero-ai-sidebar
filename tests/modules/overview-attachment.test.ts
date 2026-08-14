import { beforeEach, describe, expect, it, vi } from "vitest";
import { openOverviewInBrowser } from "../../src/modules/overview-attachment";
import {
  states,
  type WindowSidebarState,
} from "../../src/modules/sidebar-state";

describe("openOverviewInBrowser", () => {
  let launchFile: ReturnType<typeof vi.fn>;
  let launchWithURI: ReturnType<typeof vi.fn>;
  let getAppForURIScheme: ReturnType<typeof vi.fn>;
  let sidebar: WindowSidebarState;

  beforeEach(() => {
    launchFile = vi.fn();
    launchWithURI = vi.fn();
    getAppForURIScheme = vi.fn(() => ({ launchWithURI }));

    Object.defineProperty(globalThis, "Zotero", {
      configurable: true,
      value: {
        DataDirectory: { dir: "/tmp/zotero-data" },
        Profile: { dir: "/tmp/zotero-profile" },
        isLinux: true,
        Items: { get: () => ({ key: "ITEMKEY" }) },
        File: {
          getContentsAsync: async () =>
            JSON.stringify({
              entries: {
                ITEMKEY: {
                  data: {
                    title: "Paper",
                    source: "pdf",
                    coverage: "headings",
                    sections: [
                      {
                        no: "1",
                        level: 1,
                        title: "Intro",
                        charStart: 0,
                        charEnd: 1,
                      },
                    ],
                  },
                  updatedAt: 1,
                },
              },
            }),
          putContentsAsync: async () => undefined,
          pathToFile: (path: string) => ({ path }),
        },
        launchFile,
      },
    });
    Object.defineProperty(globalThis, "IOUtils", {
      configurable: true,
      value: { makeDirectory: async () => undefined },
    });
    Object.defineProperty(globalThis, "Services", {
      configurable: true,
      value: {
        io: {
          newFileURI: (file: { path: string }) => ({
            spec: `file://${file.path}`,
          }),
        },
      },
    });
    Object.defineProperty(globalThis, "Components", {
      configurable: true,
      value: {
        classes: {
          "@mozilla.org/gio-service;1": {
            getService: () => ({ getAppForURIScheme }),
          },
        },
        interfaces: {
          nsIGIOService: {},
        },
      },
    });

    const mount = document.createElement("div");
    sidebar = {
      mount,
      noteMount: document.createElement("div"),
    } as unknown as WindowSidebarState;
    states.set(mount, { itemID: 123 } as never);
  });

  it("opens the exported HTML with the default browser, not its file association", async () => {
    await openOverviewInBrowser(sidebar);

    expect(getAppForURIScheme).toHaveBeenCalledWith("http");
    expect(launchWithURI).toHaveBeenCalledOnce();
    expect(launchWithURI).toHaveBeenCalledWith({
      spec: "file:///tmp/zotero-data/zotero-ai-sidebar/overview-Paper-ITEMKEY.html",
    });
    expect(launchFile).not.toHaveBeenCalled();
  });
});
