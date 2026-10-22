/** Gecko module timers also work when the add-on sandbox has no live window. */
export function webAgentTimers(): Pick<typeof globalThis, "setTimeout" | "clearTimeout"> {
  const chromeUtils = (globalThis as any).ChromeUtils;
  if (typeof chromeUtils?.importESModule === "function") {
    return chromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
  }
  return {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };
}
