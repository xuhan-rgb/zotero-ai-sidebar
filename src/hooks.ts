import {
  isOfficialOpenAIEndpoint as isOfficialOpenAIEndpointForPreset,
  supportsExtendedPromptCache as supportsExtendedPromptCacheForPreset,
} from "./providers/openai-cache-policy";
import { initLocale } from "./utils/locale";
import {
  UI_LANGUAGE_PREF,
  localizeStaticUi,
  normalizeUiLanguage,
  uiText,
} from "./utils/ui-locale";
import { shutdownWebAgent } from "./modules/web-agent-client";
import {
  createReasoningControls,
  mergeReasoningEffortByModel,
} from "./modules/reasoning-controls";
import { checkWebAgentAfterXpiUpdate } from "./modules/web-agent-installer";
import { createZToolkit } from "./utils/ztoolkit";
import { zoteroContextSource } from "./context/zotero-source";
import {
  refreshSidebarPreferences,
  getActiveSidebarPresetId,
  tryFocusPendingPreference,
  registerSidebar,
  registerSidebarForWindow,
  unregisterSidebar,
  unregisterSidebarForWindow,
} from "./modules/sidebar";
import {
  DEFAULT_QUICK_ASK_SHORTCUT,
  getQuickAskShortcut,
  setQuickAskShortcut,
} from "./modules/quick-ask";
import {
  detectOpenAIModelTransports as detectOpenAIModelTransportsWithSignal,
  testPresetConnectivity as testPresetConnectivityWithSignal,
  testPresetPromptCache as runPresetPromptCacheTest,
} from "./modules/preset-utils";
import {
  dispatchPreferenceChange,
  formatPreferenceSaveSections,
  hasUnsavedPresetChanges,
  PREFERENCE_SAVE_SECTIONS,
  registerPreferences,
  resolveTestModel,
  setPreferenceSaveBarVisible,
  type PreferenceSaveSection,
  unregisterPreferences,
} from "./modules/preferences";
import {
  getImmersiveClickMode,
  setImmersiveClickMode,
  getImmersiveModeShortcut,
  setImmersiveModeShortcut,
  DEFAULT_IMMERSIVE_MODE_SHORTCUT,
  getImmersiveNextSentenceKey,
  setImmersiveNextSentenceKey,
  getImmersivePrevSentenceKey,
  setImmersivePrevSentenceKey,
  DEFAULT_IMMERSIVE_NEXT_KEY,
  DEFAULT_IMMERSIVE_PREV_KEY,
  getImmersiveNeighborContext,
  setImmersiveNeighborContext,
  getImmersiveTermPairs,
  setImmersiveTermPairs,
  getImmersiveKeywordCount,
  setImmersiveKeywordCount,
  DEFAULT_IMMERSIVE_KEYWORD_COUNT,
  getImmersiveQuickTranslateKey,
  setImmersiveQuickTranslateKey,
  DEFAULT_IMMERSIVE_QUICK_KEY,
  getImmersiveFocusAskKey,
  setImmersiveFocusAskKey,
  DEFAULT_IMMERSIVE_FOCUS_ASK_KEY,
  getImmersiveToggleControlsKey,
  setImmersiveToggleControlsKey,
  DEFAULT_IMMERSIVE_TOGGLE_KEY,
} from "./translate/ask-mode";
import {
  DEFAULT_QUICK_PROMPT_SETTINGS,
  flushQuickPromptSettings,
  hydrateQuickPromptSettings,
  loadQuickPromptSettings,
  normalizeQuickPromptSettings,
  saveQuickPromptSettings,
  type QuickPromptSettings,
} from "./settings/quick-prompts";
import {
  loadMineruSettings,
  normalizeMineruSettings,
  openMineruTokenApplyPage,
  saveMineruSettings,
  type MineruSettings,
} from "./settings/mineru";
import { probeMineruToken } from "./translate/mineru-client";
import {
  detectAnthropicVendor,
  loadPresets,
  normalizePresetList,
  savePresets,
  zoteroPrefs,
} from "./settings/storage";
import {
  DEFAULT_TOOL_SETTINGS,
  loadToolSettings,
  normalizeToolSettings,
  saveToolSettings,
  type McpApprovalMode,
  type McpServerSettings,
  type ToolSettings,
  type WebSearchMode,
} from "./settings/tool-settings";
import {
  DEFAULT_BASE_URLS,
  DEFAULT_MODELS,
  MODEL_SUGGESTIONS,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_REASONING_SUMMARY,
  REASONING_SUMMARY_OPTIONS,
  type AnthropicVendor,
  type ModelPreset,
  type ModelSuggestionGroup,
  type ModelSuggestionKey,
  type ProviderKind,
  type ReasoningEffort,
  type ReasoningSummary,
  type TranslateContextLevel,
  type TranslateOverlayPosition,
  type TranslateOverlaySize,
  type TranslateSettings,
  type TranslateThinking,
  type TranslateTriggerMode,
} from "./settings/types";
import {
  inferModelSuggestionGroupFromName,
  resolveModelSuggestionKey,
} from "./settings/model-catalog";
import {
  loadUiSettings,
  normalizeUiSettings,
  saveUiSettings,
  type UiSettings,
} from "./settings/ui-settings";
import {
  loadLocalUiSettings,
  normalizeLocalUiSettings,
  saveLocalUiSettings,
  type LocalUiSettings,
} from "./settings/local-ui-settings";
import { pullFromCloud, pushToCloud, testSyncConnection } from "./sync";
import {
  loadSyncAccount,
  saveSyncAccount,
  type SyncAccount,
} from "./sync/account";
import {
  loadTranslateSettings,
  normalizeTranslateSettings,
  saveTranslateSettings,
} from "./translate/settings";
import {
  registerWebPromptHub,
  unregisterWebPromptHub,
} from "./modules/web-prompt-hub";

const preferenceWatchWindows = new WeakSet<Window>();
const preferenceWatchTimers: Array<{ win: Window; timer: number }> = [];
const dirtyPreferenceSections = new WeakMap<
  Document,
  Set<PreferenceSaveSection>
>();

