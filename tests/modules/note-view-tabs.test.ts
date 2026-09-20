import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it, vi } from "vitest";

const source = readFileSync("src/modules/sidebar.ts", "utf8");
const body = source.slice(source.indexOf("function buildNoteSeg("), source.indexOf("// ⋯ overflow menu"));
const javascript = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

it("allows route navigation while a task is running and highlights the route view", () => {
  const openRouteView = vi.fn();
  const build = new Function("XHTML_NS", "states", "buttonEl", "openRouteView", "switchNoteFile", "showOverviewWindow", `${javascript}; return buildNoteSeg;`)(
    "http://www.w3.org/1999/xhtml", { get: () => ({ sending: true }) },
    (doc: Document, label: string) => { const b = doc.createElement("button"); b.textContent = label; return b; },
    openRouteView, vi.fn(), vi.fn(),
  );
  const sidebar = { mount: document.createElement("div") };
  const tabs = build(document, sidebar, "normal");
  const route = tabs.querySelectorAll("button")[1];
  expect(route.disabled).toBe(false);
  route.click();
  expect(route.classList.contains("on")).toBe(true);
  expect(tabs.querySelectorAll("button.on")).toHaveLength(1);
  expect(openRouteView).toHaveBeenCalledWith(sidebar);
  tabs.querySelectorAll("button")[0].click();
  expect(tabs.querySelector("button.on").textContent).toBe("笔记");
  const selected = build(document, sidebar, "readingRoute");
  expect(selected.querySelectorAll("button.on")).toHaveLength(1);
  expect(selected.querySelector("button.on").textContent).toBe("路线");
});
