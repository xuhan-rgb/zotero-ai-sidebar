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
const conversationMutationSource = sidebarSource.slice(
  sidebarSource.indexOf("function switchConversation("),
  sidebarSource.indexOf("function nextConversationTitle("),
);
const switchConversationSource = sidebarSource.slice(
  sidebarSource.indexOf("function switchConversation("),
  sidebarSource.indexOf("function addConversation("),
);
const addConversationSource = sidebarSource.slice(
  sidebarSource.indexOf("function addConversation("),
  sidebarSource.indexOf("function branchConversationFromMessage("),
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
const bubbleSource = sidebarSource.slice(
  sidebarSource.indexOf("function bubble("),
  sidebarSource.indexOf("function renderMessageUsage("),
);
const sidebarCSS = readFileSync(
  resolve(process.cwd(), "addon/content/sidebar.css"),
  "utf8",
);

describe("AI dialog toolbar", () => {
  it("shows dismissible signatures only in the empty normal conversation", () => {
    expect(messagesSource).toContain('state.messages.length === 0');
    expect(messagesSource).toContain('messages.classList.add("messages-empty")');
    expect(messagesSource).toContain('renderEmptySignatures(');
    expect(messagesSource).toContain(
      'assistantSignaturesEnabled: false',
    );
    expect(messagesSource).toContain(
      'saveUiSettings(zoteroPrefs(), state.uiSettings)',
    );
    expect(sidebarCSS).toContain('.empty-signatures {');
    expect(sidebarCSS).toContain('.empty-signatures:hover .empty-signature-close');
  });

  it("keeps the visible toolbar row draggable in a docked window", () => {
    expect(sidebarCSS).toContain(
      ":root.zai-docked-window .zai-root-docked .preset-switcher-bottom {",
    );
    expect(sidebarCSS).toContain("-moz-window-dragging: drag;");
    expect(sidebarCSS).toContain(
      ":root.zai-docked-window .zai-root-docked .preset-switcher-bottom button",
    );
  });

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
    expect(toolbarSource).toContain("bar.append(bottomRow)");
    expect(toolbarSource).not.toContain("if (state.messages.length > 0)");
  });

  it("clears the currently visible conversation kind", () => {
    expect(toolbarSource).toContain("state.networkDiagramTarget");
    expect(toolbarSource).toContain("sidebar?.networkDiagramMessages");
    expect(toolbarSource).toContain("clearNetworkDiagramConversation");
    expect(sidebarSource).toContain("clearNetworkDiagramMessages");
  });

  it("keeps conversation controls beside the compact actions menu", () => {
    expect(toolbarSource).toContain('"header-actions-menu"');
    expect(toolbarSource).toContain("menuContent.append(");
    expect(toolbarSource).toContain("copyAll,");
    expect(toolbarSource).toContain("clear,");
    expect(conversationSource).toContain('"conversation-actions-menu"');
    expect(conversationSource).toContain(
      "renderQuickPrompts(doc, mount, state)",
    );
    expect(conversationSource).toContain("menuContent.append(quickPrompts)");
    expect(conversationSource).toContain(
      "controls.append(historyLabel, add, remove, copyAll, clear, menu)",
    );
    expect(conversationSource).toMatch(
      /historyLabel\.prepend\(\s*el\(doc, "span", "conversation-history-label", "上下文"\)/,
    );
    expect(inputSource).toContain('"composer-attachment-menu"');
    expect(inputSource).toContain(
      "attachmentMenuContent.append(screenshotAttach, imageAttach)",
    );
    expect(conversationSource).toContain(
      "controls.append(historyLabel, add, remove, copyAll, clear)",
    );
    expect(composerFooterSource).not.toContain(
      "actions.append(screenshotAttach, imageAttach)",
    );
  });

  it("does not expose DeepSeek or ChatGPT web mode selectors in the composer", () => {
    expect(composerFooterSource).not.toContain(
      "renderDeepSeekModeSwitcher",
    );
    expect(composerFooterSource).not.toContain(
      "renderChatGPTReasoningSwitcher",
    );
    expect(sidebarSource).not.toContain("composer-deepseek-mode-select");
    expect(sidebarSource).not.toContain(
      "composer-chatgpt-reasoning-select",
    );
    expect(sidebarCSS).not.toContain(".composer-deepseek-mode-select");
    expect(sidebarCSS).not.toContain(".composer-chatgpt-reasoning-select");
    expect(composerFooterSource).not.toContain("renderDeepSeekOptionToggle");
    expect(sidebarSource).not.toContain("composer-deepseek-option-toggle");
  });

  it("does not reserve a footer control for an empty composer status", () => {
    expect(composerFooterSource).toContain("left.hidden = status.hidden");
    expect(sidebarSource).toContain("status.hidden = parts.length === 0");
    expect(sidebarSource).toContain(
      'container?.classList.contains("composer-footer-left")',
    );
    expect(sidebarSource).toContain("container.hidden = status.hidden");
  });

  it("keeps the default conversation delete action disabled", () => {
    expect(conversationSource).toContain(
      'activeConversation(state)?.id === "default"',
    );
    expect(conversationMutationSource).toContain('current.id === "default"');
    expect(sidebarCSS).toContain(".conversation-icon:hover:not(:disabled)");
    expect(sidebarCSS).toContain(".conversation-delete:disabled");
    expect(conversationMutationSource).toContain(
      "state.uiSettings.confirmConversationDeletion",
    );
    expect(conversationMutationSource).toContain(
      "state.conversations[currentIndex] ??",
    );
    expect(conversationMutationSource).toContain(
      "state.conversations[currentIndex - 1]",
    );
  });

  it("allows creating and switching conversations while an answer is running", () => {
    expect(conversationSource).toContain("tab.disabled = !state.historyLoaded");
    expect(conversationSource).toContain("add.disabled = !state.historyLoaded");
    expect(switchConversationSource).not.toContain("state.sending");
    expect(addConversationSource).not.toContain("state.sending");
  });

  it("keeps a background answer bound to its source conversation", () => {
    expect(sidebarSource).toContain(
      "const taskMessages = options.messages ?? state.messages",
    );
    expect(sidebarSource).toContain(
      "const runtime = conversationRuntime(state, taskConversationID)",
    );
    expect(sidebarSource).toContain("firstQueuedChatTaskAcrossConversations(");
  });

  it("runs different conversations in parallel while keeping each conversation serial", () => {
    expect(sidebarSource).toContain(
      "conversationRuntime(state, taskConversationID)",
    );
    expect(sidebarSource).toContain("activeConversationTaskCount(state)");
    expect(sidebarSource).toContain(
      "state.uiSettings.maxParallelConversations",
    );
    expect(sidebarSource).toContain(
      "conversationIsSending(state, state.activeConversationID)",
    );
    expect(sidebarSource).toContain("excludedConversationIDs");
  });

  it("shows completed background conversations as unread until opened", () => {
    expect(conversationSource).toContain("conversationHasUnreadAnswer(");
    expect(conversationSource).toContain('"conversation-tab-unread"');
    expect(switchConversationSource).toContain("markAllChatTasksRead(state)");
    expect(sidebarCSS).toContain(".conversation-tab-unread");
  });

  it("offers a full-context branch action on each message", () => {
    expect(bubbleSource).toContain('buttonEl(doc, "分支")');
    expect(bubbleSource).toContain(
      "branchConversationFromMessage(mount, state, index)",
    );
    expect(conversationMutationSource).toContain("createBranchedConversation(");
    expect(conversationMutationSource).toContain(
      "state.conversations.push(conversation)",
    );
    expect(messagesSource).toContain("renderConversationBranchOrigin");
    expect(sidebarCSS).toContain(".conversation-branch-origin");
  });

  it("marks branch conversation tabs with their source conversation", () => {
    expect(conversationSource).toContain("conversation.branchOrigin");
    expect(conversationSource).toContain('"conversation-tab-branch-origin"');
    expect(conversationSource).toContain("branchOriginConversationLabel(");
    expect(sidebarCSS).toContain(".conversation-tab-branch-origin");
    expect(sidebarCSS).toContain(
      ".conversation-tab.is-active .conversation-tab-branch-origin",
    );
    expect(sidebarCSS).toContain(
      ".conversation-tab.has-branch-origin:not(.is-active)",
    );
    expect(sidebarCSS).toMatch(
      /\.conversation-tab\.has-branch-origin:not\(\.is-active\)\s*\{[^}]*border-style:\s*dashed/s,
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
      "bottomRow.append(openNote, layoutMenu, askBtn, menu, collapse)",
    );
    expect(toolbarSource).toContain(
      "layoutMenu,\n      askBtn,\n      settings,",
    );
    expect(sidebarSource).toContain('"header-layout-menu"');
    expect(sidebarSource).toContain('"模式"');
  });

  it("keeps note and immersive controls beside mode in compact layout", () => {
    expect(toolbarSource).toContain(
      "bottomRow.append(openNote, layoutMenu, askBtn, menu, collapse)",
    );
    expect(toolbarSource).toMatch(
      /menuContent\.append\(\s*copyAll,\s*clear,\s*settings,/s,
    );
  });

  it("toggles immersive mode from its configured reader shortcut", () => {
    expect(sidebarSource).toContain("function handleImmersiveModeShortcut(");
    expect(sidebarSource).toContain("getImmersiveModeShortcut(zoteroPrefs())");
    expect(sidebarSource).toContain("void toggleAskMode(win)");
    expect(sidebarSource).toContain(
      "if (handleImmersiveModeShortcut(win, event)) return",
    );
    expect(sidebarSource).not.toContain("handleTranslateModeShortcut");
    expect(toolbarSource).toContain(
      "`沉浸式阅读（快捷键：${getImmersiveModeShortcut(zoteroPrefs())}）",
    );
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

  it("keeps the send mode at the far left of the composer footer", () => {
    expect(sidebarCSS).toMatch(
      /\.zai-compact-menu:not\(\[open\]\)[^{]*\{[^}]*display:\s*none;/s,
    );
    expect(sidebarCSS).toMatch(
      /\.composer-footer\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) minmax\(0, 120px\);/s,
    );
    expect(sidebarCSS).toMatch(
      /\.composer-footer\s*\{[^}]*width:\s*calc\(100% \+ 20px\);[^}]*margin-left:\s*-10px;/s,
    );
    expect(sidebarCSS).toMatch(
      /\.composer-footer-left:empty\s*\{[^}]*display:\s*none;/s,
    );
    expect(composerFooterSource).toContain(
      'footer.classList.toggle("composer-footer-status-empty", Boolean(left.hidden))',
    );
    expect(sidebarCSS).toMatch(
      /\.composer-footer\.composer-footer-status-empty\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\);/s,
    );
    expect(sidebarCSS).toMatch(
      /\.composer-status\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*white-space:\s*nowrap;/s,
    );
    expect(sidebarCSS).toMatch(
      /\.input-row > \.composer-attachment-menu\s*\{[^}]*left:\s*10px;/s,
    );
    expect(sidebarCSS).toMatch(
      /\.composer-attachment-menu > summary\s*\{[^}]*width:\s*24px;[^}]*min-width:\s*24px;/s,
    );
    expect(sidebarCSS).toMatch(
      /\.input-row > \.composer-switchers\s*\{[^}]*left:\s*34px;/s,
    );
    expect(sidebarCSS).toMatch(
      /\.input-row > \.composer-switchers\s*\{[^}]*gap:\s*2px;/s,
    );
    expect(sidebarSource).toContain('"＋\\u00a0联网"');
    expect(sidebarSource).toContain('"＋\\u00a0原文"');
    expect(sidebarSource).not.toContain('"web-search-trigger-icon"');
    expect(sidebarSource).not.toContain('"web-search-trigger-label"');
    expect(sidebarCSS).toMatch(
      /\.web-search-switcher \.web-search-trigger\s*\{[^}]*padding:\s*3px 4px;[^}]*white-space:\s*nowrap;/s,
    );
    expect(sidebarCSS).toMatch(
      /\.preset-switcher-bottom\s*\{[^}]*overflow:\s*visible;/s,
    );
  });

  it("keeps third-party Web configuration in the WEB footer only", () => {
    expect(composerFooterSource).not.toContain("renderCustomWebProviderButton");
    expect(sidebarSource).toContain("state.localUiSettings.customWebProviders");
    expect(sidebarSource).toContain("customWebProviderFor(state, provider)");
    expect(sidebarSource).toContain('option.value = "__manage_web_providers__"');
    expect(sidebarSource).toContain('option.textContent = "＋ 管理第三方网页…"');
    expect(sidebarSource).toMatch(
      /if \(select\.value === "__manage_web_providers__"\) \{\s*select\.value = previousProvider;\s*configureCustomWebProvider\(doc, mount, state\);\s*return;/s,
    );
    expect(sidebarSource).not.toContain("function renderCustomWebProviderButton(");
    expect(sidebarSource).not.toContain("function webSettingsIcon(");
    expect(sidebarCSS).not.toContain(".composer-web-provider-settings-button");
    expect(sidebarSource).toContain("ChatGPT 网页模式风险提示");
    expect(sidebarSource).toContain("账号风控");
  });

  it("keeps model and YOLO controls inline without a reasoning selector", () => {
    expect(composerFooterSource).not.toContain('"composer-model-menu"');
    expect(composerFooterSource).not.toContain('"模型设置"');
    expect(composerFooterSource).toMatch(
      /renderModelSwitcher\(doc, mount, state\),\s*renderYoloToggle\(doc, mount, state\)/s,
    );
    expect(composerFooterSource).not.toContain("renderReasoningSwitcher");
    expect(sidebarSource).not.toContain('className = "reasoning-switcher-trigger"');
    expect(composerFooterSource).toContain("renderSendTargetSwitcher");
    expect(composerFooterSource).toContain(
      'state.localUiSettings.chatSendMode === "api"',
    );
    expect(composerFooterSource).toContain("renderWebPromptProviderSwitcher");
    expect(composerFooterSource).toMatch(
      /renderWebPromptProviderSwitcher\(doc, mount, state\),\s*renderWebAccountButton\(doc, mount, state\)/s,
    );
    expect(composerFooterSource).toContain(
      "footer.append(sendMode, actions, left)",
    );
    expect(sidebarSource).not.toContain("Ln ${cursor.line}, Col ${cursor.column}");
    expect(sidebarSource).not.toContain("function cursorPosition(");
  });
});
