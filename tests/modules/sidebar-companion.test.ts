import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sidebarSource = readFileSync(
  resolve(process.cwd(), "src/modules/sidebar.ts"),
  "utf8",
);
const sidebarCSS = readFileSync(
  resolve(process.cwd(), "addon/content/sidebar.css"),
  "utf8",
);

describe("optional docked sidebar layout", () => {
  it("keeps the sidebar in the Zotero main document", () => {
    expect(sidebarSource).toContain("function reconcileSidebarDisplayMode(");
    expect(sidebarSource).toContain("function enterDockedSidebarLayout(");
    expect(sidebarSource).toContain("function leaveDockedSidebarLayout(");
    expect(sidebarSource).not.toContain("openCompanionSidebar");
    expect(sidebarSource).not.toContain("adoptNode(sidebar.mount)");
    expect(sidebarSource).not.toContain("content/companion.xhtml");
  });

  it("renders docked mode as a full-height sibling of Zotero chrome", () => {
    expect(sidebarSource).toContain('classList.add("zai-docked-window")');
    expect(sidebarSource).toContain('classList.remove("zai-docked-window")');
    expect(sidebarSource).toContain('"--zai-docked-width"');
    expect(sidebarSource).toContain("installDockedSplitterDrag(");
    expect(sidebarSource).toContain("mountDockedColumn(existing, sidebar)");
    expect(sidebarSource).toContain("entry.columnParent.insertBefore(");
    expect(sidebarSource).toContain("function alignDockedColumnToWindow(");
    expect(sidebarSource).toContain("getBoundingClientRect().top");
    expect(sidebarSource).toContain("mainWindow.innerHeight");
  });

  it("docks the optional note column together with the AI column", () => {
    expect(sidebarSource).toContain(
      "root.append(\n    sidebar.noteSplitter,\n    sidebar.noteColumn,\n    sidebar.splitter,\n    sidebar.column,\n  )",
    );
    expect(sidebarSource).toContain("function syncDockedWorkspaceLayout(");
    expect(sidebarSource).toContain("syncDockedWorkspaceLayout(state)");
    expect(sidebarSource).toContain("installDockedNoteSplitterDrag(");
    expect(sidebarCSS).toContain(
      ":root.zai-docked-window.zai-docked-note-visible #zai-note-column",
    );
    expect(sidebarCSS).toContain("var(--zai-docked-total-width)");
    expect(sidebarSource).toContain("const DOCKED_NOTE_SPLITTER_WIDTH = 4");
    expect(sidebarCSS).toMatch(
      /zai-docked-note-visible #zai-note-column-splitter\s*\{[^}]*min-width:\s*4px;/s,
    );
  });

  it("keeps the Zotero main-window geometry unchanged while switching modes", () => {
    expect(sidebarSource).toContain("const dockedSidebarLayouts = new WeakMap");
    expect(sidebarSource).toContain("columnWidth:");
    expect(sidebarSource).toContain("columnPersistence:");
    expect(sidebarSource).toContain('removeAttribute("zotero-persist")');
    expect(sidebarSource).toContain(
      "setAiColumnWidth(sidebar, entry.columnWidth)",
    );
    expect(sidebarSource).not.toContain("mainWindow.moveTo(");
    expect(sidebarSource).not.toContain("mainWindow.resizeTo(");
    expect(sidebarSource).not.toContain("restoreMainWindow(");
  });

  it("reserves readable width for Zotero before sizing docked panels", () => {
    expect(sidebarSource).toContain(
      "const MIN_ZOTERO_DOCKED_CONTENT_WIDTH = 720",
    );
    expect(sidebarSource).toContain("function fitDockedWorkspaceToWindow(");
    expect(sidebarSource).toMatch(
      /mainWindow\.innerWidth\s*-\s*MIN_ZOTERO_DOCKED_CONTENT_WIDTH/,
    );
    expect(sidebarSource).toContain(
      "fitDockedWorkspaceToWindow(entry, sidebar)",
    );
  });

  it("keeps embedded mode as the default and toggles docked mode in place", () => {
    expect(sidebarSource).toContain(
      'localSettings.sidebarDisplayMode === "docked"',
    );
    expect(sidebarSource).toContain("collapseEmbeddedSidebar(sidebar)");
    expect(sidebarSource).not.toContain(
      'sidebarDisplayMode: "docked" as const',
    );
  });

  it("applies DOM-contained layout choices directly to the current window", () => {
    expect(sidebarSource).toContain("function renderLayoutChoice(");
    expect(sidebarSource).not.toContain(
      "function installImmediateSelectHandler(",
    );
    expect(sidebarSource).toContain('"header-layout-choice-trigger"');
    expect(sidebarSource).toContain('"header-layout-choice-options"');
    expect(sidebarSource).toContain('["compact", "专注模式"]');
    expect(sidebarSource).toContain('["embedded", "阅读器侧栏"]');
    expect(sidebarSource).toContain('["docked", "右侧并排"]');
    expect(sidebarSource).toContain('control.toggleAttribute("open", opening)');
    expect(sidebarSource).toContain(
      'option.addEventListener("click", () => onSelect(value))',
    );
    expect(sidebarSource).toContain("function applySidebarDisplayMode(");
    expect(sidebarSource).toContain("state.localUiSettings = next");
    expect(sidebarSource).toContain(
      "reconcileSidebarDisplayMode(hostWindow, sidebar, next, previousMode)",
    );
    expect(sidebarSource).toContain("renderLayoutChoice(");
    expect(sidebarSource).toContain(
      "applySidebarDisplayMode(mount, state, value)",
    );
    expect(sidebarSource).toContain("function renderPanelPreservingOpenMenus(");
    expect(sidebarSource).toContain(
      "renderPanelPreservingOpenMenus(mount, state)",
    );
  });
});
