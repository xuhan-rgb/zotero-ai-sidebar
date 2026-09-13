import { describe, it, expect, vi, afterEach } from "vitest";
import { traceBrowserPicker } from "../../src/modules/browser-picker-debug";

afterEach(() => vi.unstubAllGlobals());
describe("browser picker diagnostics", () => {
  it("records lifecycle and event state without form or conversation content", () => {
    const debug = vi.fn();
    vi.stubGlobal("Zotero", { debug });
    const menu = document.createElement("details");
    menu.open = true;
    menu.dataset.browserDebugId = "1";
    const input = document.createElement("input");
    input.value = "private executable path";
    menu.append(input, "private conversation");
    traceBrowserPicker("outside-guard:CLOSE", menu);
    const log = debug.mock.calls[0][0];
    expect(log).toContain('"reason":"outside-guard:CLOSE"');
    expect(log).toContain('"open":true');
    expect(log).not.toContain("private");
  });
});
