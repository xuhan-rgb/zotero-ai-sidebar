import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sidebarSource = readFileSync(
  resolve(process.cwd(), "src/modules/sidebar.ts"),
  "utf8",
);
const compactMenuSource = sidebarSource.slice(
  sidebarSource.indexOf("const compactMenuOutsideClickDocuments"),
  sidebarSource.indexOf("function applySidebarDisplayMode("),
);
const toolbarSource = sidebarSource.slice(
  sidebarSource.indexOf("function renderToolbar("),
  sidebarSource.indexOf("function renderConversationSwitcher("),
);
const conversationSource = sidebarSource.slice(
  sidebarSource.indexOf("function renderConversationSwitcher("),
  sidebarSource.indexOf("async function copyCurrentConversation("),
);
const inputSource = sidebarSource.slice(
  sidebarSource.indexOf("function renderInput("),
  sidebarSource.indexOf("function composerMessageContent("),
);
const messagesSource = sidebarSource.slice(
  sidebarSource.indexOf("function renderMessages("),
  sidebarSource.indexOf("function renderNetworkDiagramTargetChip("),
);
const networkTargetSource = sidebarSource.slice(
  sidebarSource.indexOf("function renderNetworkDiagramTargetChip("),
  sidebarSource.indexOf("function renderInput("),
);
const composerFooterSource = sidebarSource.slice(
  sidebarSource.indexOf("function renderComposerFooter("),
  sidebarSource.indexOf("function renderWebSearchSwitcher("),
);
const copyDebugToggleSource = sidebarSource.slice(
  sidebarSource.indexOf("function renderCopyDebugToggle("),
  sidebarSource.indexOf("export function refreshSidebarPreferences("),
);
const sidebarCSS = readFileSync(
  resolve(process.cwd(), "addon/content/sidebar.css"),
  "utf8",
);

