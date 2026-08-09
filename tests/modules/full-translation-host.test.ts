import { describe, expect, it } from "vitest";

import {
  mountFullTranslationHost,
  unmountFullTranslationHost,
} from "../../src/modules/full-translation-host";

describe("full translation host", () => {
  it("temporarily replaces the active reader tab without destroying it", () => {
    const tab = document.createElement("section");
    tab.id = "tab-paper";
    const reader = document.createElement("iframe");
    reader.id = "reader-pdf";
    tab.append(reader);
    document.body.append(tab);

    const host = mountFullTranslationHost(document, "tab-paper");

    expect(host).not.toBeNull();
    expect(reader.getAttribute("hidden")).toBe("true");
    expect(tab.querySelector(".zai-full-translation-host")).toBe(host?.root);

    unmountFullTranslationHost(host!);

    expect(reader.hasAttribute("hidden")).toBe(false);
    expect(tab.querySelector(".zai-full-translation-host")).toBeNull();
    expect(tab.querySelector("#reader-pdf")).toBe(reader);
  });

  it("restores an existing hidden state exactly", () => {
    const tab = document.createElement("section");
    tab.id = "tab-hidden-reader";
    const hidden = document.createElement("div");
    hidden.setAttribute("hidden", "custom");
    tab.append(hidden);
    document.body.append(tab);

    const host = mountFullTranslationHost(document, "tab-hidden-reader");
    unmountFullTranslationHost(host!);

    expect(hidden.getAttribute("hidden")).toBe("custom");
  });
});
