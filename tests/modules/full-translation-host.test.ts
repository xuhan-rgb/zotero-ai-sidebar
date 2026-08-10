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

  it("leaves an adjacent AI sidebar visible by default", () => {
    const tab = document.createElement("section");
    tab.id = "tab-with-visible-sidebar";
    tab.append(document.createElement("iframe"));
    const aiColumn = document.createElement("aside");
    document.body.append(tab, aiColumn);

    const host = mountFullTranslationHost(document, tab.id);

    expect(aiColumn.hasAttribute("hidden")).toBe(false);
    unmountFullTranslationHost(host!);
  });

  it("temporarily hides adjacent UI and restores its prior state", () => {
    const tab = document.createElement("section");
    tab.id = "tab-with-sidebar";
    tab.append(document.createElement("iframe"));

    const splitter = document.createElement("hr");
    const aiColumn = document.createElement("aside");
    const alreadyHidden = document.createElement("aside");
    alreadyHidden.setAttribute("hidden", "custom");
    document.body.append(tab, splitter, aiColumn, alreadyHidden);

    const host = mountFullTranslationHost(document, "tab-with-sidebar", [
      splitter,
      aiColumn,
      alreadyHidden,
    ]);

    expect(splitter.getAttribute("hidden")).toBe("true");
    expect(aiColumn.getAttribute("hidden")).toBe("true");
    expect(alreadyHidden.getAttribute("hidden")).toBe("true");

    unmountFullTranslationHost(host!);

    expect(splitter.hasAttribute("hidden")).toBe(false);
    expect(aiColumn.hasAttribute("hidden")).toBe(false);
    expect(alreadyHidden.getAttribute("hidden")).toBe("custom");
  });
});
