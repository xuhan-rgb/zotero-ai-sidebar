import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

describe("Web Agent host shutdown", () => {
  it.each([2, 4])(
    "awaits plugin cleanup on Zotero exit and plugin disable (reason %s)",
    async (reason) => {
      const onShutdown = vi.fn(async () => undefined);
      const scope = {
        APP_SHUTDOWN: 2,
        Zotero: { __addonInstance__: { hooks: { onShutdown } } },
      };
      vm.createContext(scope);
      vm.runInContext(readFileSync("addon/bootstrap.js", "utf8"), scope);
      await vm.runInContext(`shutdown({}, ${reason})`, scope);
      expect(onShutdown).toHaveBeenCalledOnce();
    },
  );
});