describe("AI dialog toolbar", () => {
  it("keeps the original toolbar as the default layout", () => {
    expect(toolbarSource).toContain(
      "copyAll.disabled = state.messages.length === 0",
    );
    expect(toolbarSource).toContain(
      "clear.disabled = visibleConversationBusy || visibleMessageCount === 0",
    );
    expect(toolbarSource).toContain(
      'state.localUiSettings.chatLayout === "compact"',
    );
    expect(toolbarSource).toContain("topRow.append(copyAll, clear, collapse)");
    expect(toolbarSource).toContain("bar.append(topRow, bottomRow)");
    expect(toolbarSource).not.toContain("if (state.messages.length > 0)");
  });

  it("clears the currently visible conversation kind", () => {
    expect(toolbarSource).toContain("state.networkDiagramTarget");
    expect(toolbarSource).toContain("sidebar?.networkDiagramMessages");
    expect(toolbarSource).toContain("clearNetworkDiagramConversation");
    expect(sidebarSource).toContain("clearNetworkDiagramMessages");
  });

  it("offers compact menus without removing the original controls", () => {
    expect(toolbarSource).toContain('"header-actions-menu"');
    expect(toolbarSource).toContain("menuContent.append(");
    expect(toolbarSource).toContain("copyAll,");
    expect(toolbarSource).toContain("clear,");
    expect(conversationSource).toContain('"conversation-actions-menu"');
    expect(conversationSource).toContain(
      "renderQuickPrompts(doc, mount, state)",
    );
    expect(conversationSource).toContain(
      "menuContent.append(historyLabel, add, remove, quickPrompts)",
    );
    expect(inputSource).toContain('"composer-attachment-menu"');
    expect(inputSource).toContain(
      "attachmentMenuContent.append(screenshotAttach, imageAttach)",
    );
    expect(conversationSource).toContain(
      "controls.append(historyLabel, add, remove)",
    );
    expect(inputSource).toContain(
      'state.localUiSettings.chatLayout === "classic"',
    );
  });

  it("routes the shared composer through a temporary network-diagram target", () => {
    expect(inputSource).toContain("renderNetworkDiagramTargetChip");
    expect(inputSource).toContain("sendComposerMessage");
    expect(sidebarSource).toContain("state.networkDiagramTarget");
    expect(sidebarSource).toContain('"📐 网络图"');
    expect(sidebarSource).toContain("runNetworkDiagramRequest");
  });

  it("offers the official generation prompt and sends selected node context", () => {
    expect(sidebarSource).toContain("networkDiagramOfficialPrompt");
    expect(sidebarSource).toContain("buildNetworkDiagramUserPrompt");
    expect(sidebarSource).toContain('"生成网络图"');
    expect(sidebarSource).toContain("networkDiagramSelectedNode");
    expect(sidebarSource).toContain("networkDiagramInstructionWithSelection");
    expect(sidebarSource).toContain("[当前选中的网络图节点]");
    expect(sidebarSource).toContain("charStart: section.charStart");
    expect(sidebarSource).toContain("charEnd: section.charEnd");
    expect(sidebarSource).toContain("paperSourceMode:");
    expect(sidebarSource).toContain('hasLatexSource ? "latex" : "pdf"');
  });

  it("shows the linked repository without auto-sending the official prompt", () => {
    expect(networkTargetSource).toContain("networkDiagramDraftRepositoryURL");
    expect(networkTargetSource).toContain(
      '"network-diagram-target-repository"',
    );
    expect(networkTargetSource).toContain("networkDiagramOfficialPrompt");
    expect(networkTargetSource).not.toContain("runNetworkDiagramRequest");
  });

  it("switches the message list to an isolated network-diagram conversation", () => {
    expect(messagesSource).toContain("if (state.networkDiagramTarget)");
    expect(messagesSource).toContain("sidebar?.networkDiagramMessages");
    expect(messagesSource).toContain("renderNetworkDiagramMessage");
    expect(messagesSource).toContain('"AI · 网络图结果"');
    expect(messagesSource).toContain('"YOU · 网络图指令"');
  });

  it("keeps a visible mode menu in both toolbar layouts", () => {
    expect(toolbarSource).toContain(
      "const layoutMenu = renderLayoutMenu(doc, mount, state)",
    );
    expect(toolbarSource).toContain(
      "topRow.append(layoutMenu, menu, collapse)",
    );
    expect(toolbarSource).toContain("settings,\n      layoutMenu,");
    expect(sidebarSource).toContain('"header-layout-menu"');
    expect(sidebarSource).toContain('"模式"');
  });

  it("toggles compact menus explicitly for Zotero XUL documents", () => {
    expect(sidebarSource).toContain(
      'summary.addEventListener("click", (event) =>',
    );
    expect(sidebarSource).toContain("event.preventDefault()");
    expect(sidebarSource).toContain('menu.toggleAttribute("open")');
  });

  it("closes menus only when the click is outside the popup DOM", () => {
    expect(compactMenuSource).toContain(
      "function installCompactMenuOutsideClick(",
    );
    expect(compactMenuSource).toMatch(
      /doc\.querySelectorAll\(\s*"details\.zai-compact-menu\[open\]"\s*,?\s*\)/,
    );
    expect(compactMenuSource).toContain('menu.removeAttribute("open")');
    expect(compactMenuSource).toContain('doc.addEventListener(\n    "click"');
    expect(compactMenuSource).toContain("event.composedPath?.() ?? []");
    expect(compactMenuSource).toContain("path.includes(menu)");
    expect(compactMenuSource).not.toContain("compactMenuSelectInteractions");
    expect(compactMenuSource).toContain("true,");
  });

  it("restores the actions popup after its debug toggle rerenders", () => {
    expect(sidebarSource).toContain("function renderPanelPreservingOpenMenus(");
    expect(sidebarSource).toContain('"data-zai-menu-key"');
    expect(copyDebugToggleSource).toContain(
      "renderPanelPreservingOpenMenus(mount, state)",
    );
  });

  it("keeps the composer cursor status on one compact line", () => {
    expect(sidebarCSS).toMatch(
      /\.zai-compact-menu:not\(\[open\]\)[^{]*\{[^}]*display:\s*none;/s,
    );
    expect(sidebarCSS).toMatch(
      /\.composer-footer-left\s*\{[^}]*flex:\s*0 0 auto;/s,
    );
    expect(sidebarCSS).toMatch(
      /\.composer-status\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*white-space:\s*nowrap;/s,
    );
    expect(sidebarCSS).toMatch(
      /\.input-row\.input-row-compact > \.composer-switchers\s*\{[^}]*left:\s*45px;/s,
    );
    expect(sidebarCSS).toMatch(
      /\.preset-switcher-bottom\s*\{[^}]*overflow:\s*visible;/s,
    );
  });

  it("keeps model, reasoning, and YOLO controls inline in compact mode", () => {
    expect(composerFooterSource).not.toContain('"composer-model-menu"');
    expect(composerFooterSource).not.toContain('"模型设置"');
    expect(composerFooterSource).toContain(
      "renderModelSwitcher(doc, mount, state),\n    renderReasoningSwitcher(doc, mount, state),\n    renderYoloToggle(doc, mount, state)",
    );
  });
});
