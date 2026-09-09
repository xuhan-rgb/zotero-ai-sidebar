import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadLatexSource,
  readSystemProxyPort,
} from "../../src/context/latex-download";

afterEach(() => vi.unstubAllGlobals());

describe("LaTeX system/direct proxy isolation", () => {
  it("reads the current system port for every new download", async () => {
    let port = 7890;
    const service = {
      newProxyInfo: vi.fn((_type, _host, actualPort) => ({ port: actualPort })),
      registerChannelFilter: vi.fn(),
      unregisterChannelFilter: vi.fn(),
    };
    const system = {
      PACURI: "",
      getProxyForURI: vi.fn(() => `PROXY 127.0.0.1:${port}`),
    };
    vi.stubGlobal("Components", {
      classes: {
        "@mozilla.org/network/protocol-proxy-service;1": {
          getService: () => service,
        },
        "@mozilla.org/system-proxy-settings;1": { getService: () => system },
      },
      interfaces: {},
    });
    vi.stubGlobal("ChromeUtils", { generateQI: () => () => {} });
    vi.stubGlobal("Zotero", {
      HTTP: {
        request: vi
          .fn()
          .mockResolvedValue({ status: 200, response: new ArrayBuffer(1) }),
      },
    });
    await downloadLatexSource("https://arxiv.org/e-print/1", 60000, {
      mode: "system",
    });
    expect(service.newProxyInfo).toHaveBeenLastCalledWith(
      "http",
      "127.0.0.1",
      7890,
      "",
      "",
      0,
      0,
      null,
    );
    port = 9090;
    await downloadLatexSource("https://arxiv.org/e-print/1", 60000, {
      mode: "system",
    });
    expect(service.newProxyInfo).toHaveBeenLastCalledWith(
      "http",
      "127.0.0.1",
      9090,
      "",
      "",
      0,
      0,
      null,
    );
    expect(system.getProxyForURI).toHaveBeenCalledTimes(2);
    expect(service.unregisterChannelFilter).toHaveBeenCalledTimes(2);
    expect(readSystemProxyPort("https://arxiv.org/e-print/1")).toBe(9090);
    await downloadLatexSource("https://arxiv.org/e-print/1", 60000, {
      mode: "system",
      portOverride: 8088,
    });
    expect(service.newProxyInfo).toHaveBeenLastCalledWith(
      "http",
      "127.0.0.1",
      8088,
      "",
      "",
      0,
      0,
      null,
    );
    expect(port).toBe(9090);
  });

  it.each(["system", "direct"] as const)(
    "overrides only source channels in %s mode",
    async (mode) => {
      let filter: any;
      const chosen = { type: "http", host: "os-proxy" };
      const service = {
        newProxyInfo: vi.fn(() => chosen),
        registerChannelFilter: vi.fn((value) => {
          filter = value;
        }),
        unregisterChannelFilter: vi.fn(),
      };
      const system = {
        PACURI: "",
        getProxyForURI: vi
          .fn()
          .mockReturnValueOnce("PROXY os-proxy:8080")
          .mockReturnValueOnce("DIRECT"),
      };
      vi.stubGlobal("Components", {
        classes: {
          "@mozilla.org/network/protocol-proxy-service;1": {
            getService: () => service,
          },
          "@mozilla.org/system-proxy-settings;1": { getService: () => system },
        },
        interfaces: {},
        results: { NS_ERROR_FAILURE: 1 },
      });
      vi.stubGlobal("ChromeUtils", { generateQI: () => () => {} });
      vi.stubGlobal("Zotero", {
        HTTP: {
          request: vi.fn(async (_method, _url, options) => {
            const own = {},
              unrelated = {},
              redirected = { URI: { spec: "https://export.arxiv.org/src/1" } };
            const original = { type: "http", host: "zotero-proxy" };
            options.requestObserver({ channel: own });
            const result = vi.fn();
            filter.applyFilter(own, original, { onProxyFilterResult: result });
            expect(result).toHaveBeenLastCalledWith(
              mode === "system" ? chosen : null,
            );
            filter.applyFilter(unrelated, original, {
              onProxyFilterResult: result,
            });
            expect(result).toHaveBeenLastCalledWith(original);
            const verify = vi.fn();
            options.notificationCallbacks.asyncOnChannelRedirect(
              own,
              redirected,
              0,
              { onRedirectVerifyCallback: verify },
            );
            expect(verify).toHaveBeenCalledWith(0);
            filter.applyFilter(redirected, original, {
              onProxyFilterResult: result,
            });
            expect(result).toHaveBeenLastCalledWith(null);
            throw new Error("connection failed");
          }),
        },
      });
      await expect(
        downloadLatexSource("https://arxiv.org/e-print/1", 60000, { mode }),
      ).rejects.toThrow("connection failed");
      expect(service.unregisterChannelFilter).toHaveBeenCalledWith(filter);
      if (mode === "system") {
        expect(system.getProxyForURI).toHaveBeenCalledWith(
          "https://arxiv.org/e-print/1",
          "https",
          "arxiv.org",
          -1,
        );
        expect(service.newProxyInfo).toHaveBeenCalledWith(
          "http",
          "os-proxy",
          8080,
          "",
          "",
          0,
          0,
          null,
        );
      } else {
        expect(system.getProxyForURI).not.toHaveBeenCalled();
        expect(service.newProxyInfo).not.toHaveBeenCalled();
      }
    },
  );
});
