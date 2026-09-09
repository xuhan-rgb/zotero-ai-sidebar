import type { LatexProxySettings } from "../settings/latex-proxy";

interface DownloadResponse {
  status: number;
  response: ArrayBuffer;
}

// Native system settings return a PAC-style list, including bypass rules.
function systemProxyForURL(
  url: string,
  system: nsISystemProxySettings,
  service: nsIProtocolProxyService,
  portOverride?: number,
): nsIProxyInfo | null {
  if (system.PACURI) {
    throw new Error(
      "当前系统使用 PAC 自动代理，LaTeX 下载暂不支持；可选择不使用代理",
    );
  }
  const uri = new URL(url);
  const rules = system.getProxyForURI(
    url,
    uri.protocol.slice(0, -1),
    uri.hostname,
    uri.port ? Number(uri.port) : -1,
  );
  let proxy: nsIProxyInfo | null = null;
  const entries = rules.split(";");
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index].trim();
    if (!entry || entry === "DIRECT") {
      proxy = null;
      continue;
    }
    const match =
      /^(PROXY|HTTPS|SOCKS|SOCKS4|SOCKS5)\s+(\[[^\]]+\]|[^:\s]+):(\d+)$/i.exec(
        entry,
      );
    if (!match) throw new Error("无法识别系统代理配置");
    const kind = match[1].toUpperCase();
    const type =
      kind === "PROXY"
        ? "http"
        : kind === "HTTPS"
          ? "https"
          : kind === "SOCKS4"
            ? "socks4"
            : "socks";
    const host = match[2].replace(/^\[|\]$/g, "");
    // Gecko permits null for no failover; generated typings omit nullability.
    proxy = service.newProxyInfo(
      type,
      host,
      index === 0 ? (portOverride ?? Number(match[3])) : Number(match[3]),
      "",
      "",
      type === "socks" ? 1 : 0,
      0,
      proxy as nsIProxyInfo,
    );
  }
  return proxy;
}

// Only this download and its redirects are overridden, never unrelated traffic.
// Zotero's XHR API avoids the Gecko fetch binary-response issue for arXiv.
export async function downloadLatexSource(
  url: string,
  timeout: number,
  settings: LatexProxySettings,
): Promise<DownloadResponse> {
  const { service, system } = nativeProxyServices(settings.mode);
  const resolve = (target: string) =>
    system
      ? systemProxyForURL(target, system, service, settings.portOverride)
      : null;
  const initial = resolve(url);
  const channels = new Map<nsIChannel, nsIProxyInfo | null>();
  let redirectError: unknown;
  const filter = {
    QueryInterface: ChromeUtils.generateQI(["nsIProtocolProxyChannelFilter"]),
    applyFilter(
      channel: nsIChannel,
      original: nsIProxyInfo,
      callback: nsIProxyProtocolFilterResult,
    ) {
      callback.onProxyFilterResult(
        (channels.has(channel)
          ? channels.get(channel)
          : original) as nsIProxyInfo,
      );
    },
  };
  const options = {
    responseType: "arraybuffer",
    timeout,
    requestObserver(request: { channel: nsIChannel }) {
      channels.set(request.channel, initial);
    },
    notificationCallbacks: {
      asyncOnChannelRedirect(
        oldChannel: nsIChannel,
        newChannel: nsIChannel,
        _flags: number,
        callback: nsIAsyncVerifyRedirectCallback,
      ) {
        try {
          if (channels.has(oldChannel))
            channels.set(newChannel, resolve(newChannel.URI.spec));
          callback.onRedirectVerifyCallback(0);
        } catch (error) {
          redirectError = error;
          callback.onRedirectVerifyCallback(
            Components.results.NS_ERROR_FAILURE,
          );
        }
      },
    },
  };
  service.registerChannelFilter(filter, 0);
  try {
    return (await Zotero.HTTP.request("GET", url, options)) as DownloadResponse;
  } catch (error) {
    throw redirectError ?? error;
  } finally {
    service.unregisterChannelFilter(filter);
  }
}

function nativeProxyServices(mode: LatexProxySettings["mode"]) {
  const classes = Components.classes as unknown as Record<
    string,
    {
      getService(iid: unknown): unknown;
    }
  >;
  const service = classes[
    "@mozilla.org/network/protocol-proxy-service;1"
  ].getService(
    Components.interfaces.nsIProtocolProxyService,
  ) as nsIProtocolProxyService;
  const system =
    mode === "system"
      ? (classes["@mozilla.org/system-proxy-settings;1"].getService(
          Components.interfaces.nsISystemProxySettings,
        ) as nsISystemProxySettings)
      : null;
  return { service, system };
}

export function readSystemProxyPort(url: string): number | null {
  const { service, system } = nativeProxyServices("system");
  return systemProxyForURL(url, system!, service)?.port ?? null;
}