// Plugin lifecycle hooks invoked by `addon/bootstrap.js`.
//
// INVARIANT on startup ordering (each promise gates the next safely):
//   1. initializationPromise — Zotero core data layer is ready (DB, items).
//   2. unlockPromise        — user-facing UI/data is unlocked (no master pw).
//   3. uiReadyPromise       — main window XUL tree exists; safe to inject.
// Skipping any of these crashes the plugin on cold start with "Zotero is
// not ready yet" because we touch DOM and item APIs immediately.
//
// REF: Zotero source `chrome/content/zotero/xpcom/zotero.js` for promise
//      contract; zotero-plugin-template README for hook signatures.
async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();
  await hydrateQuickPromptSettings(zoteroPrefs()).catch((error) =>
    Zotero.debug(
      `[Zotero AI Sidebar] Quick prompt storage hydrate failed: ${String(error)}`,
    ),
  );
  await checkWebAgentAfterXpiUpdate().catch((error) =>
    Zotero.debug(
      `[Zotero AI Sidebar] Web Agent package check failed: ${String(error)}`,
    ),
  );
  registerWebPromptHub();

  // Per-window setup BEFORE the global `registerSidebar` so each window
  // has its FTL locale strings and ztoolkit ready by the time the column
  // renders. `registerSidebar` then iterates getMainWindows() again to
  // mount the column DOM in each — it's idempotent (see registerSidebarForWindow).
  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  registerSidebar();
  await registerPreferences();
  for (const win of Zotero.getMainWindows()) watchPreferencesPane(win);
  syncAutoSyncTimer();

  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-addon.ftl`,
  );
  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );
  registerSidebarForWindow(win);
  watchPreferencesPane(win);
}

async function onMainWindowUnload(win: Window): Promise<void> {
  unregisterSidebarForWindow(win);
  ztoolkit.unregisterAll();
}

async function onShutdown(isAppShutdown = false): Promise<void> {
  await flushQuickPromptSettings().catch((error) =>
    Zotero.debug(
      `[Zotero AI Sidebar] Quick prompt storage flush failed: ${String(error)}`,
    ),
  );
  await shutdownWebAgent();
  if (isAppShutdown) return;
  unregisterWebPromptHub();
  stopAutoSyncTimer();
  stopPreferenceWatchers();
  unregisterPreferences();
  ztoolkit.unregisterAll();
  unregisterSidebar();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

// Hooks below are kept for the bootstrap.js dispatch table. Preference-load
// events are handled here; other hook bodies stay as placeholders until needed.
async function onNotify(
  _event: string,
  _type: string,
  _ids: Array<string | number>,
  _extraData: { [key: string]: unknown },
) {}

async function onPrefsEvent(type: string, data: { [key: string]: unknown }) {
  if (type !== "load") return;
  const win = data.window as Window | undefined;
  if (!win?.document) return;
  setupPreferencesPane(win, true);
}

function watchPreferencesPane(win: Window): void {
  if (preferenceWatchWindows.has(win)) return;
  preferenceWatchWindows.add(win);
  const tick = () => {
    const root = byID<HTMLElement>(
      win.document,
      "zotero-ai-sidebar-tool-settings",
    );
    if (root && root.dataset.bound !== "true") setupPreferencesPane(win);
    else if (root) tryFocusPendingPreference(win.document);
  };
  tick();
  preferenceWatchTimers.push({ win, timer: win.setInterval(tick, 500) });
}

function stopPreferenceWatchers(): void {
  while (preferenceWatchTimers.length) {
    const entry = preferenceWatchTimers.pop();
    if (entry) entry.win.clearInterval(entry.timer);
  }
}

function setupPreferencesPane(win: Window, forceRender = false): void {
  const doc = win.document;
  const root = byID<HTMLElement>(doc, "zotero-ai-sidebar-tool-settings");
  if (!root) return;

  if (forceRender || root.dataset.rendered !== "true") {
    localizeStaticUi(doc);
    renderPresetSettings(doc, getActiveSidebarPresetId());
    renderTranslateSettings(doc);
    renderUiSettings(doc);
    renderPromptSettings(doc);
    renderToolSettings(doc);
    renderSyncSettings(doc);
    dirtyPreferenceSections.set(doc, new Set());
    renderPreferenceSaveBar(doc);
    root.dataset.rendered = "true";
  }
  tryFocusPendingPreference(doc);

  if (root.dataset.bound === "true") return;
  root.dataset.bound = "true";

  const uiLanguage = byID<HTMLSelectElement>(doc, "zai-ui-language");
  uiLanguage?.addEventListener("change", () => {
    const language = normalizeUiLanguage(uiLanguage.value);
    zoteroPrefs().set(UI_LANGUAGE_PREF, language);
    localizeStaticUi(doc);
    refreshSidebarPreferences();
    setStatus(
      doc,
      "zai-ui-status",
      uiText("界面语言已保存。重新打开设置页后将刷新所有设置文字。", "Interface language saved. Reopen Preferences to refresh all settings text."),
    );
  });

  const immersiveCard = byID<HTMLInputElement>(doc, "zai-immersive-card-mode");
  if (immersiveCard) {
    immersiveCard.checked = getImmersiveClickMode(zoteroPrefs()) === "card";
    immersiveCard.addEventListener("change", () => {
      setImmersiveClickMode(
        zoteroPrefs(),
        immersiveCard.checked ? "card" : "chooser",
      );
    });
  }

  const immersiveNeighbor = byID<HTMLInputElement>(
    doc,
    "zai-immersive-neighbor-context",
  );
  if (immersiveNeighbor) {
    immersiveNeighbor.checked = getImmersiveNeighborContext(zoteroPrefs());
    immersiveNeighbor.addEventListener("change", () => {
      setImmersiveNeighborContext(zoteroPrefs(), immersiveNeighbor.checked);
    });
  }

  const immersiveTerms = byID<HTMLInputElement>(
    doc,
    "zai-immersive-term-pairs",
  );
  if (immersiveTerms) {
    immersiveTerms.checked = getImmersiveTermPairs(zoteroPrefs());
    immersiveTerms.addEventListener("change", () => {
      setImmersiveTermPairs(zoteroPrefs(), immersiveTerms.checked);
    });
  }

  const immersiveKeywordCount = byID<HTMLInputElement>(
    doc,
    "zai-immersive-keyword-count",
  );
  if (immersiveKeywordCount) {
    immersiveKeywordCount.value = String(
      getImmersiveKeywordCount(zoteroPrefs()),
    );
    immersiveKeywordCount.addEventListener("change", () => {
      const n = Number(immersiveKeywordCount.value);
      setImmersiveKeywordCount(
        zoteroPrefs(),
        Number.isFinite(n) ? n : DEFAULT_IMMERSIVE_KEYWORD_COUNT,
      );
      immersiveKeywordCount.value = String(
        getImmersiveKeywordCount(zoteroPrefs()),
      );
    });
  }

  const immersiveNextKey = byID<HTMLInputElement>(
    doc,
    "zai-immersive-next-key",
  );
  const immersiveModeKey = byID<HTMLInputElement>(
    doc,
    "zai-immersive-mode-key",
  );
  if (immersiveModeKey) {
    immersiveModeKey.value = getImmersiveModeShortcut(zoteroPrefs());
    immersiveModeKey.addEventListener("change", () => {
      setImmersiveModeShortcut(
        zoteroPrefs(),
        immersiveModeKey.value.trim() || DEFAULT_IMMERSIVE_MODE_SHORTCUT,
      );
      immersiveModeKey.value = getImmersiveModeShortcut(zoteroPrefs());
    });
  }
  const quickAskKey = byID<HTMLInputElement>(doc, "zai-quick-ask-key");
  if (quickAskKey) {
    quickAskKey.value = getQuickAskShortcut(zoteroPrefs());
    quickAskKey.addEventListener("change", () => {
      setQuickAskShortcut(
        zoteroPrefs(),
        quickAskKey.value.trim() || DEFAULT_QUICK_ASK_SHORTCUT,
      );
      quickAskKey.value = getQuickAskShortcut(zoteroPrefs());
    });
  }
  if (immersiveNextKey) {
    immersiveNextKey.value = getImmersiveNextSentenceKey(zoteroPrefs());
    immersiveNextKey.addEventListener("change", () => {
      setImmersiveNextSentenceKey(
        zoteroPrefs(),
        immersiveNextKey.value.trim() || DEFAULT_IMMERSIVE_NEXT_KEY,
      );
      immersiveNextKey.value = getImmersiveNextSentenceKey(zoteroPrefs());
    });
  }

  const immersivePrevKey = byID<HTMLInputElement>(
    doc,
    "zai-immersive-prev-key",
  );
  if (immersivePrevKey) {
    immersivePrevKey.value = getImmersivePrevSentenceKey(zoteroPrefs());
    immersivePrevKey.addEventListener("change", () => {
      setImmersivePrevSentenceKey(
        zoteroPrefs(),
        immersivePrevKey.value.trim() || DEFAULT_IMMERSIVE_PREV_KEY,
      );
      immersivePrevKey.value = getImmersivePrevSentenceKey(zoteroPrefs());
    });
  }

  const immersiveQuickKey = byID<HTMLInputElement>(
    doc,
    "zai-immersive-quick-key",
  );
  if (immersiveQuickKey) {
    immersiveQuickKey.value = getImmersiveQuickTranslateKey(zoteroPrefs());
    immersiveQuickKey.addEventListener("change", () => {
      setImmersiveQuickTranslateKey(
        zoteroPrefs(),
        immersiveQuickKey.value.trim() || DEFAULT_IMMERSIVE_QUICK_KEY,
      );
      immersiveQuickKey.value = getImmersiveQuickTranslateKey(zoteroPrefs());
    });
  }

  const immersiveFocusAskKey = byID<HTMLInputElement>(
    doc,
    "zai-immersive-focus-ask-key",
  );
  if (immersiveFocusAskKey) {
    immersiveFocusAskKey.value = getImmersiveFocusAskKey(zoteroPrefs());
    immersiveFocusAskKey.addEventListener("change", () => {
      setImmersiveFocusAskKey(
        zoteroPrefs(),
        immersiveFocusAskKey.value.trim() || DEFAULT_IMMERSIVE_FOCUS_ASK_KEY,
      );
      immersiveFocusAskKey.value = getImmersiveFocusAskKey(zoteroPrefs());
    });
  }

  const immersiveToggleKey = byID<HTMLInputElement>(
    doc,
    "zai-immersive-toggle-key",
  );
  if (immersiveToggleKey) {
    immersiveToggleKey.value = getImmersiveToggleControlsKey(zoteroPrefs());
    immersiveToggleKey.addEventListener("change", () => {
      setImmersiveToggleControlsKey(
        zoteroPrefs(),
        immersiveToggleKey.value.trim() || DEFAULT_IMMERSIVE_TOGGLE_KEY,
      );
      immersiveToggleKey.value = getImmersiveToggleControlsKey(zoteroPrefs());
    });
  }

  byID<HTMLButtonElement>(doc, "zai-preset-add-openai")?.addEventListener(
    "click",
    () => {
      const preset = makePreset("openai");
      const presets = [...readPresetControls(doc), preset];
      renderPresetRows(doc, presets);
      openPresetRow(doc, preset.id);
      updatePresetDirtyState(doc);
      setStatus(
        doc,
        "zai-preset-status",
        uiText("已新增 OpenAI 配置，请点击顶部“保存更改”。", "OpenAI account added. Click Save changes above."),
      );
    },
  );
  byID<HTMLButtonElement>(doc, "zai-preset-add-anthropic")?.addEventListener(
    "click",
    () => {
      const preset = makePreset("anthropic");
      const presets = [...readPresetControls(doc), preset];
      renderPresetRows(doc, presets);
      openPresetRow(doc, preset.id);
      updatePresetDirtyState(doc);
      setStatus(
        doc,
        "zai-preset-status",
        uiText("已新增 Anthropic 配置，请点击顶部“保存更改”。", "Anthropic account added. Click Save changes above."),
      );
    },
  );
  byID<HTMLSelectElement>(doc, "zai-cache-test-preset")?.addEventListener(
    "change",
    () => refreshCacheTestTarget(doc),
  );
  byID<HTMLButtonElement>(doc, "zai-cache-test-run")?.addEventListener(
    "click",
    () => void runSelectedPromptCacheTest(doc),
  );
  byID<HTMLSelectElement>(doc, "zai-translate-preset")?.addEventListener(
    "change",
    () => {
      refreshTranslateModelSelect(doc, "");
      // Vendor switch also changes the available thinking levels (DeepSeek
      // exposes only High/Max effectively); keep the dropdown honest.
      refreshTranslateThinkingSelect(doc);
    },
  );
  byID<HTMLButtonElement>(doc, "zai-custom-prompt-add")?.addEventListener(
    "click",
    () => {
      addCustomPromptRow(doc, { id: makeId("prompt"), label: "", prompt: "" });
      setPreferenceSectionDirty(doc, "prompts", true);
    },
  );
  byID<HTMLButtonElement>(doc, "zai-ui-signature-add")?.addEventListener(
    "click",
    () => {
      const list = byID<HTMLElement>(doc, "zai-ui-signature-list");
      if (!list) return;
      const row = uiSignatureRow(doc, "");
      list.append(row);
      refreshUiSignatureRows(doc);
      row.querySelector<HTMLInputElement>("input")?.focus();
    },
  );
  byID<HTMLButtonElement>(doc, "zai-prompt-reset")?.addEventListener(
    "click",
    () => {
      populateBuiltInPromptControls(doc, DEFAULT_QUICK_PROMPT_SETTINGS);
      refreshPreferenceDirtySection(doc, "prompts");
      setStatus(
        doc,
        "zai-prompt-status",
        uiText("已填入全部内置默认提示词，保存更改后生效。", "Built-in prompts restored. Save changes to apply them."),
      );
    },
  );

  byID<HTMLButtonElement>(doc, "zai-mcp-add")?.addEventListener("click", () => {
    addMcpRow(doc, {
      id: makeId("mcp"),
      enabled: true,
      serverLabel: "mcp",
      serverUrl: "",
      allowedTools: [],
      requireApproval: "never",
    });
    refreshPreferenceDirtySection(doc, "mcp");
  });
  byID<HTMLButtonElement>(doc, "zai-tool-reset-color-guide")?.addEventListener(
    "click",
    () => {
      const colorGuide = byID<HTMLTextAreaElement>(
        doc,
        "zai-tool-annotation-color-guide",
      );
      if (colorGuide) {
        colorGuide.value = DEFAULT_TOOL_SETTINGS.annotationColorGuide;
        colorGuide.scrollTop = 0;
      }
      saveAnnotationColorGuideControl(
        doc,
        uiText("PDF 注释颜色预设已恢复默认并自动保存。", "PDF annotation color presets restored and saved."),
      );
      flashButton(
        byID<HTMLButtonElement>(doc, "zai-tool-reset-color-guide"),
        uiText("已重置", "Reset"),
      );
    },
  );
  byID<HTMLButtonElement>(doc, "zai-config-export-file")?.addEventListener(
    "click",
    () => {
      void exportConfigBackupFile(doc);
    },
  );
  byID<HTMLButtonElement>(doc, "zai-config-import-file")?.addEventListener(
    "click",
    () => {
      void importConfigBackupFile(doc);
    },
  );
  byID<HTMLButtonElement>(doc, "zai-config-generate")?.addEventListener(
    "click",
    () => {
      generateConfigBackupJson(doc);
    },
  );
  byID<HTMLButtonElement>(doc, "zai-config-copy")?.addEventListener(
    "click",
    () => {
      void copyConfigBackupJson(doc);
    },
  );
  byID<HTMLButtonElement>(doc, "zai-config-import-text")?.addEventListener(
    "click",
    () => {
      importConfigBackupFromText(doc);
    },
  );
  byID<HTMLButtonElement>(doc, "zai-config-clear")?.addEventListener(
    "click",
    () => {
      const area = byID<HTMLTextAreaElement>(doc, "zai-config-json");
      if (area) area.value = "";
      setStatus(doc, "zai-config-status", uiText("手动备份文本已清空。", "Manual backup text cleared."));
    },
  );
  byID<HTMLButtonElement>(doc, "zai-sync-test")?.addEventListener(
    "click",
    () => {
      void runSyncTest(doc);
    },
  );
  byID<HTMLButtonElement>(doc, "zai-mineru-apply")?.addEventListener(
    "click",
    () => {
      openMineruTokenApplyPage();
    },
  );
  byID<HTMLButtonElement>(doc, "zai-mineru-test")?.addEventListener(
    "click",
    () => {
      void runMineruTest(doc);
    },
  );
  byID<HTMLButtonElement>(doc, "zai-sync-push")?.addEventListener(
    "click",
    () => {
      void runSyncPush(doc);
    },
  );
  byID<HTMLButtonElement>(doc, "zai-sync-pull")?.addEventListener(
    "click",
    () => {
      void runSyncPull(doc);
    },
  );
  byID<HTMLButtonElement>(doc, "zai-sync-auto")?.addEventListener(
    "click",
    () => {
      void toggleAutoSync(doc);
    },
  );
  bindAutoSaveControls(
    doc,
    "#zai-translate-preset, #zai-translate-model, #zai-translate-thinking, #zai-translate-context, #zai-translate-position, #zai-translate-size, #zai-translate-trigger, #zai-translate-next-key, #zai-translate-prev-key",
    () => saveTranslateSettingsControls(doc),
  );
  bindAutoSaveControls(doc, "#zai-mineru-token", () =>
    saveMineruSettingsControls(doc),
  );
  bindAutoSaveControls(
    doc,
    "#zai-ui-user-label, #zai-ui-user-avatar, #zai-ui-assistant-label, #zai-ui-assistant-avatar, #zai-ui-signature-enabled, #zai-ui-chat-font, #zai-ui-actions-position, #zai-ui-actions-layout, #zai-ui-preference-border-style, #zai-ui-composer-queue, #zai-ui-max-parallel-conversations, #zai-ui-confirm-conversation-deletion",
    () => saveUiSettingsControls(doc),
  );
  bindAutoSaveControls(
    doc,
    "#zai-ui-chat-layout, #zai-ui-sidebar-display",
    () => saveLocalUiSettingsControls(doc),
  );
  bindAutoSaveControls(doc, "#zai-tool-web-search", () =>
    saveWebSearchControl(doc),
  );
  bindAutoSaveControls(doc, "#zai-tool-annotation-color-guide", () =>
    saveAnnotationColorGuideControl(doc),
  );
  bindAutoSaveControls(doc, "#zai-tool-text-annotation-font-size", () =>
    saveTextAnnotationFontSizeControl(doc),
  );
  bindCompoundDirtyTracking(doc, root);
  byID<HTMLButtonElement>(doc, "zai-save-commit")?.addEventListener(
    "click",
    () => void savePreferenceChanges(doc),
  );
  byID<HTMLButtonElement>(doc, "zai-save-discard")?.addEventListener(
    "click",
    () => discardPreferenceChanges(doc),
  );
}

function bindAutoSaveControls(
  doc: Document,
  selector: string,
  save: () => void,
): void {
  const controls = Array.from(doc.querySelectorAll(selector)) as HTMLElement[];
  for (const control of controls) {
    control.addEventListener("change", save);
  }
}

function bindCompoundDirtyTracking(doc: Document, root: HTMLElement): void {
  const refresh = (event: Event) => {
    const target = event.target as Element | null;
    const container = target?.closest(
      "[data-save-section]",
    ) as HTMLElement | null;
    const section = container?.dataset.saveSection;
    if (!isPreferenceSaveSection(section)) return;
    refreshPreferenceDirtySection(doc, section);
  };
  root.addEventListener("input", refresh);
  root.addEventListener("change", refresh);
}

function isPreferenceSaveSection(
  value: string | undefined,
): value is PreferenceSaveSection {
  return PREFERENCE_SAVE_SECTIONS.includes(value as PreferenceSaveSection);
}

function preferenceDirtySections(doc: Document): Set<PreferenceSaveSection> {
  let sections = dirtyPreferenceSections.get(doc);
  if (!sections) {
    sections = new Set();
    dirtyPreferenceSections.set(doc, sections);
  }
  return sections;
}

function setPreferenceSectionDirty(
  doc: Document,
  section: PreferenceSaveSection,
  dirty: boolean,
): void {
  const sections = preferenceDirtySections(doc);
  if (dirty) sections.add(section);
  else sections.delete(section);
  renderPreferenceSaveBar(doc);
}

function renderPreferenceSaveBar(doc: Document): void {
  const bar = byID<HTMLElement>(doc, "zai-save-bar");
  const label = byID<HTMLElement>(doc, "zai-save-sections");
  if (!bar || !label) return;
  const sections = preferenceDirtySections(doc);
  setPreferenceSaveBarVisible(bar, sections.size > 0);
  label.textContent = formatPreferenceSaveSections(sections);
}

function refreshPreferenceDirtySection(
  doc: Document,
  section: PreferenceSaveSection,
): void {
  let changed = false;
  if (section === "presets") {
    changed = hasUnsavedPresetChanges(
      readPresetControls(doc),
      loadPresets(zoteroPrefs()),
    );
  } else if (section === "prompts") {
    const current = readPromptControls(doc);
    changed =
      typeof current === "string" ||
      JSON.stringify(normalizeQuickPromptSettings(current)) !==
        JSON.stringify(loadQuickPromptSettings(zoteroPrefs()));
  } else if (section === "mcp") {
    const saved = loadToolSettings(zoteroPrefs());
    const current = normalizeToolSettings({
      ...saved,
      mcpServers: readToolSettingsControls(doc).mcpServers,
    });
    changed =
      JSON.stringify(current.mcpServers) !== JSON.stringify(saved.mcpServers);
  } else {
    changed =
      syncAccountControlsSignature(readSyncAccountControls(doc)) !==
      syncAccountControlsSignature(loadSyncAccount(zoteroPrefs()));
  }
  setPreferenceSectionDirty(doc, section, changed);
}

function refreshAllPreferenceDirtySections(doc: Document): void {
  for (const section of PREFERENCE_SAVE_SECTIONS) {
    refreshPreferenceDirtySection(doc, section);
  }
}

async function savePreferenceChanges(doc: Document): Promise<void> {
  const commit = byID<HTMLButtonElement>(doc, "zai-save-commit");
  const discard = byID<HTMLButtonElement>(doc, "zai-save-discard");
  const sections = new Set(preferenceDirtySections(doc));
  commit?.setAttribute("disabled", "true");
  discard?.setAttribute("disabled", "true");
  if (commit) commit.textContent = uiText("保存中...", "Saving...");
  try {
    for (const section of PREFERENCE_SAVE_SECTIONS) {
      if (!sections.has(section)) continue;
      if (section === "presets") {
        await savePresetControlsWithConnectivity(doc);
      } else if (section === "prompts") {
        savePromptControls(doc);
      } else if (section === "mcp") {
        saveMcpControls(doc);
      } else {
        saveSyncAccountControls(doc);
      }
    }
    refreshAllPreferenceDirtySections(doc);
  } finally {
    commit?.removeAttribute("disabled");
    discard?.removeAttribute("disabled");
    if (commit) commit.textContent = uiText("保存更改", "Save changes");
  }
}

function discardPreferenceChanges(doc: Document): void {
  const sections = new Set(preferenceDirtySections(doc));
  if (sections.has("presets")) {
    renderPresetSettings(doc);
    renderTranslateSettings(doc);
    setStatus(doc, "zai-preset-status", uiText("已撤销账号与模型的未保存更改。", "Unsaved account and model changes discarded."));
  }
  if (sections.has("prompts")) {
    renderPromptSettings(doc);
    setStatus(doc, "zai-prompt-status", uiText("已撤销提示词的未保存更改。", "Unsaved prompt changes discarded."));
  }
  if (sections.has("mcp")) {
    renderToolSettings(doc);
    setStatus(doc, "zai-tool-status", uiText("已撤销 MCP Server 的未保存更改。", "Unsaved MCP server changes discarded."));
  }
  if (sections.has("sync")) {
    renderSyncSettings(doc);
    setStatus(doc, "zai-sync-status", uiText("已撤销 WebDAV 账号的未保存更改。", "Unsaved WebDAV account changes discarded."));
  }
  dirtyPreferenceSections.set(doc, new Set());
  renderPreferenceSaveBar(doc);
}

function syncAccountControlsSignature(account: SyncAccount): string {
  return JSON.stringify({
    webdavUrl: account.webdavUrl.trim(),
    username: account.username.trim(),
    password: account.password.trim(),
    remoteFolder: account.remoteFolder.trim().replace(/^\/+|\/+$/g, ""),
  });
}

function saveSyncAccountControls(doc: Document): void {
  saveSyncAccount(zoteroPrefs(), readSyncAccountControls(doc));
  renderSyncSettings(doc);
  setStatus(doc, "zai-sync-status", uiText("WebDAV 账号已保存。", "WebDAV account saved."));
}

async function runSyncTest(doc: Document): Promise<void> {
  // Test the staged credentials directly; a successful connection also
  // commits them so a second explicit save is unnecessary.
  const account = readSyncAccountControls(doc);
  setStatus(doc, "zai-sync-status", uiText("正在测试 WebDAV 连接…", "Testing WebDAV connection…"));
  const result = await testSyncConnection(account);
  setStatus(doc, "zai-sync-status", result.message, !result.ok);
  if (result.ok) {
    saveSyncAccount(zoteroPrefs(), account);
    renderSyncSettings(doc);
    refreshPreferenceDirtySection(doc, "sync");
    flashButton(byID<HTMLButtonElement>(doc, "zai-sync-test"), uiText("已连接", "Connected"));
  }
}

async function runSyncPush(doc: Document): Promise<void> {
  const account = readSyncAccountControls(doc);
  saveSyncAccount(zoteroPrefs(), account);
  refreshPreferenceDirtySection(doc, "sync");
  setStatus(doc, "zai-sync-status", uiText("正在打包并上传到云端…", "Packing and uploading to cloud…"));
  const result = await pushToCloud(zoteroPrefs(), account);
  setStatus(doc, "zai-sync-status", result.message, !result.ok);
  if (result.ok) {
    renderSyncSettings(doc);
    flashButton(byID<HTMLButtonElement>(doc, "zai-sync-push"), uiText("已上传", "Uploaded"));
  }
}

async function runSyncPull(doc: Document): Promise<void> {
  const account = readSyncAccountControls(doc);
  const ok =
    doc.defaultView?.confirm(
      uiText(
        "从云端下载会应用账号、显示、提示词、联网/MCP、翻译配置、AI 对话和翻译缓存。继续？",
        "Downloading will apply account, display, prompt, web/MCP, translation, AI chat, and translation cache settings. Continue?",
      ),
    ) ?? true;
  if (!ok) {
    setStatus(doc, "zai-sync-status", uiText("已取消下载。", "Download cancelled."));
    return;
  }
  saveSyncAccount(zoteroPrefs(), account);
  refreshPreferenceDirtySection(doc, "sync");
  setStatus(doc, "zai-sync-status", uiText("正在从云端下载并应用配置…", "Downloading and applying configuration…"));
  const result = await pullFromCloud(zoteroPrefs(), account);
  setStatus(doc, "zai-sync-status", result.message, !result.ok);
  if (result.ok) {
    renderPresetSettings(doc);
    renderTranslateSettings(doc);
    renderUiSettings(doc);
    renderPromptSettings(doc);
    renderToolSettings(doc);
    renderSyncSettings(doc);
    refreshAllPreferenceDirtySections(doc);
    refreshSidebarPreferences();
    flashButton(byID<HTMLButtonElement>(doc, "zai-sync-pull"), uiText("已下载", "Downloaded"));
  }
}

const AUTO_SYNC_INTERVAL_MS = 10 * 60 * 1000;
let autoSyncTimer: ReturnType<typeof setInterval> | null = null;
let autoSyncInFlight = false;

async function toggleAutoSync(doc: Document): Promise<void> {
  const current = loadSyncAccount(zoteroPrefs());
  const next = {
    ...current,
    autoSyncEnabled: !current.autoSyncEnabled,
  };
  saveSyncAccount(zoteroPrefs(), next);
  renderSyncAccountState(doc, next);
  syncAutoSyncTimer(false);
  if (!next.autoSyncEnabled) {
    setStatus(doc, "zai-sync-status", uiText("自动同步已关闭。", "Auto-sync is off."));
    flashButton(byID<HTMLButtonElement>(doc, "zai-sync-auto"), uiText("已关闭", "Off"));
    return;
  }
  setStatus(doc, "zai-sync-status", uiText("自动同步已开启，将先下载合并再上传。", "Auto-sync is on. It will download and merge before uploading."));
  flashButton(byID<HTMLButtonElement>(doc, "zai-sync-auto"), uiText("已开启", "On"));
  await runAutoSync(doc);
}

function syncAutoSyncTimer(startNow = true): void {
  stopAutoSyncTimer();
  const account = loadSyncAccount(zoteroPrefs());
  if (!account.autoSyncEnabled) return;
  autoSyncTimer = setInterval(() => {
    void runAutoSync();
  }, AUTO_SYNC_INTERVAL_MS);
  if (startNow) void runAutoSync();
}

function stopAutoSyncTimer(): void {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
}

async function runAutoSync(doc?: Document): Promise<void> {
  if (autoSyncInFlight) return;
  let account = loadSyncAccount(zoteroPrefs());
  if (!account.autoSyncEnabled) return;
  if (!account.webdavUrl || !account.username || !account.password) return;

  autoSyncInFlight = true;
  try {
    if (doc)
      setStatus(
        doc,
        "zai-sync-status",
        uiText("正在自动同步：从云端下载合并…", "Auto-sync: downloading and merging from cloud…"),
      );
    const pull = await pullFromCloud(zoteroPrefs(), account);
    if (!pull.ok && !pull.message.includes("云端尚未找到")) {
      if (doc)
        setStatus(
          doc,
          "zai-sync-status",
          `${uiText("自动同步失败", "Auto-sync failed")}: ${pull.message}`,
          true,
        );
      return;
    }

    account = loadSyncAccount(zoteroPrefs());
    if (!account.autoSyncEnabled) return;
    if (doc)
      setStatus(
        doc,
        "zai-sync-status",
        uiText("正在自动同步：上传合并后的状态…", "Auto-sync: uploading merged settings…"),
      );
    const push = await pushToCloud(zoteroPrefs(), account);
    if (!push.ok) {
      if (doc)
        setStatus(
          doc,
          "zai-sync-status",
          `${uiText("自动同步失败", "Auto-sync failed")}: ${push.message}`,
          true,
        );
      return;
    }

    saveSyncAccount(zoteroPrefs(), {
      ...loadSyncAccount(zoteroPrefs()),
      lastAutoSyncAt: new Date().toISOString(),
    });
    refreshSidebarPreferences();
    if (doc) {
      const dirty = preferenceDirtySections(doc);
      if (!dirty.has("presets")) renderPresetSettings(doc);
      renderTranslateSettings(doc);
      renderUiSettings(doc);
      if (!dirty.has("prompts")) renderPromptSettings(doc);
      if (!dirty.has("mcp")) renderToolSettings(doc);
      if (!dirty.has("sync")) renderSyncSettings(doc);
      refreshAllPreferenceDirtySections(doc);
      setStatus(
        doc,
        "zai-sync-status",
        `${uiText("自动同步完成。", "Auto-sync complete. ")}${push.message}`,
      );
    }
  } finally {
    autoSyncInFlight = false;
  }
}

const CONFIG_BACKUP_SCHEMA = "zotero-ai-sidebar.config.v1";

interface ConfigBackup {
  schema: typeof CONFIG_BACKUP_SCHEMA;
  exportedAt: string;
  presets: ModelPreset[];
  uiSettings: UiSettings;
  quickPrompts: QuickPromptSettings;
  toolSettings: ToolSettings;
  translateSettings: TranslateSettings;
  mineruSettings: MineruSettings;
}

interface ParsedConfigBackup {
  presets?: ModelPreset[];
  uiSettings?: UiSettings;
  quickPrompts?: QuickPromptSettings;
  toolSettings?: ToolSettings;
  translateSettings?: TranslateSettings;
  mineruSettings?: MineruSettings;
  sections: string[];
}

function buildConfigBackup(): ConfigBackup {
  return {
    schema: CONFIG_BACKUP_SCHEMA,
    exportedAt: new Date().toISOString(),
    presets: loadPresets(zoteroPrefs()),
    uiSettings: loadUiSettings(zoteroPrefs()),
    quickPrompts: loadQuickPromptSettings(zoteroPrefs()),
    toolSettings: loadToolSettings(zoteroPrefs()),
    translateSettings: loadTranslateSettings(zoteroPrefs()),
    mineruSettings: loadMineruSettings(zoteroPrefs()),
  };
}

function configBackupJson(): string {
  return JSON.stringify(buildConfigBackup(), null, 2);
}

function configBackupFileName(): string {
  return `zotero-ai-sidebar-config-${new Date().toISOString().slice(0, 10)}.json`;
}

async function exportConfigBackupFile(doc: Document): Promise<void> {
  try {
    const path = await pickConfigBackupFile(doc, "save");
    if (!path) {
      setStatus(doc, "zai-config-status", uiText("已取消导出。", "Export cancelled."));
      return;
    }
    await Zotero.File.putContentsAsync(path, configBackupJson());
    setStatus(
      doc,
      "zai-config-status",
      `${uiText("配置备份已保存", "Configuration backup saved")}: ${path}`,
    );
    flashButton(
      byID<HTMLButtonElement>(doc, "zai-config-export-file"),
      uiText("已导出", "Exported"),
    );
  } catch (err) {
    setStatus(
      doc,
      "zai-config-status",
      fileErrorMessage(uiText("导出失败", "Export failed"), err),
      true,
    );
  }
}

async function importConfigBackupFile(doc: Document): Promise<void> {
  try {
    const path = await pickConfigBackupFile(doc, "open");
    if (!path) {
      setStatus(doc, "zai-config-status", uiText("已取消导入。", "Import cancelled."));
      return;
    }
    const contents = await Zotero.File.getContentsAsync(path, "utf-8");
    if (typeof contents !== "string") throw new Error(uiText("配置文件不是文本内容", "The configuration file is not text."));
    const raw = contents;
    importConfigBackupRaw(doc, raw, uiText("配置文件", "configuration file"), "zai-config-import-file");
  } catch (err) {
    setStatus(
      doc,
      "zai-config-status",
      fileErrorMessage(uiText("导入失败", "Import failed"), err),
      true,
    );
  }
}

function generateConfigBackupJson(doc: Document): void {
  const area = byID<HTMLTextAreaElement>(doc, "zai-config-json");
  if (!area) return;
  const backup = buildConfigBackup();
  area.value = JSON.stringify(backup, null, 2);
  area.focus();
  area.select();
  setStatus(
    doc,
    "zai-config-status",
    uiText(
      `已生成配置 JSON：账号 ${backup.presets.length} 个，自定义按钮 ${backup.quickPrompts.customButtons.length} 个，含翻译设置。内容可能包含 API Key。`,
      `Configuration JSON generated: ${backup.presets.length} accounts, ${backup.quickPrompts.customButtons.length} custom buttons, and translation settings. It may contain API keys.`,
    ),
  );
  flashButton(byID<HTMLButtonElement>(doc, "zai-config-generate"), uiText("已生成", "Generated"));
}

async function copyConfigBackupJson(doc: Document): Promise<void> {
  const area = byID<HTMLTextAreaElement>(doc, "zai-config-json");
  if (!area) return;
  if (!area.value.trim()) generateConfigBackupJson(doc);
  await writeTextToClipboard(doc, area.value);
  setStatus(
    doc,
    "zai-config-status",
    uiText("配置 JSON 已复制。内容可能包含 API Key。", "Configuration JSON copied. It may contain API keys."),
  );
  flashButton(byID<HTMLButtonElement>(doc, "zai-config-copy"), uiText("已复制", "Copied"));
}

function importConfigBackupFromText(doc: Document): void {
  const area = byID<HTMLTextAreaElement>(doc, "zai-config-json");
  const raw = area?.value.trim() ?? "";
  if (!raw) {
    setStatus(doc, "zai-config-status", uiText("请先粘贴配置 JSON。", "Paste configuration JSON first."), true);
    return;
  }
  importConfigBackupRaw(doc, raw, uiText("文本", "text"), "zai-config-import-text");
}

function importConfigBackupRaw(
  doc: Document,
  raw: string,
  source: string,
  buttonID?: string,
): void {
  const parsed = parseConfigBackup(raw);
  if (typeof parsed === "string") {
    setStatus(doc, "zai-config-status", parsed, true);
    return;
  }
  const sectionSeparator = uiText("、", ", ");
  const ok =
    doc.defaultView?.confirm(
      uiText(
        `导入会覆盖当前已保存的 ${parsed.sections.join("、")} 配置，确定继续？`,
        `Importing will overwrite the saved ${parsed.sections.join(sectionSeparator)} settings. Continue?`,
      ),
    ) ?? true;
  if (!ok) return;

  if (parsed.presets) savePresets(zoteroPrefs(), parsed.presets);
  if (parsed.uiSettings) saveUiSettings(zoteroPrefs(), parsed.uiSettings);
  if (parsed.quickPrompts) {
    saveQuickPromptSettings(zoteroPrefs(), parsed.quickPrompts);
  }
  if (parsed.toolSettings) saveToolSettings(zoteroPrefs(), parsed.toolSettings);
  if (parsed.translateSettings) {
    saveTranslateSettings(zoteroPrefs(), parsed.translateSettings);
  }
  if (parsed.mineruSettings) {
    saveMineruSettings(zoteroPrefs(), parsed.mineruSettings);
  }

  if (parsed.presets) renderPresetSettings(doc);
  if (parsed.presets || parsed.translateSettings || parsed.mineruSettings)
    renderTranslateSettings(doc);
  if (parsed.uiSettings) renderUiSettings(doc);
  if (parsed.quickPrompts) renderPromptSettings(doc);
  if (parsed.toolSettings) renderToolSettings(doc);
  refreshAllPreferenceDirtySections(doc);
  refreshSidebarPreferences();
  setStatus(
    doc,
    "zai-config-status",
    uiText(
      `已从${source}导入：${parsed.sections.join("、")}。侧边栏已刷新。`,
      `Imported ${parsed.sections.join(sectionSeparator)} from ${source}. Sidebar refreshed.`,
    ),
  );
  if (buttonID) flashButton(byID<HTMLButtonElement>(doc, buttonID), uiText("已导入", "Imported"));
}

async function pickConfigBackupFile(
  doc: Document,
  mode: "open" | "save",
): Promise<string | null> {
  const win = doc.defaultView;
  if (!win?.browsingContext) {
    throw new Error(uiText("当前窗口不支持文件选择器", "File selection is unavailable in this window."));
  }
  const nsFilePicker = Components.interfaces.nsIFilePicker;
  const filePickerClass = (
    Components.classes as unknown as Record<
      string,
      { createInstance(iid: typeof nsFilePicker): nsIFilePicker }
    >
  )["@mozilla.org/filepicker;1"];
  const picker = filePickerClass.createInstance(nsFilePicker);
  picker.init(
    win.browsingContext,
    mode === "save"
      ? uiText("导出配置文件", "Export configuration file")
      : uiText("导入配置文件", "Import configuration file"),
    mode === "save" ? nsFilePicker.modeSave : nsFilePicker.modeOpen,
  );
  picker.appendFilter(uiText("JSON 配置文件", "JSON configuration files"), "*.json");
  picker.appendFilters(nsFilePicker.filterAll ?? 1);
  picker.defaultExtension = "json";
  if (mode === "save") picker.defaultString = configBackupFileName();

  const result = await new Promise<nsIFilePicker.ResultCode>((resolve) => {
    picker.open({ done: resolve });
  });
  if (result === nsFilePicker.returnCancel) return null;
  if (mode === "save") {
    if (
      result !== nsFilePicker.returnOK &&
      result !== nsFilePicker.returnReplace
    ) {
      return null;
    }
  } else if (result !== nsFilePicker.returnOK) {
    return null;
  }
  return picker.file?.path ?? null;
}

async function writeTextToClipboard(
  doc: Document,
  text: string,
): Promise<void> {
  const clipboard = doc.defaultView?.navigator.clipboard;
  if (clipboard?.writeText) {
    await clipboard.writeText(text);
    return;
  }
  const area = doc.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  const root = doc.body ?? doc.documentElement;
  if (!root) return;
  root.append(area);
  area.select();
  doc.execCommand("copy");
  area.remove();
}

function fileErrorMessage(prefix: string, err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  return `${prefix}${uiText("：", ": ")}${detail}`;
}

function parseConfigBackup(raw: string): ParsedConfigBackup | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return uiText("配置 JSON 解析失败，请检查是否完整复制。", "Could not parse configuration JSON. Check that it was copied completely.");
  }
  if (!isRecord(parsed)) return uiText("配置 JSON 顶层必须是对象。", "The top level of the configuration JSON must be an object.");

  const sections: string[] = [];
  const result: ParsedConfigBackup = { sections };
  if (hasOwn(parsed, "presets")) {
    if (!Array.isArray(parsed.presets)) return uiText("配置里的 presets 必须是数组。", "The presets field must be an array.");
    result.presets = normalizePresetList(parsed.presets);
    sections.push(uiText("账号", "Accounts"));
  }
  if (hasOwn(parsed, "uiSettings")) {
    if (!isRecord(parsed.uiSettings)) return uiText("配置里的 uiSettings 必须是对象。", "The uiSettings field must be an object.");
    result.uiSettings = normalizeUiSettings(parsed.uiSettings);
    sections.push(uiText("显示", "Display"));
  }
  if (hasOwn(parsed, "quickPrompts")) {
    if (!isRecord(parsed.quickPrompts))
      return uiText("配置里的 quickPrompts 必须是对象。", "The quickPrompts field must be an object.");
    result.quickPrompts = normalizeQuickPromptSettings(parsed.quickPrompts);
    sections.push(uiText("提示词", "Prompts"));
  }
  if (hasOwn(parsed, "toolSettings")) {
    if (!isRecord(parsed.toolSettings))
      return uiText("配置里的 toolSettings 必须是对象。", "The toolSettings field must be an object.");
    result.toolSettings = normalizeToolSettings(parsed.toolSettings);
    sections.push(uiText("联网/MCP", "Web/MCP"));
  }
  if (hasOwn(parsed, "translateSettings")) {
    if (!isRecord(parsed.translateSettings)) {
      return uiText("配置里的 translateSettings 必须是对象。", "The translateSettings field must be an object.");
    }
    result.translateSettings = normalizeTranslateSettings(
      parsed.translateSettings,
    );
    sections.push(uiText("翻译", "Translation"));
  }
  if (hasOwn(parsed, "mineruSettings")) {
    if (!isRecord(parsed.mineruSettings)) {
      return uiText("配置里的 mineruSettings 必须是对象。", "The mineruSettings field must be an object.");
    }
    result.mineruSettings = normalizeMineruSettings(parsed.mineruSettings);
    sections.push("MinerU");
  }
  if (sections.length === 0) {
    return uiText("没有找到可导入的配置段：presets / uiSettings / quickPrompts / toolSettings / translateSettings / mineruSettings。", "No importable settings found. Expected one or more of: presets / uiSettings / quickPrompts / toolSettings / translateSettings / mineruSettings.");
  }
  return result;
}

function renderPresetSettings(
  doc: Document,
  dialogPresetId?: string | null,
): void {
  renderPresetRows(doc, loadPresets(zoteroPrefs()), dialogPresetId);
  updatePresetDirtyState(doc);
  setStatus(doc, "zai-preset-status", uiText("已加载账号配置。", "Account settings loaded."));
}

const TRANSLATE_THINKING_OPTIONS: Array<[TranslateThinking, string]> = [
  ["off", uiText("关闭 - 不思考，最快最省 token", "Off - No reasoning; fastest and lowest token use")],
  ["low", uiText("Low - 省 token，推荐翻译使用", "Low - Saves tokens; recommended for translation")],
  ["medium", uiText("Medium - 平衡", "Medium - Balanced")],
  ["high", uiText("High - 更强推理", "High - Deeper reasoning")],
  ["xhigh", uiText("Extra high - 最强推理", "Extra high - Strongest reasoning")],
];

// DeepSeek's Anthropic-format endpoint advertises two effective effort
// values (high / max). Per their docs (note 3): low/medium → high, xhigh
// → max — meaning the Low/Medium UI options would all behave identically
// to High on DeepSeek. We collapse to a smaller, honest list so users
// don't pick "Low" expecting a lighter model and silently get "High".
const TRANSLATE_THINKING_OPTIONS_DEEPSEEK: Array<[TranslateThinking, string]> =
  [
    ["off", uiText("关闭 - 不思考", "Off - No reasoning")],
    ["high", uiText("High - 标准思考（DeepSeek 默认）", "High - Standard reasoning (DeepSeek default)")],
    ["xhigh", uiText("Max - 强思考（复杂任务）", "Max - Strong reasoning (complex tasks)")],
  ];

function translateThinkingOptionsForPreset(
  preset: ModelPreset | null,
): Array<[TranslateThinking, string]> {
  if (
    preset?.provider === "anthropic" &&
    preset.extras?.vendor === "deepseek"
  ) {
    return TRANSLATE_THINKING_OPTIONS_DEEPSEEK;
  }
  return TRANSLATE_THINKING_OPTIONS;
}

// Map a saved thinking level to one that exists in the active preset's
// option list. Only DeepSeek needs collapsing today (low/medium → high).
function collapseThinkingForPreset(
  preset: ModelPreset | null,
  level: TranslateThinking,
): TranslateThinking {
  if (
    preset?.provider === "anthropic" &&
    preset.extras?.vendor === "deepseek"
  ) {
    if (level === "low" || level === "medium") return "high";
  }
  return level;
}

const TRANSLATE_CONTEXT_OPTIONS: Array<[TranslateContextLevel, string]> = [
  ["none", uiText("仅本句", "This sentence only")],
  ["paragraph", uiText("本段", "This paragraph")],
  ["page", uiText("整页", "Entire page")],
];

const TRANSLATE_POSITION_OPTIONS: Array<[TranslateOverlayPosition, string]> = [
  ["above", uiText("句上方", "Above sentence")],
  ["below", uiText("句下方", "Below sentence")],
];

const TRANSLATE_SIZE_OPTIONS: Array<[TranslateOverlaySize, string]> = [
  ["compact", uiText("紧凑（固定小框）", "Compact (fixed small card)")],
  ["adaptive", uiText("自适应（尽量展开）", "Adaptive (expand when possible)")],
];

const TRANSLATE_TRIGGER_OPTIONS: Array<[TranslateTriggerMode, string]> = [
  ["single", uiText("单击翻译", "Single-click to translate")],
  ["double", uiText("双击翻译", "Double-click to translate")],
];

function renderTranslateSettings(doc: Document): void {
  const settings = loadTranslateSettings(zoteroPrefs());
  const presets = translatePresets();
  const preset = translatePresetForSettings(presets, settings.presetId);
  const presetSelect = byID<HTMLSelectElement>(doc, "zai-translate-preset");
  if (presetSelect) {
    presetSelect.replaceChildren();
    if (presets.length === 0) {
      presetSelect.append(option(doc, "", uiText("请先保存账号配置", "Save an account first")));
      presetSelect.disabled = true;
    } else {
      presetSelect.disabled = false;
      for (const item of presets) {
        presetSelect.append(
          option(doc, item.id, item.label || item.model || "GPT"),
        );
      }
      presetSelect.value = preset?.id ?? presets[0]?.id ?? "";
    }
  }
  refreshTranslateModelSelect(doc, settings.model);
  populateSelectOptions(
    doc,
    "zai-translate-thinking",
    translateThinkingOptionsForPreset(preset),
    collapseThinkingForPreset(preset, settings.thinking),
  );
  populateSelectOptions(
    doc,
    "zai-translate-context",
    TRANSLATE_CONTEXT_OPTIONS,
    settings.ctxLevel,
  );
  populateSelectOptions(
    doc,
    "zai-translate-position",
    TRANSLATE_POSITION_OPTIONS,
    settings.overlayPosition,
  );
  populateSelectOptions(
    doc,
    "zai-translate-size",
    TRANSLATE_SIZE_OPTIONS,
    settings.overlaySize,
  );
  populateSelectOptions(
    doc,
    "zai-translate-trigger",
    TRANSLATE_TRIGGER_OPTIONS,
    settings.triggerMode,
  );
  setInputValue(doc, "zai-translate-next-key", settings.nextSentenceKey);
  setInputValue(doc, "zai-translate-prev-key", settings.prevSentenceKey);
  setInputValue(doc, "zai-mineru-token", loadMineruSettings(zoteroPrefs()).token);
  setStatus(
    doc,
    "zai-translate-status",
    presets.length
      ? uiText("已加载沉浸阅读模型设置。", "Immersive reading model settings loaded.")
      : uiText("请先在“账号与模型”里保存一个账号配置。", "Save an account under Accounts & models first."),
    presets.length === 0,
  );
}

// Repopulate the 思考程度 dropdown after a preset switch. Keep the user's
// existing selection if it survives the new vendor's option list; otherwise
// collapse it (low/medium → high on DeepSeek). Triggered from the preset
// change handler — initial render goes through renderTranslateSettings.
function refreshTranslateThinkingSelect(doc: Document): void {
  const thinkingSelect = byID<HTMLSelectElement>(doc, "zai-translate-thinking");
  if (!thinkingSelect) return;
  const presets = translatePresets();
  const presetId =
    byID<HTMLSelectElement>(doc, "zai-translate-preset")?.value ?? "";
  const preset = translatePresetForSettings(presets, presetId);
  const current = thinkingSelect.value as TranslateThinking;
  populateSelectOptions(
    doc,
    "zai-translate-thinking",
    translateThinkingOptionsForPreset(preset),
    collapseThinkingForPreset(preset, current),
  );
}

function refreshTranslateModelSelect(
  doc: Document,
  desiredModel?: string,
): string {
  const modelSelect = byID<HTMLSelectElement>(doc, "zai-translate-model");
  if (!modelSelect) return "";
  const presets = translatePresets();
  const presetId =
    byID<HTMLSelectElement>(doc, "zai-translate-preset")?.value ?? "";
  const preset = translatePresetForSettings(presets, presetId);
  const models = translateModelsForPreset(preset);
  const active = validTranslateModel(preset, desiredModel ?? modelSelect.value);
  modelSelect.replaceChildren();
  if (models.length === 0) {
    modelSelect.append(option(doc, "", uiText("无可用模型", "No models available")));
    modelSelect.value = "";
    modelSelect.disabled = true;
    return "";
  }
  modelSelect.disabled = false;
  for (const model of models) modelSelect.append(option(doc, model, model));
  modelSelect.value = active;
  return active;
}

function saveTranslateSettingsControls(doc: Document): void {
  const settings = readTranslateSettingsControls(doc);
  saveTranslateSettings(zoteroPrefs(), settings);
  refreshSidebarPreferences();
  setStatus(doc, "zai-translate-status", uiText("已自动保存；下一次翻译立即使用。", "Saved automatically; changes apply to the next translation."));
}

function readTranslateSettingsControls(doc: Document): TranslateSettings {
  const existing = loadTranslateSettings(zoteroPrefs());
  const presets = translatePresets();
  const presetId =
    byID<HTMLSelectElement>(doc, "zai-translate-preset")?.value ?? "";
  const preset = translatePresetForSettings(presets, presetId);
  return normalizeTranslateSettings({
    ...existing,
    enabled: false,
    presetId: preset?.id ?? "",
    model: validTranslateModel(
      preset,
      byID<HTMLSelectElement>(doc, "zai-translate-model")?.value ?? "",
    ),
    thinking: translateThinkingValue(
      byID<HTMLSelectElement>(doc, "zai-translate-thinking")?.value,
    ),
    ctxLevel: translateContextValue(
      byID<HTMLSelectElement>(doc, "zai-translate-context")?.value,
    ),
    overlayPosition: translatePositionValue(
      byID<HTMLSelectElement>(doc, "zai-translate-position")?.value,
    ),
    overlaySize: translateSizeValue(
      byID<HTMLSelectElement>(doc, "zai-translate-size")?.value ??
        existing.overlaySize,
    ),
    triggerMode: translateTriggerValue(
      byID<HTMLSelectElement>(doc, "zai-translate-trigger")?.value ??
        existing.triggerMode,
    ),
    nextSentenceKey:
      byID<HTMLInputElement>(doc, "zai-translate-next-key")?.value.trim() ||
      existing.nextSentenceKey,
    prevSentenceKey:
      byID<HTMLInputElement>(doc, "zai-translate-prev-key")?.value.trim() ||
      existing.prevSentenceKey,
  });
}

function saveMineruSettingsControls(doc: Document): void {
  const token =
    byID<HTMLInputElement>(doc, "zai-mineru-token")?.value.trim() ?? "";
  saveMineruSettings(zoteroPrefs(), { token });
  setStatus(doc, "zai-mineru-status", uiText("已保存 MinerU Token。", "MinerU token saved."));
}

async function runMineruTest(doc: Document): Promise<void> {
  saveMineruSettingsControls(doc);
  const token = loadMineruSettings(zoteroPrefs()).token;
  if (!token) {
    setStatus(
      doc,
      "zai-mineru-status",
      uiText("还没有 Token。请到 https://mineru.net/apiManage/token 申请，填入后再测试。", "No token yet. Get one at https://mineru.net/apiManage/token, enter it, then test the connection."),
      true,
    );
    return;
  }
  const button = byID<HTMLButtonElement>(doc, "zai-mineru-test");
  if (button) button.disabled = true;
  setStatus(doc, "zai-mineru-status", uiText("正在测试 MinerU 连接…", "Testing MinerU connection…"));
  try {
    await probeMineruToken({ token });
    setStatus(doc, "zai-mineru-status", uiText("MinerU 连接成功。", "MinerU connection succeeded."));
    flashButton(button, uiText("已连接", "Connected"));
  } catch (error) {
    setStatus(doc, "zai-mineru-status", String(error), true);
  } finally {
    if (button) button.disabled = false;
  }
}

function translatePresets(): ModelPreset[] {
  return loadPresets(zoteroPrefs());
}

function translatePresetForSettings(
  presets: ModelPreset[],
  presetId: string,
): ModelPreset | null {
  return presets.find((preset) => preset.id === presetId) ?? presets[0] ?? null;
}

function translateModelsForPreset(preset: ModelPreset | null): string[] {
  if (!preset) return [];
  const seen = new Set<string>();
  const models: string[] = [];
  for (const raw of [preset.model, ...(preset.models ?? [])]) {
    const model = raw.trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);
    models.push(model);
  }
  return models;
}

function validTranslateModel(
  preset: ModelPreset | null,
  desired: string,
): string {
  const models = translateModelsForPreset(preset);
  return desired && models.includes(desired) ? desired : (models[0] ?? "");
}

function translateThinkingValue(value: unknown): TranslateThinking {
  return value === "off" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
    ? value
    : "low";
}

function translateContextValue(value: unknown): TranslateContextLevel {
  return value === "paragraph" || value === "page" ? value : "none";
}

function translatePositionValue(value: unknown): TranslateOverlayPosition {
  return value === "below" ? "below" : "above";
}

function translateSizeValue(value: unknown): TranslateOverlaySize {
  return value === "adaptive" ? "adaptive" : "compact";
}

function translateTriggerValue(value: unknown): TranslateTriggerMode {
  return value === "double" ? "double" : "single";
}

function renderUiSettings(doc: Document): void {
  const settings = loadUiSettings(zoteroPrefs());
  const localSettings = loadLocalUiSettings(zoteroPrefs());
  const uiLanguage = byID<HTMLSelectElement>(doc, "zai-ui-language");
  if (uiLanguage) {
    uiLanguage.value = normalizeUiLanguage(zoteroPrefs().get(UI_LANGUAGE_PREF));
  }
  setInputValue(doc, "zai-ui-user-label", settings.userProfile.label);
  setInputValue(doc, "zai-ui-user-avatar", settings.userProfile.avatar);
  setInputValue(doc, "zai-ui-assistant-label", settings.assistantProfile.label);
  setInputValue(
    doc,
    "zai-ui-assistant-avatar",
    settings.assistantProfile.avatar,
  );
  renderUiSignatureRows(doc, settings.assistantSignatures);
  const signaturesEnabled = byID<HTMLInputElement>(
    doc,
    "zai-ui-signature-enabled",
  );
  if (signaturesEnabled) {
    signaturesEnabled.checked = settings.assistantSignaturesEnabled;
  }
  setInputValue(doc, "zai-ui-chat-font", settings.chatFontFamily);
  const position = byID<HTMLSelectElement>(doc, "zai-ui-actions-position");
  if (position) position.value = settings.messageActionsPosition;
  const layout = byID<HTMLSelectElement>(doc, "zai-ui-actions-layout");
  if (layout) layout.value = settings.messageActionsLayout;
  const borderStyle = byID<HTMLSelectElement>(
    doc,
    "zai-ui-preference-border-style",
  );
  if (borderStyle) borderStyle.value = settings.preferenceBorderStyle;
  applyPreferenceBorderStyle(doc, settings.preferenceBorderStyle);
  const queue = byID<HTMLInputElement>(doc, "zai-ui-composer-queue");
  if (queue) queue.checked = settings.composerQueueWhileSending;
  setInputValue(
    doc,
    "zai-ui-max-parallel-conversations",
    String(settings.maxParallelConversations),
  );
  const confirmConversationDeletion = byID<HTMLInputElement>(
    doc,
    "zai-ui-confirm-conversation-deletion",
  );
  if (confirmConversationDeletion) {
    confirmConversationDeletion.checked = settings.confirmConversationDeletion;
  }
  const chatLayout = byID<HTMLSelectElement>(doc, "zai-ui-chat-layout");
  if (chatLayout) chatLayout.value = localSettings.chatLayout;
  const sidebarDisplay = byID<HTMLSelectElement>(doc, "zai-ui-sidebar-display");
  if (sidebarDisplay) {
    sidebarDisplay.value = localSettings.sidebarDisplayMode;
  }
  setStatus(doc, "zai-ui-status", uiText("已加载显示设置。", "Display settings loaded."));
}

function readLocalUiSettingsControls(doc: Document): LocalUiSettings {
  const current = loadLocalUiSettings(zoteroPrefs());
  return normalizeLocalUiSettings({
    ...current,
    chatLayout: byID<HTMLSelectElement>(doc, "zai-ui-chat-layout")?.value,
    sidebarDisplayMode: byID<HTMLSelectElement>(doc, "zai-ui-sidebar-display")
      ?.value,
  });
}

function saveLocalUiSettingsControls(doc: Document): void {
  saveLocalUiSettings(zoteroPrefs(), readLocalUiSettingsControls(doc));
  refreshSidebarPreferences();
  setStatus(doc, "zai-ui-status", uiText("本机排版设置已保存，侧边栏已刷新。", "Local layout settings saved; sidebar refreshed."));
}

function readUiSettingsControls(doc: Document): UiSettings {
  const position = byID<HTMLSelectElement>(doc, "zai-ui-actions-position");
  const layout = byID<HTMLSelectElement>(doc, "zai-ui-actions-layout");
  const borderStyle = byID<HTMLSelectElement>(
    doc,
    "zai-ui-preference-border-style",
  );
  return normalizeUiSettings({
    userProfile: {
      label: byID<HTMLInputElement>(doc, "zai-ui-user-label")?.value,
      avatar: byID<HTMLInputElement>(doc, "zai-ui-user-avatar")?.value,
    },
    assistantProfile: {
      label: byID<HTMLInputElement>(doc, "zai-ui-assistant-label")?.value,
      avatar: byID<HTMLInputElement>(doc, "zai-ui-assistant-avatar")?.value,
    },
    assistantSignatures: readUiSignatureRows(doc),
    assistantSignaturesEnabled:
      byID<HTMLInputElement>(doc, "zai-ui-signature-enabled")?.checked !==
      false,
    chatFontFamily: byID<HTMLInputElement>(doc, "zai-ui-chat-font")?.value,
    messageActionsPosition: position?.value,
    messageActionsLayout: layout?.value,
    preferenceBorderStyle: borderStyle?.value,
    composerQueueWhileSending:
      byID<HTMLInputElement>(doc, "zai-ui-composer-queue")?.checked === true,
    maxParallelConversations: Number(
      byID<HTMLInputElement>(doc, "zai-ui-max-parallel-conversations")?.value,
    ),
    confirmConversationDeletion:
      byID<HTMLInputElement>(doc, "zai-ui-confirm-conversation-deletion")
        ?.checked !== false,
  });
}

function renderUiSignatureRows(doc: Document, signatures: string[]): void {
  const list = byID<HTMLElement>(doc, "zai-ui-signature-list");
  if (!list) return;
  list.replaceChildren(
    ...signatures.map((signature) => uiSignatureRow(doc, signature)),
  );
  refreshUiSignatureRows(doc);
}

function uiSignatureRow(doc: Document, signature: string): HTMLElement {
  const row = el(doc, "div", "zai-signature-row");
  const index = el(doc, "span", "zai-signature-index");
  const field = input(doc, signature);
  field.maxLength = 80;
  field.addEventListener("change", () => saveUiSettingsControls(doc));

  const actions = el(doc, "div", "zai-signature-actions");
  for (const [action, label, symbol] of [
    ["up", uiText("上移签名", "Move signature up"), "↑"],
    ["down", uiText("下移签名", "Move signature down"), "↓"],
    ["delete", uiText("删除签名", "Delete signature"), "×"],
  ] as const) {
    const control = button(doc, symbol);
    control.className = "zai-signature-action";
    control.dataset.action = action;
    control.title = label;
    control.setAttribute("aria-label", label);
    control.addEventListener("click", () => {
      const list = row.parentElement;
      if (!list) return;
      if (action === "up" && row.previousElementSibling) {
        list.insertBefore(row, row.previousElementSibling);
      } else if (action === "down" && row.nextElementSibling) {
        list.insertBefore(row.nextElementSibling, row);
      } else if (action === "delete") {
        row.remove();
      }
      refreshUiSignatureRows(doc);
      saveUiSettingsControls(doc);
    });
    actions.append(control);
  }

  row.append(index, field, actions);
  return row;
}

function readUiSignatureRows(doc: Document): string[] {
  const fields = Array.from(
    doc.querySelectorAll("#zai-ui-signature-list .zai-signature-row input"),
  ) as HTMLInputElement[];
  return fields
    .map((field) => field.value.trim())
    .filter(Boolean);
}

function refreshUiSignatureRows(doc: Document): void {
  const rows = Array.from(
    doc.querySelectorAll("#zai-ui-signature-list .zai-signature-row"),
  ) as HTMLElement[];
  rows.forEach((row, index) => {
    const label = row.querySelector<HTMLElement>(".zai-signature-index");
    if (label) label.textContent = String(index + 1);
    const field = row.querySelector<HTMLInputElement>("input");
    field?.setAttribute("aria-label", `${uiText("签名", "Signature")} ${index + 1}`);
    const up = row.querySelector<HTMLButtonElement>('[data-action="up"]');
    const down = row.querySelector<HTMLButtonElement>(
      '[data-action="down"]',
    );
    if (up) up.disabled = index === 0;
    if (down) down.disabled = index === rows.length - 1;
  });
  const count = byID<HTMLElement>(doc, "zai-ui-signature-count");
  if (count) count.textContent = `${readUiSignatureRows(doc).length} ${uiText("条", "items")}`;
}

function saveUiSettingsControls(doc: Document): void {
  const settings = readUiSettingsControls(doc);
  saveUiSettings(zoteroPrefs(), settings);
  applyPreferenceBorderStyle(doc, settings.preferenceBorderStyle);
  refreshSidebarPreferences();
  setStatus(doc, "zai-ui-status", uiText("显示设置已自动保存，侧边栏已刷新。", "Display settings saved automatically; sidebar refreshed."));
}

function applyPreferenceBorderStyle(
  doc: Document,
  style: UiSettings["preferenceBorderStyle"],
): void {
  const root = byID<HTMLElement>(doc, "zotero-ai-sidebar-tool-settings");
  if (root) root.dataset.borderStyle = style;
}

function setInputValue(doc: Document, id: string, value: string): void {
  const inputNode = byID<HTMLInputElement>(doc, id);
  if (inputNode) inputNode.value = value;
}

function populateSelectOptions<T extends string>(
  doc: Document,
  id: string,
  options: Array<[T, string]>,
  value: string,
): void {
  const selectNode = byID<HTMLSelectElement>(doc, id);
  if (!selectNode) return;
  selectNode.replaceChildren();
  for (const [optionValue, label] of options) {
    selectNode.append(option(doc, optionValue, label));
  }
  selectNode.value = value;
}

function renderSyncSettings(doc: Document): void {
  const account = loadSyncAccount(zoteroPrefs());
  setInputValue(doc, "zai-sync-url", account.webdavUrl);
  setInputValue(doc, "zai-sync-username", account.username);
  setInputValue(doc, "zai-sync-password", account.password);
  setInputValue(doc, "zai-sync-folder", account.remoteFolder);
  renderSyncAccountState(doc, account);
}

function renderSyncAccountState(doc: Document, account: SyncAccount): void {
  const auto = byID<HTMLButtonElement>(doc, "zai-sync-auto");
  if (auto) {
    auto.dataset.enabled = account.autoSyncEnabled ? "true" : "false";
    auto.setAttribute(
      "aria-pressed",
      account.autoSyncEnabled ? "true" : "false",
    );
    const label = auto.querySelector<HTMLElement>(".zai-switch-label");
    if (label) label.textContent = account.autoSyncEnabled ? uiText("开启", "On") : uiText("关闭", "Off");
    else auto.textContent = account.autoSyncEnabled ? uiText("开启", "On") : uiText("关闭", "Off");
    auto.title = account.autoSyncEnabled
      ? uiText("已开启：启动时和每 10 分钟自动从云端下载合并，再上传到云端", "On: downloads and merges from cloud at startup and every 10 minutes, then uploads.")
      : uiText("已关闭：点击后开启自动下载合并 + 上传", "Off: click to enable automatic download, merge, and upload");
  }
  const meta = byID<HTMLElement>(doc, "zai-sync-meta");
  if (meta) meta.textContent = formatSyncMeta(account);
}

function readSyncAccountControls(doc: Document): SyncAccount {
  const existing = loadSyncAccount(zoteroPrefs());
  return {
    ...existing,
    webdavUrl:
      byID<HTMLInputElement>(doc, "zai-sync-url")?.value ?? existing.webdavUrl,
    username:
      byID<HTMLInputElement>(doc, "zai-sync-username")?.value ??
      existing.username,
    password:
      byID<HTMLInputElement>(doc, "zai-sync-password")?.value ??
      existing.password,
    remoteFolder:
      byID<HTMLInputElement>(doc, "zai-sync-folder")?.value ??
      existing.remoteFolder,
  };
}

function formatSyncMeta(account: SyncAccount): string {
  const parts: string[] = [];
  parts.push(
    account.lastPushAt
      ? `${uiText("上次上传", "Last upload")}: ${account.lastPushAt}`
      : uiText("上次上传：未上传", "Last upload: never"),
  );
  parts.push(
    account.lastPullAt
      ? `${uiText("上次下载", "Last download")}: ${account.lastPullAt}`
      : uiText("上次下载：未下载", "Last download: never"),
  );
  parts.push(account.autoSyncEnabled ? uiText("自动同步：开", "Auto-sync: on") : uiText("自动同步：关", "Auto-sync: off"));
  if (account.lastAutoSyncAt)
    parts.push(`${uiText("上次自动同步", "Last auto-sync")}: ${account.lastAutoSyncAt}`);
  return parts.join(" · ");
}

function renderPresetRows(
  doc: Document,
  presets: ModelPreset[],
  dialogPresetId?: string | null,
): void {
  const list = byID<HTMLElement>(doc, "zai-preset-list");
  const picker = byID<HTMLElement>(doc, "zai-preset-picker");
  const previousSelection = picker?.dataset.activePresetId ?? "";
  if (!list) return;
  list.replaceChildren();
  picker?.replaceChildren();
  if (picker && dialogPresetId !== undefined) {
    picker.dataset.dialogPresetId = dialogPresetId ?? "";
  }
  if (presets.length === 0) {
    picker?.setAttribute("hidden", "hidden");
    list.append(
      el(
        doc,
        "div",
        "zai-pref-help",
        uiText("还没有模型配置。点击 + OpenAI 或 + Anthropic 新增。", "No model accounts yet. Click + OpenAI or + Anthropic to add one."),
      ),
    );
    refreshCacheTestControls(doc, presets);
    return;
  }
  const requestedSelection = dialogPresetId ?? previousSelection;
  const selectedId = presets.some((preset) => preset.id === requestedSelection)
    ? requestedSelection
    : presets[0].id;
  if (picker) {
    picker.removeAttribute("hidden");
    const activeDialogId = picker.dataset.dialogPresetId ?? "";
    for (const preset of presets) {
      picker.append(
        presetPickerItem(doc, preset, preset.id === activeDialogId),
      );
    }
  }
  for (const preset of presets) list.append(presetRow(doc, preset));
  activatePresetRow(doc, selectedId);
  refreshCacheTestControls(doc, presets);
  attachPresetDirtyListeners(doc);
  updatePresetDirtyState(doc);
}

function openPresetRow(doc: Document, id: string): void {
  activatePresetRow(doc, id);
}

function activatePresetRow(doc: Document, id: string): void {
  const picker = byID<HTMLElement>(doc, "zai-preset-picker");
  if (picker) picker.dataset.activePresetId = id;
  for (const node of Array.from(
    doc.querySelectorAll(".zai-preset-picker-item"),
  )) {
    const item = node as HTMLButtonElement;
    item.setAttribute("aria-selected", String(item.dataset.id === id));
  }
  const rows = Array.from(doc.querySelectorAll(".zai-preset-row"));
  for (const node of rows) {
    const row = node as HTMLElement;
    const active = row.dataset.id === id;
    if (active) row.removeAttribute("hidden");
    else row.setAttribute("hidden", "hidden");
    row.classList.toggle("zai-preset-row-active", active);
    if (active && row.tagName.toLowerCase() === "details") {
      (row as HTMLDetailsElement).open = true;
    }
  }
}

function presetPickerItem(
  doc: Document,
  preset: ModelPreset,
  activeInDialog: boolean,
): HTMLButtonElement {
  const item = doc.createElement("button");
  item.type = "button";
  item.className = "zai-preset-picker-item";
  item.dataset.id = preset.id;
  item.setAttribute("role", "option");
  item.setAttribute("aria-selected", "false");
  const status = el(doc, "span", "zai-preset-status-dot");
  applyPresetStatusDot(status, preset.extras?.testStatus);
  const copy = el(doc, "span", "zai-preset-picker-copy");
  const title = el(doc, "span", "zai-preset-picker-title");
  const provider = preset.provider === "anthropic" ? "Anthropic" : "OpenAI";
  title.append(
    el(doc, "strong", "", preset.label || provider),
    el(doc, "span", "zai-preset-provider-badge", provider),
  );
  const modelCount = preset.models?.length ?? (preset.model ? 1 : 0);
  const model = preset.model || preset.models?.[0] || uiText("未填写模型", "No model selected");
  const suffix = modelCount > 1 ? ` +${modelCount - 1}` : "";
  copy.append(
    title,
    el(doc, "span", "zai-preset-picker-meta", `${model}${suffix}`),
  );
  item.append(status, copy);
  if (activeInDialog) {
    item.append(el(doc, "span", "zai-preset-dialog-badge", uiText("AI 对话", "AI Chat")));
  }
  item.addEventListener("click", () => activatePresetRow(doc, preset.id));
  return item;
}

function refreshPresetPickerItem(doc: Document, preset: ModelPreset): void {
  const item = doc.querySelector<HTMLElement>(
    `.zai-preset-picker-item[data-id="${cssEscape(preset.id)}"]`,
  );
  const status = item?.querySelector<HTMLElement>(".zai-preset-status-dot");
  if (status) applyPresetStatusDot(status, preset.extras?.testStatus);
}

function applyPresetStatusDot(
  statusDot: HTMLElement,
  status?: "ok" | "failed",
): void {
  statusDot.className = `zai-preset-status-dot${status === "ok" ? " zai-dot-ok" : status === "failed" ? " zai-dot-fail" : ""}`;
  statusDot.title =
    status === "ok"
      ? uiText("连接测试通过", "Connection test passed")
      : status === "failed"
        ? uiText("连接测试失败", "Connection test failed")
        : uiText("未测试", "Not tested");
}

function presetRow(doc: Document, preset: ModelPreset): HTMLElement {
  const card = doc.createElement("details");
  card.className = "zai-subcard zai-preset-row";
  card.dataset.id = preset.id;
  card.open = true;
  const title = doc.createElement("summary");
  title.className = "zai-subcard-title zai-preset-summary";
  const main = el(doc, "span", "zai-preset-summary-main");
  main.append(el(doc, "strong", "", uiText("配置详情", "Configuration details")));
  title.append(main);
  const testMsg = el(doc, "span", "zai-preset-test-msg");
  const flagControl = presetFlagsControl(doc, preset);
  const flagLabel = el(doc, "label", "", uiText("标志位", "Flags"));
  const testBtn = button(doc, uiText("测试", "Test"));
  testBtn.title = uiText("使用下方 Models 中勾选的模型测试连接。", "Test the connection using the model selected below.");
  testBtn.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    testBtn.disabled = true;
    testBtn.textContent = uiText("测试中...", "Testing...");
    testMsg.textContent = "";
    testMsg.className = "zai-preset-test-msg";
    const rawPreset = readPresetFromCard(card);
    const testPreset = withPresetTestModel(
      rawPreset,
      selectedTestModelFromCard(card),
    );
    try {
      const result = await testPresetConnectivity(testPreset);
      const saved = mergePresetTestResult(rawPreset, result.preset, "ok");
      updatePresetInStorage(saved);
      refreshPresetPickerItem(doc, saved);
      activatePresetRow(doc, rawPreset.id);
      testBtn.textContent = uiText("✓ 通过", "✓ Passed");
      testMsg.textContent = result.message;
      testMsg.className = "zai-preset-test-msg zai-test-ok";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const failed = mergePresetTestResult(rawPreset, testPreset, "failed");
      updatePresetInStorage(failed);
      refreshPresetPickerItem(doc, failed);
      activatePresetRow(doc, rawPreset.id);
      testBtn.textContent = uiText("✗ 失败", "✗ Failed");
      testMsg.textContent = msg;
      testMsg.className = "zai-preset-test-msg zai-test-fail";
    } finally {
      testBtn.disabled = false;
      updatePresetDirtyState(doc);
      setTimeout(() => {
        testBtn.textContent = uiText("测试", "Test");
      }, 3000);
    }
  });
  title.append(testBtn);
  const remove = button(doc, uiText("删除", "Delete"));
  remove.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const remaining = readPresetControls(doc).filter(
      (candidate) => candidate.id !== preset.id,
    );
    card.remove();
    renderPresetRows(doc, remaining);
    updatePresetDirtyState(doc);
    setStatus(
      doc,
      "zai-preset-status",
      `${uiText("已移除", "Removed")} ${preset.label || preset.provider} ${uiText("卡片，请点击顶部“保存更改”。", "account card. Click Save changes above.")}`,
    );
    refreshCacheTestControls(doc, readPresetControls(doc));
  });
  title.append(remove);

  const provider = select(
    doc,
    [
      ["openai", uiText("OpenAI 兼容", "OpenAI compatible")],
      ["anthropic", "Anthropic"],
    ],
    preset.provider,
  );
  provider.dataset.field = "provider";
  const label = input(doc, preset.label);
  label.dataset.field = "label";
  const apiKey = input(doc, preset.apiKey, "password");
  apiKey.dataset.field = "apiKey";
  const baseUrl = input(doc, preset.baseUrl);
  baseUrl.dataset.field = "baseUrl";
  const initialVendor: AnthropicVendor =
    preset.extras?.vendor ??
    detectAnthropicVendor(preset.baseUrl, preset.model);
  const automaticKey = resolveModelSuggestionKey(
    preset.provider,
    preset.baseUrl,
    (preset.models?.length ? preset.models : [preset.model]).filter(Boolean),
    initialVendor,
  );
  const inferredNameGroup = inferModelSuggestionGroupFromName(preset.label);
  const initialGroup: ModelSuggestionGroup =
    preset.provider === "openai"
      ? (preset.extras?.modelSuggestionGroup ??
        (automaticKey === "custom" ? inferredNameGroup : undefined) ??
        "auto")
      : "auto";
  const initialKey =
    initialGroup === "auto"
      ? automaticKey
      : resolveModelSuggestionKey(
          preset.provider,
          preset.baseUrl,
          (preset.models?.length ? preset.models : [preset.model]).filter(
            Boolean,
          ),
          initialVendor,
          initialGroup,
        );
  const modelList = createModelListControl(
    doc,
    (preset.models?.length ? preset.models : [preset.model]).filter(Boolean),
    initialKey,
    preset.model,
    preset.id,
  );
  const reasoningControls = createReasoningControls(
    doc,
    preset,
    modelList.models(),
  );
  const maxTokens = input(doc, String(preset.maxTokens || 32768), "number");
  maxTokens.dataset.field = "maxTokens";
  maxTokens.classList.add("zai-number-input");
  const reasoningSummary = select(
    doc,
    REASONING_SUMMARY_OPTIONS.map(([value, label]) => [
      value,
      uiText(label, reasoningSummaryLabelEnglish(value)),
    ] as [ReasoningSummary, string]),
    preset.extras?.reasoningSummary ?? DEFAULT_REASONING_SUMMARY,
  );
  reasoningSummary.dataset.field = "reasoningSummary";
  const vendor = select<AnthropicVendor>(
    doc,
    [
      ["claude", uiText("Claude（官方/反代）", "Claude (official or proxy)")],
      ["deepseek", uiText("DeepSeek (Anthropic 格式)", "DeepSeek (Anthropic format)")],
      ["compat", uiText("其它兼容（不发思考字段）", "Other compatible APIs (no reasoning fields)")],
    ],
    initialVendor,
  );
  vendor.dataset.field = "vendor";
  // Vendor row is hidden for OpenAI presets; we still build it so the
  // dataset.field hookup is uniform — readPresetControls picks it up only
  // when the preset is anthropic.
  const vendorLabel = el(doc, "label", "", "Vendor");
  const reasoningLabel = el(doc, "label", "", "Reasoning Summary");
  const modelGroup = select<ModelSuggestionGroup>(
    doc,
    [
      ["auto", uiText("自动识别", "Auto-detect")],
      ["openai", "OpenAI"],
      ["deepseek", "DeepSeek"],
      ["claude", "Claude"],
      ["custom", uiText("自定义", "Custom")],
    ],
    initialGroup,
  );
  modelGroup.dataset.field = "modelSuggestionGroup";
  const modelGroupLabel = el(doc, "label", "", uiText("模型组", "Model group"));

  const syncModelSuggestionKey = () => {
    const kind = provider.value === "anthropic" ? "anthropic" : "openai";
    const automaticKey = resolveModelSuggestionKey(
      kind,
      baseUrl.value,
      modelList.models(),
      vendor.value as AnthropicVendor,
      "auto",
    );
    const selectedGroup = modelGroup.value as ModelSuggestionGroup;
    const nextKey =
      selectedGroup !== "auto"
        ? resolveModelSuggestionKey(
            kind,
            baseUrl.value,
            modelList.models(),
            vendor.value as AnthropicVendor,
            selectedGroup,
          )
        : kind === "openai" && automaticKey === "custom"
          ? (inferModelSuggestionGroupFromName(label.value) ?? automaticKey)
          : automaticKey;
    modelList.setSuggestionKey(nextKey);
  };

  const refreshReasoningControls = () => {
    reasoningControls.refresh(
      {
        ...preset,
        provider: provider.value === "anthropic" ? "anthropic" : "openai",
        baseUrl: baseUrl.value,
        extras: {
          ...preset.extras,
          vendor: vendor.value as AnthropicVendor,
        },
      },
      modelList.models(),
    );
  };

  const syncProvider = () => {
    const isOpenAI = provider.value === "openai";
    reasoningSummary.disabled = !isOpenAI;
    const showHide = (lbl: HTMLElement, ctrl: HTMLElement, show: boolean) => {
      lbl.style.display = show ? "" : "none";
      ctrl.style.display = show ? "" : "none";
    };
    showHide(vendorLabel, vendor, !isOpenAI);
    showHide(reasoningLabel, reasoningSummary, isOpenAI);
    showHide(modelGroupLabel, modelGroup, isOpenAI);
  };
  provider.addEventListener("change", () => {
    const kind = provider.value as ProviderKind;
    if (!label.value.trim())
      label.value = kind === "anthropic" ? "Claude" : "GPT";
    if (!baseUrl.value.trim()) baseUrl.value = DEFAULT_BASE_URLS[kind];
    syncModelSuggestionKey();
    if (modelList.models().length === 0 && DEFAULT_MODELS[kind]) {
      modelList.setModels([DEFAULT_MODELS[kind]]);
    }
    refreshReasoningControls();
    syncProvider();
    updatePresetDirtyState(doc);
  });
  vendor.addEventListener("change", () => {
    if (provider.value !== "anthropic") return;
    syncModelSuggestionKey();
    refreshReasoningControls();
    updatePresetDirtyState(doc);
  });
  modelGroup.addEventListener("change", () => {
    syncModelSuggestionKey();
    updatePresetDirtyState(doc);
  });

  modelList.onModelsChange(() => {
    syncModelSuggestionKey();
    refreshReasoningControls();
  });
  label.addEventListener("input", syncModelSuggestionKey);
  label.addEventListener("change", syncModelSuggestionKey);
  baseUrl.addEventListener("input", syncModelSuggestionKey);
  baseUrl.addEventListener("change", syncModelSuggestionKey);
  baseUrl.addEventListener("input", refreshReasoningControls);
  baseUrl.addEventListener("change", refreshReasoningControls);
  syncProvider();
  card.append(
    title,
    grid(doc, [
      ["Provider", provider],
      [uiText("名称", "Name"), label],
      ["API Key", apiKey],
      ["Base URL", baseUrl],
      ["Models", modelList.element],
      [uiText("推理强度（按模型）", "Reasoning effort (per model)"), reasoningControls.element],
      [modelGroupLabel, modelGroup],
      ["Max tokens", maxTokens],
      [vendorLabel, vendor],
      [reasoningLabel, reasoningSummary],
      [flagLabel, flagControl],
    ]),
    testMsg,
  );
  const refreshFlagsFromControls = () =>
    refreshPresetFlags(flagControl, readPresetFromCard(card));
  for (const eventName of ["input", "change"]) {
    reasoningControls.element.addEventListener(eventName, () => {
      refreshFlagsFromControls();
      updatePresetDirtyState(doc);
    });
  }
  for (const control of [
    provider,
    baseUrl,
    reasoningSummary,
    modelList.element,
  ]) {
    control.addEventListener("input", refreshFlagsFromControls);
    control.addEventListener("change", refreshFlagsFromControls);
  }
  const refreshCacheTarget = (event: Event) => {
    const target = event.target as Element | null;
    const cachePreset = byID<HTMLSelectElement>(doc, "zai-cache-test-preset");
    if (
      target?.classList.contains("zai-model-test-radio") &&
      provider.value === "openai" &&
      cachePreset
    ) {
      cachePreset.value = card.dataset.id ?? "";
    }
    refreshCacheTestTarget(doc);
  };
  modelList.element.addEventListener("input", refreshCacheTarget);
  modelList.element.addEventListener("change", refreshCacheTarget);
  provider.addEventListener("change", () =>
    refreshCacheTestControls(doc, readPresetControls(doc)),
  );
  return card;
}

function withPresetTestModel(preset: ModelPreset, model: string): ModelPreset {
  const selected = model.trim();
  if (!selected || selected === preset.model) return preset;
  return { ...preset, model: selected };
}

function mergePresetTestResult(
  rawPreset: ModelPreset,
  testedPreset: ModelPreset,
  status: "ok" | "failed",
): ModelPreset {
  return {
    ...rawPreset,
    extras: {
      ...rawPreset.extras,
      ...testedPreset.extras,
      testStatus: status,
    },
  };
}

function selectedTestModelFromCard(card: HTMLElement): string {
  const selected = card.querySelector<HTMLInputElement>(
    ".zai-model-test-radio:checked",
  );
  const model = selected
    ?.closest(".zai-model-chip")
    ?.querySelector<HTMLInputElement>(".zai-model-chip-input")
    ?.value.trim();
  if (model) return model;
  return splitList(controlValue(card, "models"))[0] ?? "";
}

function refreshCacheTestControls(doc: Document, presets: ModelPreset[]): void {
  const account = byID<HTMLSelectElement>(doc, "zai-cache-test-preset");
  if (!account) return;
  const previous = account.value;
  const supported = presets.filter((preset) => preset.provider === "openai");
  account.replaceChildren();
  for (const preset of supported) {
    account.append(
      option(doc, preset.id, preset.label || preset.model || "OpenAI"),
    );
  }
  account.value = supported.some((preset) => preset.id === previous)
    ? previous
    : (supported[0]?.id ?? "");
  account.disabled = supported.length === 0;
  refreshCacheTestTarget(doc);
}

function selectedCacheTestCard(doc: Document): HTMLElement | null {
  const id = byID<HTMLSelectElement>(doc, "zai-cache-test-preset")?.value;
  if (!id) return null;
  return doc.querySelector<HTMLElement>(
    `.zai-preset-row[data-id="${cssEscape(id)}"]`,
  );
}

function refreshCacheTestTarget(doc: Document): void {
  const target = byID<HTMLElement>(doc, "zai-cache-test-target");
  const run = byID<HTMLButtonElement>(doc, "zai-cache-test-run");
  if (!target || !run) return;
  const card = selectedCacheTestCard(doc);
  const model = card ? selectedTestModelFromCard(card) : "";
  target.textContent = card
    ? `${uiText("测试模型", "Test model")}: ${model || uiText("未选择", "not selected")}`
    : uiText("没有可用的 OpenAI 配置", "No OpenAI account available");
  run.disabled = !card || !model;
  run.title =
    card && model
      ? uiText("连续发送两次相同内容，检查 prompt cache 命中情况。", "Sends the same text twice to check for a prompt cache hit.")
      : uiText("请先配置 OpenAI 账号和模型。", "Configure an OpenAI account and model first.");
}

async function runSelectedPromptCacheTest(doc: Document): Promise<void> {
  const run = byID<HTMLButtonElement>(doc, "zai-cache-test-run");
  const card = selectedCacheTestCard(doc);
  if (!run || !card) return;
  const rawPreset = readPresetFromCard(card);
  const testPreset = withPresetTestModel(
    rawPreset,
    selectedTestModelFromCard(card),
  );
  run.disabled = true;
  run.textContent = uiText("测试中...", "Testing...");
  setStatus(
    doc,
    "zai-cache-test-status",
    uiText(`正在测试 ${rawPreset.label} / ${testPreset.model} 的 prompt cache...`, `Testing prompt cache for ${rawPreset.label} / ${testPreset.model}...`),
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const testText = await promptCacheTestTextForPreferences();
    const result = await runPresetPromptCacheTest(
      testPreset,
      controller.signal,
      {
        promptCacheKey: buildPromptCacheTestKey(testPreset, testText.itemID),
        pinnedFullText: testText.text,
        sourceLabel: testText.label,
      },
    );
    const saved = mergePresetTestResult(rawPreset, result.preset, "ok");
    updatePresetInStorage(saved);
    const flags = card.querySelector<HTMLElement>(".preset-flags-control");
    if (flags) refreshPresetFlags(flags, saved);
    refreshPresetPickerItem(doc, saved);
    setStatus(doc, "zai-cache-test-status", result.message);
  } catch (err) {
    setStatus(
      doc,
      "zai-cache-test-status",
      sanitizedTestError(err, [testPreset]),
      true,
    );
  } finally {
    clearTimeout(timeout);
    run.textContent = uiText("开始测试", "Start test");
    refreshCacheTestTarget(doc);
    updatePresetDirtyState(doc);
  }
}

function readPresetFromCard(card: HTMLElement): ModelPreset {
  const doc = card.ownerDocument;
  if (!doc) throw new Error("card has no ownerDocument");
  return (
    readPresetControls(doc).find((p) => p.id === card.dataset.id) ??
    readPresetControls(doc)[0]
  );
}

function updatePresetInStorage(preset: ModelPreset): void {
  const all = loadPresets(zoteroPrefs());
  const next = all.map((p) => (p.id === preset.id ? preset : p));
  savePresets(zoteroPrefs(), next);
  refreshSidebarPreferences();
}

type PresetFlagBadge = {
  text: string;
  title: string;
  tone: "ok" | "warn" | "muted";
};

function presetFlagsControl(doc: Document, preset: ModelPreset): HTMLElement {
  const wrap = el(doc, "div", "preset-flags-control");
  wrap.append(el(doc, "div", "preset-flags"), el(doc, "div", "preset-help"));
  refreshPresetFlags(wrap, preset);
  return wrap;
}

function refreshPresetFlags(control: HTMLElement, preset: ModelPreset): void {
  const flags = control.querySelector(".preset-flags");
  const hint = control.querySelector(".preset-help");
  const doc = control.ownerDocument;
  if (flags && doc) {
    flags.replaceChildren(
      ...presetFlagBadges(preset).map((flag) => presetFlagBadge(doc, flag)),
    );
  }
  if (hint) hint.textContent = presetFlagHint(preset);
}

function presetFlagBadges(preset: ModelPreset): PresetFlagBadge[] {
  if (preset.provider !== "openai") {
    return [
      {
        text: "Anthropic",
        title: uiText("当前不是 OpenAI 兼容预设", "This is not an OpenAI-compatible account"),
        tone: "muted",
      },
    ];
  }
  const official = isOfficialOpenAIEndpointForPreset(preset);
  const relayCache = shouldSendRelayPromptCacheForPreset(preset);
  const sendsReasoning =
    official || preset.extras?.omitResponsesReasoningForCache !== true;
  return [
    official
      ? {
          text: uiText("官方 OpenAI", "Official OpenAI"),
          title: uiText("api.openai.com：使用官方 prompt_cache_key 机制", "api.openai.com: uses the official prompt_cache_key mechanism"),
          tone: "ok",
        }
      : {
          text: uiText("第三方/Relay", "Third-party/relay"),
          title:
            uiText("非 api.openai.com endpoint：按 OpenAI-compatible 第三方/自建 relay 处理", "Non-api.openai.com endpoint: treated as a third-party or self-hosted OpenAI-compatible relay"),
          tone: "warn",
        },
    official
      ? {
          text: supportsExtendedPromptCacheForPreset(preset.model)
            ? "cache_key + 24h"
            : "cache_key",
          title:
            uiText("官方 endpoint 自动发送 prompt_cache_key；支持模型会加 24h retention", "Official endpoints send prompt_cache_key automatically; supported models also get 24-hour retention"),
          tone: "ok",
        }
      : relayCache
        ? {
            text: uiText("relay cache 自动", "Relay cache: automatic"),
            title:
              uiText("默认发送 prompt_cache_key + session_id；缓存测试不兼容时会自动关闭", "Sends prompt_cache_key + session_id by default; disabled automatically if the cache test is incompatible"),
            tone: "ok",
          }
        : {
            text: uiText("relay cache 已关闭", "Relay cache: off"),
            title: uiText("缓存测试已标记该预设不发送 prompt_cache_key/session_id", "The cache test marked this account to omit prompt_cache_key/session_id"),
            tone: "muted",
          },
    sendsReasoning
      ? {
          text: uiText("reasoning 透传", "Reasoning: sent"),
          title: uiText("会发送当前选择的 reasoning effort/summary", "Sends the selected reasoning effort/summary"),
          tone: "ok",
        }
      : {
          text: uiText("reasoning 省略", "Reasoning: omitted"),
          title: uiText("缓存优先已开启：非官方 endpoint 会省略 reasoning 字段", "Cache priority is on: reasoning fields are omitted for non-official endpoints"),
          tone: "warn",
        },
  ];
}

function presetFlagBadge(doc: Document, flag: PresetFlagBadge): HTMLElement {
  const badge = el(
    doc,
    "span",
    `preset-flag preset-flag-${flag.tone}`,
    flag.text,
  );
  badge.title = flag.title;
  return badge;
}

function presetFlagHint(preset: ModelPreset): string {
  if (preset.provider !== "openai")
    return uiText("非 OpenAI 兼容预设，不发送 OpenAI prompt cache 参数。", "This is not an OpenAI-compatible account; OpenAI prompt-cache parameters are not sent.");
  if (isOfficialOpenAIEndpointForPreset(preset)) {
    return uiText("官方 endpoint：自动发送官方 prompt_cache_key。", "Official endpoint: sends the official prompt_cache_key automatically.");
  }
  if (shouldSendRelayPromptCacheForPreset(preset)) {
    return uiText("第三方/Relay endpoint：默认发送 prompt_cache_key + session_id；缓存测试报错且关闭后可连接时会自动关闭。", "Third-party/relay endpoint: sends prompt_cache_key + session_id by default; turns them off if the cache test fails but the request succeeds without them.");
  }
  return uiText("第三方/Relay endpoint：relay cache 已禁用；可在下方重新运行缓存测试。", "Third-party/relay endpoint: relay cache is disabled. You can rerun the cache test below.");
}

function shouldSendRelayPromptCacheForPreset(preset: ModelPreset): boolean {
  return (
    preset.provider === "openai" &&
    !isOfficialOpenAIEndpointForPreset(preset) &&
    preset.extras?.enableRelayPromptCache !== false
  );
}

function buildPromptCacheTestKey(
  preset: ModelPreset,
  itemID: number | null,
): string {
  // Mirror sidebar.ts buildPromptCacheKey: use the portable Zotero itemKey
  // (e.g. "FQRVCCJN") rather than the local itemID so the test request lands
  // on the same relay sticky-session bucket as the production chat would.
  // Without this, the test would probe a different backend than chat uses.
  const itemKey = resolveItemKeyForTestCache(itemID);
  const itemPart =
    itemKey != null
      ? `item-${itemKey}`
      : itemID != null
        ? `item-${itemID}`
        : "prefs-cache-test";
  return [
    "zai",
    preset.provider,
    preset.id || "preset",
    preset.model || "model",
    itemPart,
  ].join(":");
}

function resolveItemKeyForTestCache(itemID: number | null): string | null {
  if (itemID == null) return null;
  try {
    const item = (
      globalThis as unknown as {
        Zotero?: { Items?: { get?: (id: number) => { key?: string } | null } };
      }
    ).Zotero?.Items?.get?.(itemID);
    const key = typeof item?.key === "string" ? item.key : "";
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

async function promptCacheTestTextForPreferences(): Promise<{
  text?: string;
  label: string;
  itemID: number | null;
}> {
  const itemID = selectedPreferenceItemID();
  if (itemID != null) {
    try {
      const pdfText = await zoteroContextSource.getFullText(itemID);
      if (pdfText.trim()) {
        return {
          text: truncatePromptCacheTestText(pdfText),
          label: uiText(`当前 PDF / item-${itemID}`, `Current PDF / item-${itemID}`),
          itemID,
        };
      }
    } catch {
      // Fall back to deterministic built-in text when Zotero has no indexed PDF text.
    }
  }
  return { label: uiText("内置长文本", "Built-in long text"), itemID: null };
}

function selectedPreferenceItemID(): number | null {
  const ZoteroLike = Zotero as unknown as {
    getMainWindow?: () => Window | null;
    getMainWindows?: () => Window[];
  };
  const win =
    ZoteroLike.getMainWindow?.() ?? ZoteroLike.getMainWindows?.()[0] ?? null;
  const pane = (
    win as { ZoteroPane?: { getSelectedItems?: () => unknown[] } } | null
  )?.ZoteroPane;
  const item = pane?.getSelectedItems?.()[0] as
    | { id?: number; parentID?: number; isAttachment?: () => boolean }
    | undefined;
  if (!item) return null;
  if (item.isAttachment?.() && typeof item.parentID === "number")
    return item.parentID;
  return typeof item.id === "number" ? item.id : null;
}

function truncatePromptCacheTestText(text: string): string {
  const charBudget = 16_000 * 4;
  return text.length > charBudget ? text.slice(0, charBudget) : text;
}

interface ModelListControl {
  element: HTMLElement;
  models(): string[];
  setModels(models: string[]): void;
  setSuggestionKey(key: ModelSuggestionKey): void;
  onModelsChange(listener: () => void): void;
}

function createModelListControl(
  doc: Document,
  initialModels: string[],
  initialKey: ModelSuggestionKey,
  initialTestModel: string,
  testGroupName: string,
): ModelListControl {
  const wrap = el(doc, "div", "zai-model-control");
  const selected = el(doc, "div", "zai-model-selected");
  const side = el(doc, "div", "zai-model-side");
  const hidden = textarea(doc, "");
  hidden.dataset.field = "models";
  hidden.className = "zai-model-hidden";

  let suggestionKey: ModelSuggestionKey = initialKey;
  let selectedTestModel = initialTestModel.trim();
  let modelsChangeListener: (() => void) | undefined;
  const currentModels = () => {
    const values: string[] = [];
    selected
      .querySelectorAll(".zai-model-chip-input")
      .forEach((node: Element) => {
        const value = (node as HTMLInputElement).value.trim();
        if (value) values.push(value);
      });
    return values;
  };

  const refreshTestSelection = () => {
    selectedTestModel = resolveTestModel(currentModels(), selectedTestModel);
    let matched = false;
    selected.querySelectorAll(".zai-model-chip").forEach((node: Element) => {
      const chip = node as HTMLElement;
      const model = chip.querySelector<HTMLInputElement>(
        ".zai-model-chip-input",
      );
      const radio = chip.querySelector<HTMLInputElement>(
        ".zai-model-test-radio",
      );
      const isSelected = Boolean(
        !matched && model && model.value.trim() === selectedTestModel,
      );
      if (isSelected) matched = true;
      if (radio) {
        radio.checked = isSelected;
        radio.setAttribute(
          "aria-label",
          uiText(
            `选择 ${model?.value.trim() || "此模型"} 作为测试模型`,
            `Select ${model?.value.trim() || "this model"} as the test model`,
          ),
        );
      }
      chip.dataset.testSelected = String(isSelected);
    });
  };

  const sync = () => {
    const models = dedupe(currentModels());
    hidden.value = models.join("\n");
    refreshTestSelection();
    refreshSuggestions();
    updatePresetDirtyState(doc);
    dispatchPreferenceChange(doc, wrap);
    modelsChangeListener?.();
  };

  const addChip = (value: string) => {
    const chip = el(doc, "span", "zai-model-chip");
    const testRadio = input(doc, "", "radio");
    testRadio.className = "zai-model-test-radio";
    testRadio.name = `zai-test-model-${testGroupName}`;
    testRadio.title = uiText("选择为测试模型", "Select as test model");
    const model = input(doc, value);
    model.className = "zai-model-chip-input";
    model.placeholder = uiText("自定义模型 ID", "Custom model ID");
    testRadio.addEventListener("change", () => {
      if (!testRadio.checked) return;
      selectedTestModel = model.value.trim();
      refreshTestSelection();
    });
    model.addEventListener("input", () => {
      if (testRadio.checked) selectedTestModel = model.value.trim();
      sync();
    });
    const remove = button(doc, "×");
    remove.className = "zai-model-chip-remove";
    remove.title = uiText("删除此模型", "Remove this model");
    remove.addEventListener("click", () => {
      if (testRadio.checked) selectedTestModel = "";
      chip.remove();
      sync();
    });
    chip.append(testRadio, model, remove);
    selected.append(chip);
  };

  const setModels = (models: string[]) => {
    selected.replaceChildren();
    for (const model of dedupe(models)) addChip(model);
    sync();
  };

  const addModel = (model: string) => {
    const trimmed = model.trim();
    if (!trimmed || currentModels().includes(trimmed)) return;
    addChip(trimmed);
    sync();
  };

  const refreshSuggestions = () => {
    side.replaceChildren();
    const customRow = el(doc, "div", "zai-model-custom-row");
    const custom = input(doc, "");
    custom.placeholder = uiText("输入自定义模型 ID", "Enter a custom model ID");
    const addCustom = button(doc, uiText("+ 添加", "+ Add"));
    const commitCustom = () => {
      addModel(custom.value);
      custom.value = "";
    };
    addCustom.addEventListener("click", commitCustom);
    custom.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      commitCustom();
    });
    customRow.append(custom, addCustom);

    const list = MODEL_SUGGESTIONS[suggestionKey] ?? [];
    if (list.length > 0) {
      side.append(
        el(doc, "div", "zai-model-side-title", suggestionTitle(suggestionKey)),
      );
      const selectedModels = new Set(currentModels());
      const suggestions = el(doc, "div", "zai-model-suggestions");
      for (const model of list) {
        const pick = button(
          doc,
          selectedModels.has(model) ? `✓ ${model}` : `+ ${model}`,
        );
        pick.disabled = selectedModels.has(model);
        pick.addEventListener("click", () => addModel(model));
        suggestions.append(pick);
      }
      side.append(suggestions);
    } else {
      side.append(el(doc, "div", "zai-model-side-title", uiText("自定义模型", "Custom models")));
    }
    side.append(customRow);
  };

  wrap.append(selected, side, hidden);
  setModels(initialModels);
  return {
    element: wrap,
    models: currentModels,
    setModels,
    setSuggestionKey: (key) => {
      if (suggestionKey === key) return;
      suggestionKey = key;
      refreshSuggestions();
    },
    onModelsChange: (listener) => {
      modelsChangeListener = listener;
    },
  };
}

function suggestionTitle(key: ModelSuggestionKey): string {
  switch (key) {
    case "openai":
      return uiText("OpenAI 预设模型", "OpenAI suggested models");
    case "claude":
      return uiText("Claude 预设模型", "Claude suggested models");
    case "deepseek":
      return uiText("DeepSeek 预设模型", "DeepSeek suggested models");
    case "compat":
      return uiText("自定义模型", "Custom models");
    case "custom":
      return uiText("自定义模型", "Custom models");
  }
}

function readPresetControls(doc: Document): ModelPreset[] {
  const previous = new Map(
    loadPresets(zoteroPrefs()).map((preset) => [preset.id, preset]),
  );
  return Array.from(doc.querySelectorAll(".zai-preset-row")).map((row) => {
    const card = row as HTMLElement;
    const provider =
      controlValue(card, "provider") === "anthropic" ? "anthropic" : "openai";
    const models = splitList(controlValue(card, "models"));
    const fallbackModel = DEFAULT_MODELS[provider];
    const model = models[0] || fallbackModel;
    const prior = previous.get(card.dataset.id ?? "");
    const reasoningSelects = Array.from(
      card.querySelectorAll(".zai-reasoning-controls select[data-model]"),
    ) as HTMLSelectElement[];
    const reasoningEffortByModel = Object.fromEntries(
      reasoningSelects
        .filter(
          (control) =>
            !control.disabled &&
            control.value &&
            control.dataset.explicit === "true",
        )
        .map((control) => [
          control.dataset.model!,
          control.value as ReasoningEffort,
        ]),
    );
    const savedReasoningEffortByModel = mergeReasoningEffortByModel(
      prior?.extras?.reasoningEffortByModel,
      reasoningEffortByModel,
    );
    const extras =
      provider === "openai"
        ? {
            ...(prior?.extras ?? {}),
            reasoningEffort: reasoningEffortValue(
              prior?.extras?.reasoningEffort,
            ),
            ...(savedReasoningEffortByModel
              ? { reasoningEffortByModel: savedReasoningEffortByModel }
              : {}),
            reasoningSummary: reasoningSummaryValue(
              controlValue(card, "reasoningSummary"),
            ),
            modelSuggestionGroup: modelSuggestionGroupValue(
              controlValue(card, "modelSuggestionGroup"),
              prior?.extras?.modelSuggestionGroup,
            ),
          }
        : {
            ...(prior?.extras ?? {}),
            ...(savedReasoningEffortByModel
              ? { reasoningEffortByModel: savedReasoningEffortByModel }
              : {}),
            vendor: vendorValue(
              controlValue(card, "vendor"),
              prior?.extras?.vendor,
            ),
          };
    return {
      id: card.dataset.id || makeId("preset"),
      provider,
      label:
        controlValue(card, "label") ||
        (provider === "anthropic" ? "Claude" : "GPT"),
      apiKey: controlValue(card, "apiKey"),
      baseUrl: controlValue(card, "baseUrl") || DEFAULT_BASE_URLS[provider],
      model,
      models: models.length ? models : model ? [model] : [],
      maxTokens: Number(controlValue(card, "maxTokens")) || 32768,
      extras,
    };
  });
}

function vendorValue(
  raw: string,
  fallback: AnthropicVendor | undefined,
): AnthropicVendor {
  if (raw === "claude" || raw === "deepseek" || raw === "compat") return raw;
  return fallback ?? "compat";
}

function modelSuggestionGroupValue(
  raw: string,
  fallback: ModelSuggestionGroup | undefined,
): ModelSuggestionGroup {
  if (
    raw === "auto" ||
    raw === "openai" ||
    raw === "deepseek" ||
    raw === "claude" ||
    raw === "custom"
  ) {
    return raw;
  }
  return fallback ?? "auto";
}

async function savePresetControlsWithConnectivity(
  doc: Document,
): Promise<boolean> {
  const rawPresets = readPresetControls(doc).filter(
    (preset) =>
      preset.apiKey || preset.baseUrl || preset.model || preset.models?.length,
  );
  for (const preset of rawPresets) {
    if (!preset.apiKey.trim()) {
      setStatus(
        doc,
        "zai-preset-status",
        uiText(`${preset.label} API Key 为空，未保存。`, `${preset.label} API key is empty; changes were not saved.`),
        true,
      );
      return false;
    }
    if (!preset.model.trim()) {
      setStatus(
        doc,
        "zai-preset-status",
        uiText(`${preset.label} Model 为空，未保存。`, `${preset.label} model is empty; changes were not saved.`),
        true,
      );
      return false;
    }
  }
  try {
    const savedByID = new Map(
      loadPresets(zoteroPrefs()).map((preset) => [preset.id, preset]),
    );
    const detectedPresets: ModelPreset[] = [];
    for (const preset of rawPresets) {
      const saved = savedByID.get(preset.id);
      const connectionChanged =
        !saved ||
        presetConnectivitySignature(saved) !==
          presetConnectivitySignature(preset);
      if (preset.provider === "openai" && connectionChanged) {
        setStatus(
          doc,
          "zai-preset-status",
          uiText(`正在检测 ${preset.label} 的模型协议…`, `Detecting the model protocol for ${preset.label}…`),
        );
        const detected = await detectOpenAIModelTransports(preset);
        detectedPresets.push({
          ...detected,
          extras: { ...detected.extras, testStatus: "ok" },
        });
      } else {
        detectedPresets.push(preset);
      }
    }
    savePresets(zoteroPrefs(), detectedPresets);
    renderPresetRows(doc, loadPresets(zoteroPrefs()));
    renderTranslateSettings(doc);
    refreshSidebarPreferences();
    setStatus(doc, "zai-preset-status", uiText("账号配置已保存，侧边栏已刷新。", "Account settings saved; sidebar refreshed."));
    return true;
  } catch (err) {
    setStatus(
      doc,
      "zai-preset-status",
      sanitizedTestError(err, rawPresets),
      true,
    );
    return false;
  }
}

function attachPresetDirtyListeners(doc: Document): void {
  const controls = Array.from(
    doc.querySelectorAll(
      ".zai-preset-row input:not(.zai-model-test-radio), .zai-preset-row textarea, .zai-preset-row select",
    ),
  ) as Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;
  for (const control of controls) {
    control.addEventListener("input", () => updatePresetDirtyState(doc));
    control.addEventListener("change", () => updatePresetDirtyState(doc));
  }
}

function updatePresetDirtyState(doc: Document): void {
  refreshPreferenceDirtySection(doc, "presets");
}

function presetConnectivitySignature(preset: ModelPreset): string {
  return JSON.stringify({
    provider: preset.provider,
    apiKey: preset.apiKey,
    baseUrl: preset.baseUrl,
    model: preset.model,
    models: preset.models ?? [preset.model],
    maxTokens: preset.maxTokens,
    reasoningEffort: preset.extras?.reasoningEffort,
    reasoningEffortByModel: preset.extras?.reasoningEffortByModel,
    reasoningSummary: preset.extras?.reasoningSummary,
    omitMaxOutputTokens: preset.extras?.omitMaxOutputTokens,
  });
}

async function testPresetConnectivity(
  preset: ModelPreset,
): Promise<{ message: string; preset: ModelPreset }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    return await testPresetConnectivityWithSignal(preset, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

async function detectOpenAIModelTransports(
  preset: ModelPreset,
): Promise<ModelPreset> {
  const modelCount = Math.max(1, preset.models?.length ?? 1);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000 * modelCount);
  try {
    return await detectOpenAIModelTransportsWithSignal(
      preset,
      controller.signal,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizedTestError(err: unknown, presets: ModelPreset[]): string {
  let message = err instanceof Error ? err.message : String(err);
  for (const preset of presets) {
    if (preset.apiKey) message = message.split(preset.apiKey).join("[API_KEY]");
  }
  if (message.toLowerCase().includes("abort"))
    return uiText("连接超时或已取消，未保存。", "Connection timed out or was cancelled; changes were not saved.");
  return `${uiText("连接失败", "Connection failed")}: ${message}. ${uiText("未保存。", "Changes were not saved.")}`;
}

function renderPromptSettings(doc: Document): void {
  const settings = loadQuickPromptSettings(zoteroPrefs());
  populateBuiltInPromptControls(doc, settings);
  const custom = byID<HTMLElement>(doc, "zai-custom-prompts");
  custom?.replaceChildren();
  for (const buttonConfig of settings.customButtons)
    addCustomPromptRow(doc, buttonConfig);
  setStatus(doc, "zai-prompt-status", uiText("已加载提示词配置。", "Prompt settings loaded."));
}

function populateBuiltInPromptControls(
  doc: Document,
  settings: QuickPromptSettings,
): void {
  const wrap = byID<HTMLElement>(doc, "zai-built-in-prompts");
  if (!wrap) return;
  wrap.replaceChildren(
    builtInPromptControl(
      doc,
      "summary",
      uiText("总结论文", "Summarize paper"),
      settings.builtIns.summary,
      DEFAULT_QUICK_PROMPT_SETTINGS.builtIns.summary,
    ),
    builtInPromptControl(
      doc,
      "readingRoute",
      uiText("阅读路线", "Reading route"),
      settings.builtIns.readingRoute,
      DEFAULT_QUICK_PROMPT_SETTINGS.builtIns.readingRoute,
    ),
    builtInPromptControl(
      doc,
      "fullTextHighlight",
      uiText("全文重点", "Key points"),
      settings.builtIns.fullTextHighlight,
      DEFAULT_QUICK_PROMPT_SETTINGS.builtIns.fullTextHighlight,
    ),
    builtInPromptControl(
      doc,
      "explainSelection",
      uiText("解释选区", "Explain selection"),
      settings.builtIns.explainSelection,
      DEFAULT_QUICK_PROMPT_SETTINGS.builtIns.explainSelection,
    ),
    selectionQuestionAnnotationControl(
      doc,
      settings.selectionQuestionAnnotationEnabled,
    ),
  );
}

function selectionQuestionAnnotationControl(
  doc: Document,
  enabled: boolean,
): HTMLElement {
  const wrap = el(doc, "div", "zai-prompt-option");
  const checkbox = doc.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = "zai-selection-question-annotation-enabled";
  checkbox.checked = enabled;
  checkbox.addEventListener("change", () => {
    const settings = loadQuickPromptSettings(zoteroPrefs());
    saveQuickPromptSettings(zoteroPrefs(), {
      ...settings,
      selectionQuestionAnnotationEnabled: checkbox.checked,
    });
    refreshSidebarPreferences();
    setStatus(
      doc,
      "zai-prompt-status",
      checkbox.checked
        ? uiText("普通选区提问后会自动生成建议注释，已直接保存。", "Suggestions will be generated after selection questions; this setting was saved.")
        : uiText("普通选区提问后不再自动生成建议注释，已直接保存。", "Suggestions will no longer be generated after selection questions; this setting was saved."),
    );
  });
  const head = el(doc, "div", "zai-prompt-option-head");
  head.append(labelWrap(doc, checkbox, uiText("普通选区提问后生成建议注释", "Generate suggested annotations after selection questions")));
  wrap.append(
    head,
    el(
      doc,
      "div",
      "zai-pref-help",
      uiText("默认开启：选中文本后在对话框手动提问，AI 回完会附带「建议注释」卡片，下方可一键保存为「💾 高亮+评论」或「🅣 新增文字」(T 工具)。解释选区按钮始终会生成建议注释。开启时会参考 PDF 注释颜色预设推荐颜色。", "On by default: after you select text and ask a question in the chat, the AI adds a Suggested Annotation card. Save it as “💾 Highlight + Comment” or “🅣 Add Text” (T tool). Explain Selection always creates a suggested annotation. When enabled, recommended colors follow the PDF annotation color presets."),
    ),
  );
  return wrap;
}

function builtInPromptControl(
  doc: Document,
  field: string,
  label: string,
  value: string,
  defaultValue: string,
): HTMLElement {
  const wrap = el(doc, "div", "zai-built-in-prompt");
  const head = el(doc, "div", "zai-prompt-head");
  const title = el(doc, "span", "zai-prompt-title");
  const state = el(doc, "span", "zai-prompt-default-state");
  title.append(el(doc, "span", "", label), state);
  head.append(title);
  const reset = button(doc, uiText("恢复内置默认", "Restore built-in default"));
  reset.title = uiText(
    "把当前编辑框恢复为这个插件版本内置的默认提示词；保存更改后生效。",
    "Restore this editor to the built-in prompt for this plugin version. Save changes to apply it.",
  );
  const area = textarea(doc, value);
  area.dataset.prompt = field;
  area.dataset.savedValue = value;
  const updateState = () => {
    updatePromptDefaultState(area, state, defaultValue);
  };
  reset.addEventListener("click", () => {
    area.value = defaultValue;
    updateState();
    refreshPreferenceDirtySection(doc, "prompts");
    setStatus(
      doc,
      "zai-prompt-status",
      uiText("已填入当前插件内置默认提示词；保存更改后生效。", "Built-in default prompt restored; save changes to apply it."),
    );
  });
  area.addEventListener("input", updateState);
  updateState();
  head.append(reset);
  wrap.append(head, area);
  return wrap;
}

function updatePromptDefaultState(
  area: HTMLTextAreaElement,
  state: HTMLElement,
  defaultValue: string,
): void {
  const savedValue = area.dataset.savedValue ?? "";
  const current = area.value;
  const nextState =
    current !== savedValue
      ? "dirty"
      : current === defaultValue
        ? "default"
        : "custom";
  const label =
    nextState === "dirty"
      ? uiText("编辑未保存", "Unsaved edits")
      : nextState === "default"
        ? uiText("本地=内置默认", "Local = built-in default")
        : uiText("本地已自定义", "Locally customized");
  const title =
    nextState === "dirty"
      ? uiText("当前编辑框内容还没有保存；通过顶部保存栏提交后生效。", "These edits are not saved. Use the save bar above to apply them.")
      : nextState === "default"
        ? uiText("已保存的本地提示词与当前插件内置默认一致。", "The saved local prompt matches this plugin's built-in default.")
        : uiText("已保存的本地提示词不同于当前插件内置默认；点击“恢复内置默认”可改回。", "The saved local prompt differs from this plugin's built-in default. Select “Restore built-in default” to reset it.");
  state.textContent = label;
  state.dataset.state = nextState;
  state.title = title;
}

function addCustomPromptRow(
  doc: Document,
  config: { id: string; label: string; prompt: string; shortcut?: string },
): void {
  const list = byID<HTMLElement>(doc, "zai-custom-prompts");
  if (!list) return;
  const card = el(doc, "div", "zai-subcard zai-custom-prompt-row");
  card.dataset.id = config.id;
  const title = el(doc, "div", "zai-subcard-title");
  title.append(el(doc, "span", "", uiText("自定义提示", "Custom prompt")));
  const remove = button(doc, uiText("删除", "Delete"));
  remove.addEventListener("click", () => {
    card.remove();
    refreshPreferenceDirtySection(doc, "prompts");
  });
  title.append(remove);
  const label = input(doc, config.label);
  label.dataset.field = "label";
  label.placeholder = uiText("留空则只作为快捷键", "Leave blank to use only as a shortcut");
  const shortcut = input(doc, config.shortcut ?? "");
  shortcut.dataset.field = "shortcut";
  shortcut.maxLength = 1;
  shortcut.placeholder = uiText("例如：t", "For example: t");
  shortcut.title = uiText("焦点在 PDF Reader 时按这个单键触发；支持 a-z / 0-9。", "Press this single key while the PDF Reader is focused; a-z and 0-9 are supported.");
  const prompt = textarea(doc, config.prompt);
  prompt.dataset.field = "prompt";
  card.append(
    title,
    compactPromptFields(doc, label, shortcut),
    compactPromptField(doc, uiText("提示词", "Prompts"), prompt, true),
  );
  list.append(card);
}

function compactPromptFields(
  doc: Document,
  label: HTMLElement,
  shortcut: HTMLElement,
): HTMLElement {
  const wrap = el(doc, "div", "zai-custom-prompt-fields");
  wrap.append(
    compactPromptField(doc, uiText("按钮名称（可空）", "Button label (optional)"), label),
    compactPromptField(doc, uiText("PDF 快捷键", "PDF shortcut"), shortcut),
  );
  return wrap;
}

function compactPromptField(
  doc: Document,
  label: string,
  control: HTMLElement,
  full = false,
): HTMLElement {
  const wrap = el(doc, "div", "zai-custom-prompt-field");
  if (full) wrap.classList.add("zai-custom-prompt-full");
  wrap.append(el(doc, "label", "", label), control);
  return wrap;
}

function savePromptControls(doc: Document): boolean {
  const result = readPromptControls(doc);
  if (typeof result === "string") {
    setStatus(doc, "zai-prompt-status", result, true);
    return false;
  }
  saveQuickPromptSettings(zoteroPrefs(), result);
  renderPromptSettings(doc);
  refreshSidebarPreferences();
  setStatus(
    doc,
    "zai-prompt-status",
    uiText(`提示词已保存，侧边栏按钮立即刷新。当前自定义按钮：${customPromptLabels(result)}`, `Prompts saved; sidebar buttons updated. Custom buttons: ${customPromptLabels(result)}`),
  );
  return true;
}

function readPromptControls(doc: Document): QuickPromptSettings | string {
  const summary = promptText(doc, "summary");
  const readingRoute = promptText(doc, "readingRoute");
  const fullTextHighlight = promptText(doc, "fullTextHighlight");
  const explainSelection = promptText(doc, "explainSelection");
  if (!summary || !readingRoute || !fullTextHighlight || !explainSelection) {
    return uiText("内置快捷按钮的提示词不能为空。", "Built-in shortcut prompts cannot be empty.");
  }
  const selectionQuestionAnnotationEnabled =
    byID<HTMLInputElement>(doc, "zai-selection-question-annotation-enabled")
      ?.checked === true;
  const customButtons = [];
  for (const node of Array.from(
    doc.querySelectorAll(".zai-custom-prompt-row"),
  )) {
    const row = node as HTMLElement;
    const label = controlValue(row, "label");
    const shortcut = controlValue(row, "shortcut");
    const prompt = controlValue(row, "prompt");
    if (!label && !shortcut && !prompt) continue;
    if (!prompt) return uiText("自定义提示必须填写提示词。", "Enter a prompt for each custom prompt.");
    if (!label && !shortcut) return uiText("自定义提示至少填写按钮名称或 PDF 快捷键。", "Each custom prompt needs a button label or PDF shortcut.");
    customButtons.push({
      id: row.dataset.id || makeId("prompt"),
      label,
      prompt,
      shortcut,
    });
  }
  return {
    builtIns: {
      summary,
      readingRoute,
      fullTextHighlight,
      explainSelection,
    },
    customButtons,
    selectionQuestionAnnotationEnabled,
  };
}

function customPromptLabels(settings: QuickPromptSettings): string {
  return settings.customButtons.length
    ? settings.customButtons
        .map(
            (button) =>
            button.label || `${uiText("快捷键", "Shortcut")} ${button.shortcut?.toUpperCase()}`,
        )
        .join("、")
    : uiText("无", "None");
}

function renderToolSettings(doc: Document): void {
  const settings = loadToolSettings(zoteroPrefs());
  const webSearch = byID<HTMLSelectElement>(doc, "zai-tool-web-search");
  if (webSearch) webSearch.value = settings.webSearchMode;
  const colorGuide = byID<HTMLTextAreaElement>(
    doc,
    "zai-tool-annotation-color-guide",
  );
  if (colorGuide) {
    colorGuide.value = settings.annotationColorGuide;
    colorGuide.scrollTop = 0;
  }
  const fontSize = byID<HTMLInputElement>(
    doc,
    "zai-tool-text-annotation-font-size",
  );
  if (fontSize) fontSize.value = String(settings.textAnnotationFontSize);
  const list = byID<HTMLElement>(doc, "zai-mcp-list");
  list?.replaceChildren();
  for (const server of settings.mcpServers ?? []) addMcpRow(doc, server);
  setStatus(doc, "zai-tool-status", uiText("已加载联网/MCP配置。", "Web/MCP settings loaded."));
}

function addMcpRow(doc: Document, server: McpServerSettings): void {
  const list = byID<HTMLElement>(doc, "zai-mcp-list");
  if (!list) return;
  const card = el(doc, "div", "zai-subcard zai-mcp-row");
  card.dataset.id = server.id;
  const title = el(doc, "div", "zai-subcard-title");
  const enabled = doc.createElement("input");
  enabled.type = "checkbox";
  enabled.checked = server.enabled;
  enabled.dataset.field = "enabled";
  title.append(
    el(doc, "span", "", "MCP Server"),
    labelWrap(doc, enabled, uiText("启用", "Enabled")),
  );
  const remove = button(doc, uiText("删除", "Delete"));
  remove.addEventListener("click", () => {
    card.remove();
    refreshPreferenceDirtySection(doc, "mcp");
  });
  title.append(remove);
  const serverLabel = input(doc, server.serverLabel);
  serverLabel.dataset.field = "serverLabel";
  const serverUrl = input(doc, server.serverUrl);
  serverUrl.dataset.field = "serverUrl";
  const allowedTools = input(doc, server.allowedTools.join(", "));
  allowedTools.dataset.field = "allowedTools";
  allowedTools.placeholder = uiText("留空表示不限制工具；或填写 search, read_pdf", "Leave blank to allow all tools, or enter search, read_pdf");
  const approval = select(
    doc,
    [
      ["never", uiText("Never - 不需要审批", "Never - No approval required")],
      ["always", uiText("Always - 请求审批", "Always - Request approval")],
    ],
    server.requireApproval,
  );
  approval.dataset.field = "requireApproval";
  card.append(
    title,
    grid(doc, [
      ["Label", serverLabel],
      ["Server URL", serverUrl],
      ["Allowed tools", allowedTools],
      ["Approval", approval],
    ]),
  );
  list.append(card);
}

function readToolSettingsControls(doc: Document): ToolSettings {
  const existing = loadToolSettings(zoteroPrefs());
  const webSearch = byID<HTMLSelectElement>(doc, "zai-tool-web-search");
  const mcpServers: McpServerSettings[] = [];
  for (const node of Array.from(doc.querySelectorAll(".zai-mcp-row"))) {
    const row = node as HTMLElement;
    const serverLabel = controlValue(row, "serverLabel") || "mcp";
    const serverUrl = controlValue(row, "serverUrl");
    const enabled = checkboxValue(row, "enabled");
    if (!serverLabel && !serverUrl) continue;
    mcpServers.push({
      id: row.dataset.id || makeId("mcp"),
      enabled,
      serverLabel,
      serverUrl,
      allowedTools: splitList(controlValue(row, "allowedTools")),
      requireApproval: approvalValue(controlValue(row, "requireApproval")),
    });
  }
  return {
    ...existing,
    webSearchMode: webSearchModeValue(webSearch?.value ?? "disabled"),
    annotationColorGuide:
      byID<HTMLTextAreaElement>(doc, "zai-tool-annotation-color-guide")
        ?.value ?? existing.annotationColorGuide,
    textAnnotationFontSize: Number(
      byID<HTMLInputElement>(doc, "zai-tool-text-annotation-font-size")
        ?.value ?? existing.textAnnotationFontSize,
    ),
    mcpServers,
  };
}

function saveWebSearchControl(doc: Document): void {
  const existing = loadToolSettings(zoteroPrefs());
  const webSearch = byID<HTMLSelectElement>(doc, "zai-tool-web-search");
  saveToolSettings(zoteroPrefs(), {
    ...existing,
    webSearchMode: webSearchModeValue(webSearch?.value ?? "disabled"),
  });
  refreshSidebarPreferences();
  setStatus(doc, "zai-tool-status", uiText("Web search 模式已自动保存。", "Web search mode saved automatically."));
}

function saveAnnotationColorGuideControl(
  doc: Document,
  message = uiText("PDF 注释颜色预设已自动保存，下一次请求立即使用。", "PDF annotation color presets saved automatically; they apply to the next request."),
): void {
  const existing = loadToolSettings(zoteroPrefs());
  const value =
    byID<HTMLTextAreaElement>(doc, "zai-tool-annotation-color-guide")?.value ??
    existing.annotationColorGuide;
  saveToolSettings(zoteroPrefs(), {
    ...existing,
    annotationColorGuide: value,
  });
  const saved = loadToolSettings(zoteroPrefs());
  const control = byID<HTMLTextAreaElement>(
    doc,
    "zai-tool-annotation-color-guide",
  );
  if (control) control.value = saved.annotationColorGuide;
  refreshSidebarPreferences();
  setStatus(doc, "zai-color-status", message);
}

function saveTextAnnotationFontSizeControl(doc: Document): void {
  const existing = loadToolSettings(zoteroPrefs());
  const value = Number(
    byID<HTMLInputElement>(doc, "zai-tool-text-annotation-font-size")?.value ??
      existing.textAnnotationFontSize,
  );
  saveToolSettings(zoteroPrefs(), {
    ...existing,
    textAnnotationFontSize: value,
  });
  const saved = loadToolSettings(zoteroPrefs());
  const control = byID<HTMLInputElement>(
    doc,
    "zai-tool-text-annotation-font-size",
  );
  if (control) control.value = String(saved.textAnnotationFontSize);
  refreshSidebarPreferences();
  setStatus(
    doc,
    "zai-text-annotation-font-status",
    uiText(`已自动保存为 ${saved.textAnnotationFontSize}。`, `Saved automatically as ${saved.textAnnotationFontSize}.`),
  );
}

function saveMcpControls(doc: Document): void {
  const existing = loadToolSettings(zoteroPrefs());
  saveToolSettings(zoteroPrefs(), {
    ...existing,
    mcpServers: readToolSettingsControls(doc).mcpServers,
  });
  renderToolSettings(doc);
  refreshSidebarPreferences();
  setStatus(
    doc,
    "zai-tool-status",
    uiText("MCP Server 配置已保存，下一次请求立即使用。", "MCP server settings saved; they apply to the next request."),
  );
}

function promptText(doc: Document, key: string): string {
  const area = doc.querySelector(
    `textarea[data-prompt="${key}"]`,
  ) as HTMLTextAreaElement | null;
  return area?.value.trim() ?? "";
}

function controlValue(root: ParentNode, field: string): string {
  const control = root.querySelector(`[data-field="${field}"]`) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement
    | null;
  return control?.value.trim() ?? "";
}

// Toggle a labeled grid row by hiding both the control and its preceding
// <label>. The grid pairs label+control as siblings, so the row is
// `previousElementSibling` (the label) plus the control itself.
function setRowVisible(control: HTMLElement, visible: boolean): void {
  control.style.display = visible ? "" : "none";
  const label = control.previousElementSibling as HTMLElement | null;
  if (label && label.tagName.toLowerCase() === "label") {
    label.style.display = visible ? "" : "none";
  }
}

function checkboxValue(root: ParentNode, field: string): boolean {
  const control = root.querySelector(
    `[data-field="${field}"]`,
  ) as HTMLInputElement | null;
  return !!control?.checked;
}

function webSearchModeValue(value: string): WebSearchMode {
  return value === "cached" || value === "live" ? value : "disabled";
}

function approvalValue(value: string): McpApprovalMode {
  return value === "always" ? "always" : "never";
}

function reasoningEffortValue(value: unknown): ReasoningEffort {
  return typeof value === "string" &&
    ["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value)
    ? (value as ReasoningEffort)
    : DEFAULT_REASONING_EFFORT;
}

function reasoningSummaryLabelEnglish(value: ReasoningSummary): string {
  switch (value) {
    case "concise":
      return "Concise - Brief reasoning summary";
    case "detailed":
      return "Detailed - More detailed reasoning summary";
    case "auto":
      return "Auto - Let the model decide";
    case "none":
      return "None - Do not display reasoning";
  }
}

function reasoningSummaryValue(value: string): ReasoningSummary {
  return ["auto", "concise", "detailed", "none"].includes(value)
    ? (value as ReasoningSummary)
    : DEFAULT_REASONING_SUMMARY;
}

function splitList(value: string): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const raw of value.split(/[\n,]/)) {
    const entry = raw.trim();
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    list.push(entry);
  }
  return list;
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function makePreset(provider: ProviderKind): ModelPreset {
  const model = DEFAULT_MODELS[provider];
  return {
    id: makeId("preset"),
    provider,
    label: provider === "anthropic" ? "Claude" : "GPT",
    apiKey: "",
    baseUrl: DEFAULT_BASE_URLS[provider],
    model,
    models: model ? [model] : [],
    maxTokens: 32768,
    extras:
      provider === "openai"
        ? {
            reasoningEffort: DEFAULT_REASONING_EFFORT,
            reasoningSummary: DEFAULT_REASONING_SUMMARY,
            agentPermissionMode: "default",
          }
        : { agentPermissionMode: "default" },
  };
}

function grid(
  doc: Document,
  rows: Array<[string | HTMLElement, HTMLElement]>,
): HTMLElement {
  const wrap = el(doc, "div", "zai-pref-grid");
  for (const [labelSpec, control] of rows) {
    const labelEl =
      typeof labelSpec === "string"
        ? el(doc, "label", "", labelSpec)
        : labelSpec;
    wrap.append(labelEl, control);
  }
  return wrap;
}

function labelWrap(
  doc: Document,
  control: HTMLElement,
  text: string,
): HTMLElement {
  const label = el(doc, "label", "zai-inline");
  label.append(control, doc.createTextNode(text));
  return label;
}

function input(doc: Document, value: string, type = "text"): HTMLInputElement {
  const node = doc.createElement("input");
  node.type = type;
  node.value = value;
  return node;
}

function textarea(doc: Document, value: string): HTMLTextAreaElement {
  const node = doc.createElement("textarea");
  node.value = value;
  return node;
}

function select<T extends string>(
  doc: Document,
  options: Array<[T, string]>,
  value: string,
): HTMLSelectElement {
  const node = doc.createElement("select");
  for (const [optionValue, label] of options) {
    const option = doc.createElement("option");
    option.value = optionValue;
    option.textContent = label;
    node.append(option);
  }
  node.value = value;
  return node;
}

function option(
  doc: Document,
  value: string,
  label: string,
): HTMLOptionElement {
  const node = doc.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function button(doc: Document, text: string): HTMLButtonElement {
  const node = doc.createElement("button");
  node.type = "button";
  node.textContent = text;
  return node;
}

function el(
  doc: Document,
  tag: string,
  className = "",
  text?: string,
): HTMLElement {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setStatus(
  doc: Document,
  id: string,
  message: string,
  danger = false,
): void {
  const status = byID<HTMLElement>(doc, id);
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("zai-danger", danger);
}

function flashButton(button: HTMLButtonElement | null, text: string): void {
  if (!button) return;
  const original = button.textContent ?? "";
  button.textContent = text;
  button.ownerDocument?.defaultView?.setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function byID<T extends HTMLElement>(doc: Document, id: string): T | null {
  return doc.getElementById(id) as T | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(
  value: Record<string, unknown>,
  key: string,
): value is Record<string, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function onShortcuts(_type: string) {}

function onDialogEvents(_type: string) {}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
  onShortcuts,
  onDialogEvents,
};
