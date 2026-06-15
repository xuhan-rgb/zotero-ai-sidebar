import { initLocale } from './utils/locale';
import { createZToolkit } from './utils/ztoolkit';
import { zoteroContextSource } from './context/zotero-source';
import {
  refreshSidebarPreferences,
  registerSidebar,
  registerSidebarForWindow,
  unregisterSidebar,
  unregisterSidebarForWindow,
} from './modules/sidebar';
import { testPresetPromptCache as runPresetPromptCacheTest } from './modules/preset-utils';
import {
  registerPreferences,
  unregisterPreferences,
} from './modules/preferences';
import {
  getImmersiveClickMode,
  setImmersiveClickMode,
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
  getImmersiveQuickTranslateKey,
  setImmersiveQuickTranslateKey,
  DEFAULT_IMMERSIVE_QUICK_KEY,
  getImmersiveFocusAskKey,
  setImmersiveFocusAskKey,
  DEFAULT_IMMERSIVE_FOCUS_ASK_KEY,
  getImmersiveToggleControlsKey,
  setImmersiveToggleControlsKey,
  DEFAULT_IMMERSIVE_TOGGLE_KEY,
} from './translate/ask-mode';
import { getProvider } from './providers/factory';
import type { Message } from './providers/types';
import {
  DEFAULT_QUICK_PROMPT_SETTINGS,
  loadQuickPromptSettings,
  normalizeQuickPromptSettings,
  saveQuickPromptSettings,
  type QuickPromptSettings,
} from './settings/quick-prompts';
import {
  detectAnthropicVendor,
  loadPresets,
  normalizePresetList,
  savePresets,
  zoteroPrefs,
} from './settings/storage';
import {
  DEFAULT_TOOL_SETTINGS,
  loadToolSettings,
  normalizeToolSettings,
  saveToolSettings,
  type McpApprovalMode,
  type McpServerSettings,
  type ToolSettings,
  type WebSearchMode,
} from './settings/tool-settings';
import {
  DEFAULT_BASE_URLS,
  DEFAULT_MODELS,
  MODEL_SUGGESTIONS,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_REASONING_SUMMARY,
  REASONING_SUMMARY_OPTIONS,
  type AnthropicVendor,
  type ModelPreset,
  type ProviderKind,
  type ReasoningEffort,
  type ReasoningSummary,
  type TranslateContextLevel,
  type TranslateOverlayPosition,
  type TranslateOverlaySize,
  type TranslateSettings,
  type TranslateThinking,
  type TranslateTriggerMode,
} from './settings/types';
import {
  loadUiSettings,
  normalizeUiSettings,
  saveUiSettings,
  type UiSettings,
} from './settings/ui-settings';
import { pullFromCloud, pushToCloud, testSyncConnection } from './sync';
import {
  loadSyncAccount,
  saveSyncAccount,
  type SyncAccount,
} from './sync/account';
import {
  loadTranslateSettings,
  normalizeTranslateSettings,
  saveTranslateSettings,
} from './translate/settings';

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

  // Per-window setup BEFORE the global `registerSidebar` so each window
  // has its FTL locale strings and ztoolkit ready by the time the column
  // renders. `registerSidebar` then iterates getMainWindows() again to
  // mount the column DOM in each — it's idempotent (see registerSidebarForWindow).
  await Promise.all(Zotero.getMainWindows().map((win) => onMainWindowLoad(win)));

  registerSidebar();
  await registerPreferences();
  syncAutoSyncTimer();

  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(`${addon.data.config.addonRef}-addon.ftl`);
  win.MozXULElement.insertFTLIfNeeded(`${addon.data.config.addonRef}-mainWindow.ftl`);
  registerSidebarForWindow(win);
}

async function onMainWindowUnload(win: Window): Promise<void> {
  unregisterSidebarForWindow(win);
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  stopAutoSyncTimer();
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
  if (type !== 'load') return;
  const win = data.window as Window | undefined;
  if (!win?.document) return;
  setupPreferencesPane(win);
}

function setupPreferencesPane(win: Window): void {
  const doc = win.document;
  const root = byID<HTMLElement>(doc, 'zotero-ai-sidebar-tool-settings');
  if (!root) return;

  renderPresetSettings(doc);
  renderTranslateSettings(doc);
  renderUiSettings(doc);
  renderPromptSettings(doc);
  renderToolSettings(doc);
  renderSyncSettings(doc);

  if (root.dataset.bound === 'true') return;
  root.dataset.bound = 'true';

  const immersiveCard = byID<HTMLInputElement>(doc, 'zai-immersive-card-mode');
  if (immersiveCard) {
    immersiveCard.checked = getImmersiveClickMode(zoteroPrefs()) === 'card';
    immersiveCard.addEventListener('change', () => {
      setImmersiveClickMode(
        zoteroPrefs(),
        immersiveCard.checked ? 'card' : 'chooser',
      );
    });
  }

  const immersiveNeighbor = byID<HTMLInputElement>(
    doc,
    'zai-immersive-neighbor-context',
  );
  if (immersiveNeighbor) {
    immersiveNeighbor.checked = getImmersiveNeighborContext(zoteroPrefs());
    immersiveNeighbor.addEventListener('change', () => {
      setImmersiveNeighborContext(zoteroPrefs(), immersiveNeighbor.checked);
    });
  }

  const immersiveTerms = byID<HTMLInputElement>(
    doc,
    'zai-immersive-term-pairs',
  );
  if (immersiveTerms) {
    immersiveTerms.checked = getImmersiveTermPairs(zoteroPrefs());
    immersiveTerms.addEventListener('change', () => {
      setImmersiveTermPairs(zoteroPrefs(), immersiveTerms.checked);
    });
  }

  const immersiveNextKey = byID<HTMLInputElement>(doc, 'zai-immersive-next-key');
  if (immersiveNextKey) {
    immersiveNextKey.value = getImmersiveNextSentenceKey(zoteroPrefs());
    immersiveNextKey.addEventListener('change', () => {
      setImmersiveNextSentenceKey(
        zoteroPrefs(),
        immersiveNextKey.value.trim() || DEFAULT_IMMERSIVE_NEXT_KEY,
      );
      immersiveNextKey.value = getImmersiveNextSentenceKey(zoteroPrefs());
    });
  }

  const immersivePrevKey = byID<HTMLInputElement>(doc, 'zai-immersive-prev-key');
  if (immersivePrevKey) {
    immersivePrevKey.value = getImmersivePrevSentenceKey(zoteroPrefs());
    immersivePrevKey.addEventListener('change', () => {
      setImmersivePrevSentenceKey(
        zoteroPrefs(),
        immersivePrevKey.value.trim() || DEFAULT_IMMERSIVE_PREV_KEY,
      );
      immersivePrevKey.value = getImmersivePrevSentenceKey(zoteroPrefs());
    });
  }

  const immersiveQuickKey = byID<HTMLInputElement>(
    doc,
    'zai-immersive-quick-key',
  );
  if (immersiveQuickKey) {
    immersiveQuickKey.value = getImmersiveQuickTranslateKey(zoteroPrefs());
    immersiveQuickKey.addEventListener('change', () => {
      setImmersiveQuickTranslateKey(
        zoteroPrefs(),
        immersiveQuickKey.value.trim() || DEFAULT_IMMERSIVE_QUICK_KEY,
      );
      immersiveQuickKey.value = getImmersiveQuickTranslateKey(zoteroPrefs());
    });
  }

  const immersiveFocusAskKey = byID<HTMLInputElement>(
    doc,
    'zai-immersive-focus-ask-key',
  );
  if (immersiveFocusAskKey) {
    immersiveFocusAskKey.value = getImmersiveFocusAskKey(zoteroPrefs());
    immersiveFocusAskKey.addEventListener('change', () => {
      setImmersiveFocusAskKey(
        zoteroPrefs(),
        immersiveFocusAskKey.value.trim() || DEFAULT_IMMERSIVE_FOCUS_ASK_KEY,
      );
      immersiveFocusAskKey.value = getImmersiveFocusAskKey(zoteroPrefs());
    });
  }

  const immersiveToggleKey = byID<HTMLInputElement>(
    doc,
    'zai-immersive-toggle-key',
  );
  if (immersiveToggleKey) {
    immersiveToggleKey.value = getImmersiveToggleControlsKey(zoteroPrefs());
    immersiveToggleKey.addEventListener('change', () => {
      setImmersiveToggleControlsKey(
        zoteroPrefs(),
        immersiveToggleKey.value.trim() || DEFAULT_IMMERSIVE_TOGGLE_KEY,
      );
      immersiveToggleKey.value = getImmersiveToggleControlsKey(zoteroPrefs());
    });
  }

  byID<HTMLButtonElement>(doc, 'zai-preset-add-openai')?.addEventListener(
    'click',
    () => {
      const preset = makePreset('openai');
      const presets = [...readPresetControls(doc), preset];
      renderPresetRows(doc, presets);
      openPresetRow(doc, preset.id);
      updatePresetSaveButton(doc);
      setStatus(doc, 'zai-preset-status', '已新增 OpenAI 配置，保存后生效。');
    },
  );
  byID<HTMLButtonElement>(doc, 'zai-preset-add-anthropic')?.addEventListener(
    'click',
    () => {
      const preset = makePreset('anthropic');
      const presets = [...readPresetControls(doc), preset];
      renderPresetRows(doc, presets);
      openPresetRow(doc, preset.id);
      updatePresetSaveButton(doc);
      setStatus(doc, 'zai-preset-status', '已新增 Anthropic 配置，保存后生效。');
    },
  );
  byID<HTMLButtonElement>(doc, 'zai-preset-save')?.addEventListener('click', () => {
    void savePresetControlsWithConnectivity(doc);
  });
  byID<HTMLButtonElement>(doc, 'zai-ui-save')?.addEventListener('click', () => {
    saveUiSettings(zoteroPrefs(), readUiSettingsControls(doc));
    renderUiSettings(doc);
    refreshSidebarPreferences();
    setStatus(doc, 'zai-ui-status', '显示设置已保存，侧边栏已刷新。');
    flashButton(byID<HTMLButtonElement>(doc, 'zai-ui-save'), '已保存');
  });
  byID<HTMLSelectElement>(doc, 'zai-translate-preset')?.addEventListener(
    'change',
    () => {
      refreshTranslateModelSelect(doc, '');
      // Vendor switch also changes the available thinking levels (DeepSeek
      // exposes only High/Max effectively); keep the dropdown honest.
      refreshTranslateThinkingSelect(doc);
    },
  );
  byID<HTMLButtonElement>(doc, 'zai-translate-save')?.addEventListener(
    'click',
    () => {
      saveTranslateSettingsControls(doc);
    },
  );

  byID<HTMLButtonElement>(doc, 'zai-custom-prompt-add')?.addEventListener(
    'click',
    () => addCustomPromptRow(doc, { id: makeId('prompt'), label: '', prompt: '' }),
  );
  byID<HTMLButtonElement>(doc, 'zai-prompt-save')?.addEventListener('click', () => {
    savePromptControls(doc);
  });
  byID<HTMLButtonElement>(doc, 'zai-prompt-reset')?.addEventListener('click', () => {
    populateBuiltInPromptControls(doc, DEFAULT_QUICK_PROMPT_SETTINGS);
    savePromptControls(doc, '已恢复当前插件内置默认提示词并立即生效。');
  });

  byID<HTMLButtonElement>(doc, 'zai-mcp-add')?.addEventListener('click', () => {
    addMcpRow(doc, {
      id: makeId('mcp'),
      enabled: true,
      serverLabel: 'mcp',
      serverUrl: '',
      allowedTools: [],
      requireApproval: 'never',
    });
  });
  byID<HTMLButtonElement>(doc, 'zai-tool-save')?.addEventListener('click', () => {
    const settings = readToolSettingsControls(doc);
    saveToolSettings(zoteroPrefs(), settings);
    renderToolSettings(doc);
    refreshSidebarPreferences();
    setStatus(doc, 'zai-tool-status', '联网/MCP配置已保存，下一次请求立即使用。');
  });
  byID<HTMLButtonElement>(doc, 'zai-color-save')?.addEventListener('click', () => {
    const settings = readToolSettingsControls(doc);
    saveToolSettings(zoteroPrefs(), settings);
    renderToolSettings(doc);
    refreshSidebarPreferences();
    setStatus(doc, 'zai-tool-status', 'PDF 注释颜色预设已保存，下一次请求立即使用。');
    flashButton(byID<HTMLButtonElement>(doc, 'zai-color-save'), '已保存');
  });
  byID<HTMLButtonElement>(doc, 'zai-tool-reset-color-guide')?.addEventListener('click', () => {
    const settings = readToolSettingsControls(doc);
    saveToolSettings(zoteroPrefs(), {
      ...settings,
      annotationColorGuide: DEFAULT_TOOL_SETTINGS.annotationColorGuide,
    });
    renderToolSettings(doc);
    refreshSidebarPreferences();
    setStatus(doc, 'zai-tool-status', 'PDF 注释颜色预设已恢复默认并立即生效。');
    flashButton(byID<HTMLButtonElement>(doc, 'zai-tool-reset-color-guide'), '已重置');
  });
  byID<HTMLButtonElement>(doc, 'zai-text-annotation-font-save')?.addEventListener('click', () => {
    const settings = readToolSettingsControls(doc);
    saveToolSettings(zoteroPrefs(), settings);
    renderToolSettings(doc);
    refreshSidebarPreferences();
    setStatus(
      doc,
      'zai-text-annotation-font-status',
      `「新增文字」默认字号已保存为 ${settings.textAnnotationFontSize}。`,
    );
    flashButton(byID<HTMLButtonElement>(doc, 'zai-text-annotation-font-save'), '已保存');
  });
  byID<HTMLButtonElement>(doc, 'zai-config-export-file')?.addEventListener('click', () => {
    void exportConfigBackupFile(doc);
  });
  byID<HTMLButtonElement>(doc, 'zai-config-import-file')?.addEventListener('click', () => {
    void importConfigBackupFile(doc);
  });
  byID<HTMLButtonElement>(doc, 'zai-config-generate')?.addEventListener('click', () => {
    generateConfigBackupJson(doc);
  });
  byID<HTMLButtonElement>(doc, 'zai-config-copy')?.addEventListener('click', () => {
    void copyConfigBackupJson(doc);
  });
  byID<HTMLButtonElement>(doc, 'zai-config-import-text')?.addEventListener('click', () => {
    importConfigBackupFromText(doc);
  });
  byID<HTMLButtonElement>(doc, 'zai-config-clear')?.addEventListener('click', () => {
    const area = byID<HTMLTextAreaElement>(doc, 'zai-config-json');
    if (area) area.value = '';
    setStatus(doc, 'zai-config-status', '手动备份文本已清空。');
  });
  byID<HTMLButtonElement>(doc, 'zai-sync-save')?.addEventListener('click', () => {
    const account = readSyncAccountControls(doc);
    saveSyncAccount(zoteroPrefs(), account);
    renderSyncSettings(doc);
    setStatus(doc, 'zai-sync-status', 'WebDAV 账号已保存。');
    flashButton(byID<HTMLButtonElement>(doc, 'zai-sync-save'), '已保存');
  });
  byID<HTMLButtonElement>(doc, 'zai-sync-test')?.addEventListener('click', () => {
    void runSyncTest(doc);
  });
  byID<HTMLButtonElement>(doc, 'zai-sync-push')?.addEventListener('click', () => {
    void runSyncPush(doc);
  });
  byID<HTMLButtonElement>(doc, 'zai-sync-pull')?.addEventListener('click', () => {
    void runSyncPull(doc);
  });
  byID<HTMLButtonElement>(doc, 'zai-sync-auto')?.addEventListener('click', () => {
    void toggleAutoSync(doc);
  });
}

async function runSyncTest(doc: Document): Promise<void> {
  // Reading from controls (not prefs) lets the user test without first
  // clicking "Save account" — common path for first-time setup.
  const account = readSyncAccountControls(doc);
  setStatus(doc, 'zai-sync-status', '正在测试 WebDAV 连接…');
  const result = await testSyncConnection(account);
  setStatus(doc, 'zai-sync-status', result.message, !result.ok);
  if (result.ok) {
    saveSyncAccount(zoteroPrefs(), account);
    renderSyncSettings(doc);
    flashButton(byID<HTMLButtonElement>(doc, 'zai-sync-test'), '已连接');
  }
}

async function runSyncPush(doc: Document): Promise<void> {
  const account = readSyncAccountControls(doc);
  saveSyncAccount(zoteroPrefs(), account);
  setStatus(doc, 'zai-sync-status', '正在打包并上传到云端…');
  const result = await pushToCloud(zoteroPrefs(), account);
  setStatus(doc, 'zai-sync-status', result.message, !result.ok);
  if (result.ok) {
    renderSyncSettings(doc);
    flashButton(byID<HTMLButtonElement>(doc, 'zai-sync-push'), '已上传');
  }
}

async function runSyncPull(doc: Document): Promise<void> {
  const account = readSyncAccountControls(doc);
  saveSyncAccount(zoteroPrefs(), account);
  const ok = doc.defaultView?.confirm(
    '从云端下载会应用账号、显示、提示词、联网/MCP、翻译配置、AI 对话和翻译缓存。继续？',
  ) ?? true;
  if (!ok) {
    setStatus(doc, 'zai-sync-status', '已取消下载。');
    return;
  }
  setStatus(doc, 'zai-sync-status', '正在从云端下载并应用配置…');
  const result = await pullFromCloud(zoteroPrefs(), account);
  setStatus(doc, 'zai-sync-status', result.message, !result.ok);
  if (result.ok) {
    renderPresetSettings(doc);
    renderTranslateSettings(doc);
    renderUiSettings(doc);
    renderPromptSettings(doc);
    renderToolSettings(doc);
    renderSyncSettings(doc);
    refreshSidebarPreferences();
    flashButton(byID<HTMLButtonElement>(doc, 'zai-sync-pull'), '已下载');
  }
}

const AUTO_SYNC_INTERVAL_MS = 10 * 60 * 1000;
let autoSyncTimer: ReturnType<typeof setInterval> | null = null;
let autoSyncInFlight = false;

async function toggleAutoSync(doc: Document): Promise<void> {
  const current = readSyncAccountControls(doc);
  const next = {
    ...current,
    autoSyncEnabled: !current.autoSyncEnabled,
  };
  saveSyncAccount(zoteroPrefs(), next);
  renderSyncSettings(doc);
  syncAutoSyncTimer(false);
  if (!next.autoSyncEnabled) {
    setStatus(doc, 'zai-sync-status', '自动同步已关闭。');
    flashButton(byID<HTMLButtonElement>(doc, 'zai-sync-auto'), '已关闭');
    return;
  }
  setStatus(doc, 'zai-sync-status', '自动同步已开启，将先下载合并再上传。');
  flashButton(byID<HTMLButtonElement>(doc, 'zai-sync-auto'), '已开启');
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
    if (doc) setStatus(doc, 'zai-sync-status', '正在自动同步：从云端下载合并…');
    const pull = await pullFromCloud(zoteroPrefs(), account);
    if (!pull.ok && !pull.message.includes('云端尚未找到')) {
      if (doc) setStatus(doc, 'zai-sync-status', `自动同步失败：${pull.message}`, true);
      return;
    }

    account = loadSyncAccount(zoteroPrefs());
    if (!account.autoSyncEnabled) return;
    if (doc) setStatus(doc, 'zai-sync-status', '正在自动同步：上传合并后的状态…');
    const push = await pushToCloud(zoteroPrefs(), account);
    if (!push.ok) {
      if (doc) setStatus(doc, 'zai-sync-status', `自动同步失败：${push.message}`, true);
      return;
    }

    saveSyncAccount(zoteroPrefs(), {
      ...loadSyncAccount(zoteroPrefs()),
      lastAutoSyncAt: new Date().toISOString(),
    });
    refreshSidebarPreferences();
    if (doc) {
      renderPresetSettings(doc);
      renderTranslateSettings(doc);
      renderUiSettings(doc);
      renderPromptSettings(doc);
      renderToolSettings(doc);
      renderSyncSettings(doc);
      setStatus(doc, 'zai-sync-status', `自动同步完成。${push.message}`);
    }
  } finally {
    autoSyncInFlight = false;
  }
}

const CONFIG_BACKUP_SCHEMA = 'zotero-ai-sidebar.config.v1';

interface ConfigBackup {
  schema: typeof CONFIG_BACKUP_SCHEMA;
  exportedAt: string;
  presets: ModelPreset[];
  uiSettings: UiSettings;
  quickPrompts: QuickPromptSettings;
  toolSettings: ToolSettings;
  translateSettings: TranslateSettings;
}

interface ParsedConfigBackup {
  presets?: ModelPreset[];
  uiSettings?: UiSettings;
  quickPrompts?: QuickPromptSettings;
  toolSettings?: ToolSettings;
  translateSettings?: TranslateSettings;
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
    const path = await pickConfigBackupFile(doc, 'save');
    if (!path) {
      setStatus(doc, 'zai-config-status', '已取消导出。');
      return;
    }
    await Zotero.File.putContentsAsync(path, configBackupJson());
    setStatus(doc, 'zai-config-status', `配置备份已保存：${path}`);
    flashButton(byID<HTMLButtonElement>(doc, 'zai-config-export-file'), '已导出');
  } catch (err) {
    setStatus(doc, 'zai-config-status', fileErrorMessage('导出失败', err), true);
  }
}

async function importConfigBackupFile(doc: Document): Promise<void> {
  try {
    const path = await pickConfigBackupFile(doc, 'open');
    if (!path) {
      setStatus(doc, 'zai-config-status', '已取消导入。');
      return;
    }
    const contents = await Zotero.File.getContentsAsync(path, 'utf-8');
    if (typeof contents !== 'string') throw new Error('配置文件不是文本内容');
    const raw = contents;
    importConfigBackupRaw(doc, raw, '配置文件', 'zai-config-import-file');
  } catch (err) {
    setStatus(doc, 'zai-config-status', fileErrorMessage('导入失败', err), true);
  }
}

function generateConfigBackupJson(doc: Document): void {
  const area = byID<HTMLTextAreaElement>(doc, 'zai-config-json');
  if (!area) return;
  const backup = buildConfigBackup();
  area.value = JSON.stringify(backup, null, 2);
  area.focus();
  area.select();
  setStatus(
    doc,
    'zai-config-status',
    `已生成配置 JSON：账号 ${backup.presets.length} 个，自定义按钮 ${backup.quickPrompts.customButtons.length} 个，含翻译设置。内容可能包含 API Key。`,
  );
  flashButton(byID<HTMLButtonElement>(doc, 'zai-config-generate'), '已生成');
}

async function copyConfigBackupJson(doc: Document): Promise<void> {
  const area = byID<HTMLTextAreaElement>(doc, 'zai-config-json');
  if (!area) return;
  if (!area.value.trim()) generateConfigBackupJson(doc);
  await writeTextToClipboard(doc, area.value);
  setStatus(doc, 'zai-config-status', '配置 JSON 已复制。内容可能包含 API Key。');
  flashButton(byID<HTMLButtonElement>(doc, 'zai-config-copy'), '已复制');
}

function importConfigBackupFromText(doc: Document): void {
  const area = byID<HTMLTextAreaElement>(doc, 'zai-config-json');
  const raw = area?.value.trim() ?? '';
  if (!raw) {
    setStatus(doc, 'zai-config-status', '请先粘贴配置 JSON。', true);
    return;
  }
  importConfigBackupRaw(doc, raw, '文本', 'zai-config-import-text');
}

function importConfigBackupRaw(
  doc: Document,
  raw: string,
  source: string,
  buttonID?: string,
): void {
  const parsed = parseConfigBackup(raw);
  if (typeof parsed === 'string') {
    setStatus(doc, 'zai-config-status', parsed, true);
    return;
  }
  const ok = doc.defaultView?.confirm(
    `导入会覆盖当前已保存的 ${parsed.sections.join('、')} 配置，确定继续？`,
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

  renderPresetSettings(doc);
  renderTranslateSettings(doc);
  renderUiSettings(doc);
  renderPromptSettings(doc);
  renderToolSettings(doc);
  refreshSidebarPreferences();
  setStatus(
    doc,
    'zai-config-status',
    `已从${source}导入：${parsed.sections.join('、')}。侧边栏已刷新。`,
  );
  if (buttonID) flashButton(byID<HTMLButtonElement>(doc, buttonID), '已导入');
}

async function pickConfigBackupFile(
  doc: Document,
  mode: 'open' | 'save',
): Promise<string | null> {
  const win = doc.defaultView;
  if (!win?.browsingContext) {
    throw new Error('当前窗口不支持文件选择器');
  }
  const nsFilePicker = Components.interfaces.nsIFilePicker;
  const filePickerClass = (
    Components.classes as unknown as Record<
      string,
      { createInstance(iid: typeof nsFilePicker): nsIFilePicker }
    >
  )['@mozilla.org/filepicker;1'];
  const picker = filePickerClass.createInstance(nsFilePicker);
  picker.init(
    win.browsingContext,
    mode === 'save' ? '导出配置文件' : '导入配置文件',
    mode === 'save' ? nsFilePicker.modeSave : nsFilePicker.modeOpen,
  );
  picker.appendFilter('JSON 配置文件', '*.json');
  picker.appendFilters(nsFilePicker.filterAll ?? 1);
  picker.defaultExtension = 'json';
  if (mode === 'save') picker.defaultString = configBackupFileName();

  const result = await new Promise<nsIFilePicker.ResultCode>((resolve) => {
    picker.open({ done: resolve });
  });
  if (result === nsFilePicker.returnCancel) return null;
  if (mode === 'save') {
    if (result !== nsFilePicker.returnOK && result !== nsFilePicker.returnReplace) {
      return null;
    }
  } else if (result !== nsFilePicker.returnOK) {
    return null;
  }
  return picker.file?.path ?? null;
}

async function writeTextToClipboard(doc: Document, text: string): Promise<void> {
  const clipboard = doc.defaultView?.navigator.clipboard;
  if (clipboard?.writeText) {
    await clipboard.writeText(text);
    return;
  }
  const area = doc.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  const root = doc.body ?? doc.documentElement;
  if (!root) return;
  root.append(area);
  area.select();
  doc.execCommand('copy');
  area.remove();
}

function fileErrorMessage(prefix: string, err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  return `${prefix}：${detail}`;
}

function parseConfigBackup(raw: string): ParsedConfigBackup | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return '配置 JSON 解析失败，请检查是否完整复制。';
  }
  if (!isRecord(parsed)) return '配置 JSON 顶层必须是对象。';

  const sections: string[] = [];
  const result: ParsedConfigBackup = { sections };
  if (hasOwn(parsed, 'presets')) {
    if (!Array.isArray(parsed.presets)) return '配置里的 presets 必须是数组。';
    result.presets = normalizePresetList(parsed.presets);
    sections.push('账号');
  }
  if (hasOwn(parsed, 'uiSettings')) {
    if (!isRecord(parsed.uiSettings)) return '配置里的 uiSettings 必须是对象。';
    result.uiSettings = normalizeUiSettings(parsed.uiSettings);
    sections.push('显示');
  }
  if (hasOwn(parsed, 'quickPrompts')) {
    if (!isRecord(parsed.quickPrompts)) return '配置里的 quickPrompts 必须是对象。';
    result.quickPrompts = normalizeQuickPromptSettings(parsed.quickPrompts);
    sections.push('提示词');
  }
  if (hasOwn(parsed, 'toolSettings')) {
    if (!isRecord(parsed.toolSettings)) return '配置里的 toolSettings 必须是对象。';
    result.toolSettings = normalizeToolSettings(parsed.toolSettings);
    sections.push('联网/MCP');
  }
  if (hasOwn(parsed, 'translateSettings')) {
    if (!isRecord(parsed.translateSettings)) {
      return '配置里的 translateSettings 必须是对象。';
    }
    result.translateSettings = normalizeTranslateSettings(parsed.translateSettings);
    sections.push('翻译');
  }
  if (sections.length === 0) {
    return '没有找到可导入的配置段：presets / uiSettings / quickPrompts / toolSettings / translateSettings。';
  }
  return result;
}

function renderPresetSettings(doc: Document): void {
  renderPresetRows(doc, loadPresets(zoteroPrefs()));
  updatePresetSaveButton(doc);
  setStatus(doc, 'zai-preset-status', '已加载账号配置。');
}

const TRANSLATE_THINKING_OPTIONS: Array<[TranslateThinking, string]> = [
  ['off', '关闭 - 不思考，最快最省 token'],
  ['low', 'Low - 省 token，推荐翻译使用'],
  ['medium', 'Medium - 平衡'],
  ['high', 'High - 更强推理'],
  ['xhigh', 'Extra high - 最强推理'],
];

// DeepSeek's Anthropic-format endpoint advertises two effective effort
// values (high / max). Per their docs (note 3): low/medium → high, xhigh
// → max — meaning the Low/Medium UI options would all behave identically
// to High on DeepSeek. We collapse to a smaller, honest list so users
// don't pick "Low" expecting a lighter model and silently get "High".
const TRANSLATE_THINKING_OPTIONS_DEEPSEEK: Array<[TranslateThinking, string]> = [
  ['off', '关闭 - 不思考'],
  ['high', 'High - 标准思考（DeepSeek 默认）'],
  ['xhigh', 'Max - 强思考（复杂任务）'],
];

function translateThinkingOptionsForPreset(
  preset: ModelPreset | null,
): Array<[TranslateThinking, string]> {
  if (preset?.provider === 'anthropic' && preset.extras?.vendor === 'deepseek') {
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
  if (preset?.provider === 'anthropic' && preset.extras?.vendor === 'deepseek') {
    if (level === 'low' || level === 'medium') return 'high';
  }
  return level;
}

const TRANSLATE_CONTEXT_OPTIONS: Array<[TranslateContextLevel, string]> = [
  ['none', '仅本句'],
  ['paragraph', '本段'],
  ['page', '整页'],
];

const TRANSLATE_POSITION_OPTIONS: Array<[TranslateOverlayPosition, string]> = [
  ['above', '句上方'],
  ['below', '句下方'],
];

const TRANSLATE_SIZE_OPTIONS: Array<[TranslateOverlaySize, string]> = [
  ['compact', '紧凑（固定小框）'],
  ['adaptive', '自适应（尽量展开）'],
];

const TRANSLATE_TRIGGER_OPTIONS: Array<[TranslateTriggerMode, string]> = [
  ['single', '单击翻译'],
  ['double', '双击翻译'],
];

function renderTranslateSettings(doc: Document): void {
  const settings = loadTranslateSettings(zoteroPrefs());
  const presets = translatePresets();
  const preset = translatePresetForSettings(presets, settings.presetId);
  const presetSelect = byID<HTMLSelectElement>(doc, 'zai-translate-preset');
  if (presetSelect) {
    presetSelect.replaceChildren();
    if (presets.length === 0) {
      presetSelect.append(option(doc, '', '请先保存账号配置'));
      presetSelect.disabled = true;
    } else {
      presetSelect.disabled = false;
      for (const item of presets) {
        presetSelect.append(option(doc, item.id, item.label || item.model || 'GPT'));
      }
      presetSelect.value = preset?.id ?? presets[0]?.id ?? '';
    }
  }
  refreshTranslateModelSelect(doc, settings.model);
  populateSelectOptions(
    doc,
    'zai-translate-thinking',
    translateThinkingOptionsForPreset(preset),
    collapseThinkingForPreset(preset, settings.thinking),
  );
  populateSelectOptions(
    doc,
    'zai-translate-context',
    TRANSLATE_CONTEXT_OPTIONS,
    settings.ctxLevel,
  );
  populateSelectOptions(
    doc,
    'zai-translate-position',
    TRANSLATE_POSITION_OPTIONS,
    settings.overlayPosition,
  );
  populateSelectOptions(
    doc,
    'zai-translate-size',
    TRANSLATE_SIZE_OPTIONS,
    settings.overlaySize,
  );
  populateSelectOptions(
    doc,
    'zai-translate-trigger',
    TRANSLATE_TRIGGER_OPTIONS,
    settings.triggerMode,
  );
  setInputValue(doc, 'zai-translate-next-key', settings.nextSentenceKey);
  setInputValue(doc, 'zai-translate-prev-key', settings.prevSentenceKey);
  setStatus(
    doc,
    'zai-translate-status',
    presets.length
      ? '已加载逐句翻译设置。'
      : '请先在“账号与模型”里保存一个账号配置。',
    presets.length === 0,
  );
}

// Repopulate the 思考程度 dropdown after a preset switch. Keep the user's
// existing selection if it survives the new vendor's option list; otherwise
// collapse it (low/medium → high on DeepSeek). Triggered from the preset
// change handler — initial render goes through renderTranslateSettings.
function refreshTranslateThinkingSelect(doc: Document): void {
  const thinkingSelect = byID<HTMLSelectElement>(doc, 'zai-translate-thinking');
  if (!thinkingSelect) return;
  const presets = translatePresets();
  const presetId = byID<HTMLSelectElement>(doc, 'zai-translate-preset')?.value ?? '';
  const preset = translatePresetForSettings(presets, presetId);
  const current = thinkingSelect.value as TranslateThinking;
  populateSelectOptions(
    doc,
    'zai-translate-thinking',
    translateThinkingOptionsForPreset(preset),
    collapseThinkingForPreset(preset, current),
  );
}

function refreshTranslateModelSelect(doc: Document, desiredModel?: string): string {
  const modelSelect = byID<HTMLSelectElement>(doc, 'zai-translate-model');
  if (!modelSelect) return '';
  const presets = translatePresets();
  const presetId = byID<HTMLSelectElement>(doc, 'zai-translate-preset')?.value ?? '';
  const preset = translatePresetForSettings(presets, presetId);
  const models = translateModelsForPreset(preset);
  const active = validTranslateModel(
    preset,
    desiredModel ?? modelSelect.value,
  );
  modelSelect.replaceChildren();
  if (models.length === 0) {
    modelSelect.append(option(doc, '', '无可用模型'));
    modelSelect.value = '';
    modelSelect.disabled = true;
    return '';
  }
  modelSelect.disabled = false;
  for (const model of models) modelSelect.append(option(doc, model, model));
  modelSelect.value = active;
  return active;
}

function saveTranslateSettingsControls(doc: Document): void {
  const settings = readTranslateSettingsControls(doc);
  saveTranslateSettings(zoteroPrefs(), settings);
  renderTranslateSettings(doc);
  refreshSidebarPreferences();
  setStatus(doc, 'zai-translate-status', '逐句翻译设置已保存；下一次翻译立即使用。');
  flashButton(byID<HTMLButtonElement>(doc, 'zai-translate-save'), '已保存');
}

function readTranslateSettingsControls(doc: Document): TranslateSettings {
  const existing = loadTranslateSettings(zoteroPrefs());
  const presets = translatePresets();
  const presetId = byID<HTMLSelectElement>(doc, 'zai-translate-preset')?.value ?? '';
  const preset = translatePresetForSettings(presets, presetId);
  return normalizeTranslateSettings({
    ...existing,
    enabled: false,
    presetId: preset?.id ?? '',
    model: validTranslateModel(
      preset,
      byID<HTMLSelectElement>(doc, 'zai-translate-model')?.value ?? '',
    ),
    thinking: translateThinkingValue(
      byID<HTMLSelectElement>(doc, 'zai-translate-thinking')?.value,
    ),
    ctxLevel: translateContextValue(
      byID<HTMLSelectElement>(doc, 'zai-translate-context')?.value,
    ),
    overlayPosition: translatePositionValue(
      byID<HTMLSelectElement>(doc, 'zai-translate-position')?.value,
    ),
    overlaySize: translateSizeValue(
      byID<HTMLSelectElement>(doc, 'zai-translate-size')?.value ??
        existing.overlaySize,
    ),
    triggerMode: translateTriggerValue(
      byID<HTMLSelectElement>(doc, 'zai-translate-trigger')?.value ??
        existing.triggerMode,
    ),
    nextSentenceKey:
      byID<HTMLInputElement>(doc, 'zai-translate-next-key')?.value.trim() ||
      existing.nextSentenceKey,
    prevSentenceKey:
      byID<HTMLInputElement>(doc, 'zai-translate-prev-key')?.value.trim() ||
      existing.prevSentenceKey,
  });
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
  return desired && models.includes(desired) ? desired : (models[0] ?? '');
}

function translateThinkingValue(value: unknown): TranslateThinking {
  return value === 'off' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
    ? value
    : 'low';
}

function translateContextValue(value: unknown): TranslateContextLevel {
  return value === 'paragraph' || value === 'page' ? value : 'none';
}

function translatePositionValue(value: unknown): TranslateOverlayPosition {
  return value === 'below' ? 'below' : 'above';
}

function translateSizeValue(value: unknown): TranslateOverlaySize {
  return value === 'adaptive' ? 'adaptive' : 'compact';
}

function translateTriggerValue(value: unknown): TranslateTriggerMode {
  return value === 'double' ? 'double' : 'single';
}

function renderUiSettings(doc: Document): void {
  const settings = loadUiSettings(zoteroPrefs());
  setInputValue(doc, 'zai-ui-user-label', settings.userProfile.label);
  setInputValue(doc, 'zai-ui-user-avatar', settings.userProfile.avatar);
  setInputValue(doc, 'zai-ui-assistant-label', settings.assistantProfile.label);
  setInputValue(doc, 'zai-ui-assistant-avatar', settings.assistantProfile.avatar);
  setInputValue(doc, 'zai-ui-chat-font', settings.chatFontFamily);
  const position = byID<HTMLSelectElement>(doc, 'zai-ui-actions-position');
  if (position) position.value = settings.messageActionsPosition;
  const layout = byID<HTMLSelectElement>(doc, 'zai-ui-actions-layout');
  if (layout) layout.value = settings.messageActionsLayout;
  const queue = byID<HTMLInputElement>(doc, 'zai-ui-composer-queue');
  if (queue) queue.checked = settings.composerQueueWhileSending;
  setStatus(doc, 'zai-ui-status', '已加载显示设置。');
}

function readUiSettingsControls(doc: Document): UiSettings {
  const position = byID<HTMLSelectElement>(doc, 'zai-ui-actions-position');
  const layout = byID<HTMLSelectElement>(doc, 'zai-ui-actions-layout');
  return normalizeUiSettings({
    userProfile: {
      label: byID<HTMLInputElement>(doc, 'zai-ui-user-label')?.value,
      avatar: byID<HTMLInputElement>(doc, 'zai-ui-user-avatar')?.value,
    },
    assistantProfile: {
      label: byID<HTMLInputElement>(doc, 'zai-ui-assistant-label')?.value,
      avatar: byID<HTMLInputElement>(doc, 'zai-ui-assistant-avatar')?.value,
    },
    chatFontFamily: byID<HTMLInputElement>(doc, 'zai-ui-chat-font')?.value,
    messageActionsPosition: position?.value,
    messageActionsLayout: layout?.value,
    composerQueueWhileSending:
      byID<HTMLInputElement>(doc, 'zai-ui-composer-queue')?.checked === true,
  });
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
  setInputValue(doc, 'zai-sync-url', account.webdavUrl);
  setInputValue(doc, 'zai-sync-username', account.username);
  setInputValue(doc, 'zai-sync-password', account.password);
  setInputValue(doc, 'zai-sync-folder', account.remoteFolder);
  const auto = byID<HTMLButtonElement>(doc, 'zai-sync-auto');
  if (auto) {
    auto.dataset.enabled = account.autoSyncEnabled ? 'true' : 'false';
    auto.setAttribute('aria-pressed', account.autoSyncEnabled ? 'true' : 'false');
    const label = auto.querySelector<HTMLElement>('.zai-switch-label');
    if (label) label.textContent = account.autoSyncEnabled ? '开启' : '关闭';
    else auto.textContent = account.autoSyncEnabled ? '开启' : '关闭';
    auto.title = account.autoSyncEnabled
      ? '已开启：启动时和每 10 分钟自动从云端下载合并，再上传到云端'
      : '已关闭：点击后开启自动下载合并 + 上传';
  }
  const meta = byID<HTMLElement>(doc, 'zai-sync-meta');
  if (meta) meta.textContent = formatSyncMeta(account);
}

function readSyncAccountControls(doc: Document): SyncAccount {
  const existing = loadSyncAccount(zoteroPrefs());
  return {
    ...existing,
    webdavUrl: byID<HTMLInputElement>(doc, 'zai-sync-url')?.value ?? existing.webdavUrl,
    username:
      byID<HTMLInputElement>(doc, 'zai-sync-username')?.value ?? existing.username,
    password:
      byID<HTMLInputElement>(doc, 'zai-sync-password')?.value ?? existing.password,
    remoteFolder:
      byID<HTMLInputElement>(doc, 'zai-sync-folder')?.value ?? existing.remoteFolder,
  };
}

function formatSyncMeta(account: SyncAccount): string {
  const parts: string[] = [];
  parts.push(account.lastPushAt ? `上次上传：${account.lastPushAt}` : '上次上传：未上传');
  parts.push(account.lastPullAt ? `上次下载：${account.lastPullAt}` : '上次下载：未下载');
  parts.push(account.autoSyncEnabled ? '自动同步：开' : '自动同步：关');
  if (account.lastAutoSyncAt) parts.push(`上次自动同步：${account.lastAutoSyncAt}`);
  return parts.join(' · ');
}

function renderPresetRows(doc: Document, presets: ModelPreset[]): void {
  const list = byID<HTMLElement>(doc, 'zai-preset-list');
  if (!list) return;
  list.replaceChildren();
  if (presets.length === 0) {
    list.append(el(doc, 'div', 'zai-pref-help', '还没有模型配置。点击 + OpenAI 或 + Anthropic 新增。'));
    return;
  }
  for (const preset of presets) list.append(presetRow(doc, preset));
  attachPresetDirtyListeners(doc);
  updatePresetSaveButton(doc);
}

function openPresetRow(doc: Document, id: string): void {
  const row = doc.querySelector(
    `.zai-preset-row[data-id="${cssEscape(id)}"]`,
  ) as HTMLDetailsElement | null;
  if (row) row.open = true;
}

function presetRow(doc: Document, preset: ModelPreset): HTMLElement {
  const card = doc.createElement('details');
  card.className = 'zai-subcard zai-preset-row';
  card.dataset.id = preset.id;
  card.open = !preset.apiKey || !preset.model;
  const title = doc.createElement('summary');
  title.className = 'zai-subcard-title zai-preset-summary';
  const main = el(doc, 'span', 'zai-preset-summary-main');
  const statusDot = el(doc, 'span', 'zai-preset-status-dot');
  const applyDot = (status?: 'ok' | 'failed') => {
    statusDot.className = `zai-preset-status-dot${status === 'ok' ? ' zai-dot-ok' : status === 'failed' ? ' zai-dot-fail' : ''}`;
    statusDot.title = status === 'ok' ? '连接测试通过' : status === 'failed' ? '连接测试失败' : '未测试';
  };
  applyDot(preset.extras?.testStatus);
  main.append(
    statusDot,
    el(doc, 'strong', '', preset.label || preset.provider),
    el(doc, 'span', 'zai-preset-summary-meta', presetSummary(preset)),
  );
  title.append(main);
  const testMsg = el(doc, 'span', 'zai-preset-test-msg');
  const flagControl = presetFlagsControl(doc, preset);
  const flagLabel = el(doc, 'label', '', '标志位');
  const testBtn = button(doc, '测试');
  testBtn.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    testBtn.disabled = true;
    testBtn.textContent = '测试中...';
    testMsg.textContent = '';
    testMsg.className = 'zai-preset-test-msg';
    const rawPreset = readPresetFromCard(card);
    try {
      const result = await testPresetConnectivity(rawPreset);
      const saved = { ...result.preset, extras: { ...result.preset.extras, testStatus: 'ok' as const } };
      updatePresetInStorage(saved);
      applyDot('ok');
      testBtn.textContent = '✓ 通过';
      testMsg.textContent = result.message;
      testMsg.className = 'zai-preset-test-msg zai-test-ok';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const failed = { ...rawPreset, extras: { ...rawPreset.extras, testStatus: 'failed' as const } };
      updatePresetInStorage(failed);
      applyDot('failed');
      testBtn.textContent = '✗ 失败';
      testMsg.textContent = msg;
      testMsg.className = 'zai-preset-test-msg zai-test-fail';
    } finally {
      testBtn.disabled = false;
      setTimeout(() => { testBtn.textContent = '测试'; }, 3000);
    }
  });
  title.append(testBtn);
  const cacheTestBtn = button(doc, '缓存测试');
  cacheTestBtn.title =
    '连续发送同一内容测试 prompt cache；当前 Zotero 选中条目有 PDF 时优先使用该 PDF，否则使用内置长文本。';
  cacheTestBtn.disabled = preset.provider !== 'openai';
  cacheTestBtn.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const rawPreset = readPresetFromCard(card);
    if (rawPreset.provider !== 'openai') {
      testMsg.textContent = '缓存测试仅支持 OpenAI 兼容预设。';
      testMsg.className = 'zai-preset-test-msg zai-test-fail';
      return;
    }
    cacheTestBtn.disabled = true;
    cacheTestBtn.textContent = '测缓存中...';
    testMsg.textContent = '正在测试 prompt cache（连续发送两次同一内容）...';
    testMsg.className = 'zai-preset-test-msg';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const testText = await promptCacheTestTextForPreferences();
      const result = await runPresetPromptCacheTest(rawPreset, controller.signal, {
        promptCacheKey: buildPromptCacheTestKey(rawPreset, testText.itemID),
        pinnedFullText: testText.text,
        sourceLabel: testText.label,
      });
      const saved = { ...result.preset, extras: { ...result.preset.extras, testStatus: 'ok' as const } };
      updatePresetInStorage(saved);
      refreshPresetFlags(flagControl, saved);
      applyDot('ok');
      testMsg.textContent = result.message;
      testMsg.className = 'zai-preset-test-msg zai-test-ok';
    } catch (err) {
      testMsg.textContent = sanitizedTestError(err, [rawPreset]);
      testMsg.className = 'zai-preset-test-msg zai-test-fail';
    } finally {
      clearTimeout(timeout);
      cacheTestBtn.disabled = false;
      cacheTestBtn.textContent = '缓存测试';
    }
  });
  title.append(cacheTestBtn);
  const remove = button(doc, '删除');
  remove.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    card.remove();
    // Mark form dirty so 保存账号配置 lights up.
    updatePresetSaveButton(doc);
    setStatus(
      doc,
      'zai-preset-status',
      `已移除 ${preset.label || preset.provider} 卡片，保存后生效。`,
    );
  });
  title.append(remove);

  const provider = select(doc, [
    ['openai', 'OpenAI 兼容'],
    ['anthropic', 'Anthropic'],
  ], preset.provider);
  provider.dataset.field = 'provider';
  const label = input(doc, preset.label);
  label.dataset.field = 'label';
  const apiKey = input(doc, preset.apiKey, 'password');
  apiKey.dataset.field = 'apiKey';
  const baseUrl = input(doc, preset.baseUrl);
  baseUrl.dataset.field = 'baseUrl';
  const initialVendor: AnthropicVendor =
    preset.extras?.vendor ?? detectAnthropicVendor(preset.baseUrl, preset.model);
  const initialKey = preset.provider === 'anthropic' ? initialVendor : 'openai';
  const modelList = createModelListControl(
    doc,
    (preset.models?.length ? preset.models : [preset.model]).filter(Boolean),
    initialKey,
  );
  const maxTokens = input(doc, String(preset.maxTokens || 8192), 'number');
  maxTokens.dataset.field = 'maxTokens';
  const reasoningSummary = select(doc, REASONING_SUMMARY_OPTIONS, preset.extras?.reasoningSummary ?? DEFAULT_REASONING_SUMMARY);
  reasoningSummary.dataset.field = 'reasoningSummary';
  const vendor = select<AnthropicVendor>(
    doc,
    [
      ['claude', 'Claude（官方/反代）'],
      ['deepseek', 'DeepSeek (Anthropic 格式)'],
      ['compat', '其它兼容（不发思考字段）'],
    ],
    initialVendor,
  );
  vendor.dataset.field = 'vendor';
  // Vendor row is hidden for OpenAI presets; we still build it so the
  // dataset.field hookup is uniform — readPresetControls picks it up only
  // when the preset is anthropic.
  const vendorLabel = el(doc, 'label', '', 'Vendor');
  const reasoningLabel = el(doc, 'label', '', 'Reasoning Summary');

  const syncProvider = () => {
    const isOpenAI = provider.value === 'openai';
    reasoningSummary.disabled = !isOpenAI;
    cacheTestBtn.disabled = !isOpenAI;
    const showHide = (lbl: HTMLElement, ctrl: HTMLElement, show: boolean) => {
      lbl.style.display = show ? '' : 'none';
      ctrl.style.display = show ? '' : 'none';
    };
    showHide(vendorLabel, vendor, !isOpenAI);
    showHide(reasoningLabel, reasoningSummary, isOpenAI);
  };
  provider.addEventListener('change', () => {
    const kind = provider.value as ProviderKind;
    if (!label.value.trim()) label.value = kind === 'anthropic' ? 'Claude' : 'GPT';
    if (!baseUrl.value.trim()) baseUrl.value = DEFAULT_BASE_URLS[kind];
    const key = kind === 'anthropic' ? (vendor.value as AnthropicVendor) : 'openai';
    modelList.setSuggestionKey(key);
    if (modelList.models().length === 0 && DEFAULT_MODELS[kind]) {
      modelList.setModels([DEFAULT_MODELS[kind]]);
    }
    syncProvider();
    updatePresetSaveButton(doc);
  });
  vendor.addEventListener('change', () => {
    if (provider.value !== 'anthropic') return;
    modelList.setSuggestionKey(vendor.value as AnthropicVendor);
    updatePresetSaveButton(doc);
  });
  syncProvider();
  card.append(
    title,
    grid(doc, [
      ['Provider', provider],
      ['名称', label],
      ['API Key', apiKey],
      ['Base URL', baseUrl],
      ['Models', modelList.element],
      ['Max tokens', maxTokens],
      [vendorLabel, vendor],
      [reasoningLabel, reasoningSummary],
      [flagLabel, flagControl],
    ]),
    testMsg,
  );
  const refreshFlagsFromControls = () => refreshPresetFlags(flagControl, readPresetFromCard(card));
  for (const control of [provider, baseUrl, reasoningSummary, modelList.element]) {
    control.addEventListener('input', refreshFlagsFromControls);
    control.addEventListener('change', refreshFlagsFromControls);
  }
  return card;
}

function readPresetFromCard(card: HTMLElement): ModelPreset {
  const doc = card.ownerDocument;
  if (!doc) throw new Error('card has no ownerDocument');
  return readPresetControls(doc).find(
    (p) => p.id === card.dataset.id,
  ) ?? readPresetControls(doc)[0];
}

function updatePresetInStorage(preset: ModelPreset): void {
  const all = loadPresets(zoteroPrefs());
  const next = all.map((p) => (p.id === preset.id ? preset : p));
  savePresets(zoteroPrefs(), next);
  refreshSidebarPreferences();
}

function presetSummary(preset: ModelPreset): string {
  const modelCount = preset.models?.length ?? (preset.model ? 1 : 0);
  const modelText =
    modelCount > 1
      ? `${preset.model || preset.models?.[0]} +${modelCount - 1}`
      : preset.model || '未填写模型';
  const base = preset.baseUrl || DEFAULT_BASE_URLS[preset.provider] || '默认 Base URL';
  return `${preset.provider} · ${modelText} · ${base}`;
}

type PresetFlagBadge = {
  text: string;
  title: string;
  tone: 'ok' | 'warn' | 'muted';
};

function presetFlagsControl(doc: Document, preset: ModelPreset): HTMLElement {
  const wrap = el(doc, 'div', 'preset-flags-control');
  wrap.append(el(doc, 'div', 'preset-flags'), el(doc, 'div', 'preset-help'));
  refreshPresetFlags(wrap, preset);
  return wrap;
}

function refreshPresetFlags(control: HTMLElement, preset: ModelPreset): void {
  const flags = control.querySelector('.preset-flags');
  const hint = control.querySelector('.preset-help');
  const doc = control.ownerDocument;
  if (flags && doc) {
    flags.replaceChildren(...presetFlagBadges(preset).map((flag) => presetFlagBadge(doc, flag)));
  }
  if (hint) hint.textContent = presetFlagHint(preset);
}

function presetFlagBadges(preset: ModelPreset): PresetFlagBadge[] {
  if (preset.provider !== 'openai') {
    return [
      {
        text: 'Anthropic',
        title: '当前不是 OpenAI 兼容预设',
        tone: 'muted',
      },
    ];
  }
  const official = isOfficialOpenAIEndpointForPreset(preset);
  const relayCache = shouldSendRelayPromptCacheForPreset(preset);
  const sendsReasoning = official || preset.extras?.omitResponsesReasoningForCache !== true;
  return [
    official
      ? {
          text: '官方 OpenAI',
          title: 'api.openai.com：使用官方 prompt_cache_key 机制',
          tone: 'ok',
        }
      : {
          text: '第三方/Relay',
          title: '非 api.openai.com endpoint：按 OpenAI-compatible 第三方/自建 relay 处理',
          tone: 'warn',
        },
    official
      ? {
          text: supportsExtendedPromptCacheForPreset(preset.model)
            ? 'cache_key + 24h'
            : 'cache_key',
          title: '官方 endpoint 自动发送 prompt_cache_key；支持模型会加 24h retention',
          tone: 'ok',
        }
      : relayCache
        ? {
            text: 'relay cache 自动',
            title: '默认发送 prompt_cache_key + session_id；缓存测试不兼容时会自动关闭',
            tone: 'ok',
          }
        : {
            text: 'relay cache 已关闭',
            title: '缓存测试已标记该预设不发送 prompt_cache_key/session_id',
            tone: 'muted',
          },
    sendsReasoning
      ? {
          text: 'reasoning 透传',
          title: '会发送当前选择的 reasoning effort/summary',
          tone: 'ok',
        }
      : {
          text: 'reasoning 省略',
          title: '缓存优先已开启：非官方 endpoint 会省略 reasoning 字段',
          tone: 'warn',
        },
  ];
}

function presetFlagBadge(doc: Document, flag: PresetFlagBadge): HTMLElement {
  const badge = el(doc, 'span', `preset-flag preset-flag-${flag.tone}`, flag.text);
  badge.title = flag.title;
  return badge;
}

function presetFlagHint(preset: ModelPreset): string {
  if (preset.provider !== 'openai') return '非 OpenAI 兼容预设，不发送 OpenAI prompt cache 参数。';
  if (isOfficialOpenAIEndpointForPreset(preset)) {
    return '官方 endpoint：自动发送官方 prompt_cache_key。';
  }
  if (shouldSendRelayPromptCacheForPreset(preset)) {
    return '第三方/Relay endpoint：默认发送 prompt_cache_key + session_id；缓存测试报错且关闭后可连接时会自动关闭。';
  }
  return '第三方/Relay endpoint：relay cache 已禁用；可点“缓存测试”重新验证。';
}

function shouldSendRelayPromptCacheForPreset(preset: ModelPreset): boolean {
  return (
    preset.provider === 'openai' &&
    !isOfficialOpenAIEndpointForPreset(preset) &&
    preset.extras?.enableRelayPromptCache !== false
  );
}

function supportsExtendedPromptCacheForPreset(model: string): boolean {
  return /^(gpt-5|gpt-4\.1)(?:[.-]|$)/i.test(model.trim());
}

function buildPromptCacheTestKey(preset: ModelPreset, itemID: number | null): string {
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
        : 'prefs-cache-test';
  return [
    'zai',
    preset.provider,
    preset.id || 'preset',
    preset.model || 'model',
    itemPart,
  ].join(':');
}

function resolveItemKeyForTestCache(itemID: number | null): string | null {
  if (itemID == null) return null;
  try {
    const item = (
      globalThis as unknown as {
        Zotero?: { Items?: { get?: (id: number) => { key?: string } | null } };
      }
    ).Zotero?.Items?.get?.(itemID);
    const key = typeof item?.key === 'string' ? item.key : '';
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
          label: `当前 PDF / item-${itemID}`,
          itemID,
        };
      }
    } catch {
      // Fall back to deterministic built-in text when Zotero has no indexed PDF text.
    }
  }
  return { label: '内置长文本', itemID: null };
}

function selectedPreferenceItemID(): number | null {
  const ZoteroLike = Zotero as unknown as {
    getMainWindow?: () => Window | null;
    getMainWindows?: () => Window[];
  };
  const win = ZoteroLike.getMainWindow?.() ?? ZoteroLike.getMainWindows?.()[0] ?? null;
  const pane = (win as { ZoteroPane?: { getSelectedItems?: () => unknown[] } } | null)
    ?.ZoteroPane;
  const item = pane?.getSelectedItems?.()[0] as
    | { id?: number; parentID?: number; isAttachment?: () => boolean }
    | undefined;
  if (!item) return null;
  if (item.isAttachment?.() && typeof item.parentID === 'number') return item.parentID;
  return typeof item.id === 'number' ? item.id : null;
}

function truncatePromptCacheTestText(text: string): string {
  const charBudget = 16_000 * 4;
  return text.length > charBudget ? text.slice(0, charBudget) : text;
}

type ModelSuggestionKey = keyof typeof MODEL_SUGGESTIONS;

interface ModelListControl {
  element: HTMLElement;
  models(): string[];
  setModels(models: string[]): void;
  setSuggestionKey(key: ModelSuggestionKey): void;
}

function createModelListControl(
  doc: Document,
  initialModels: string[],
  initialKey: ModelSuggestionKey,
): ModelListControl {
  const wrap = el(doc, 'div', 'zai-model-control');
  const selected = el(doc, 'div', 'zai-model-selected');
  const side = el(doc, 'div', 'zai-model-side');
  const hidden = textarea(doc, '');
  hidden.dataset.field = 'models';
  hidden.className = 'zai-model-hidden';

  let suggestionKey: ModelSuggestionKey = initialKey;
  const currentModels = () => {
    const values: string[] = [];
    selected.querySelectorAll('.zai-model-chip-input').forEach((node: Element) => {
      const value = (node as HTMLInputElement).value.trim();
      if (value) values.push(value);
    });
    return values;
  };

  const sync = () => {
    const models = dedupe(currentModels());
    hidden.value = models.join('\n');
    refreshSuggestions();
    updatePresetSaveButton(doc);
  };

  const addChip = (value: string) => {
    const chip = el(doc, 'span', 'zai-model-chip');
    const model = input(doc, value);
    model.className = 'zai-model-chip-input';
    model.placeholder = '自定义模型 ID';
    model.addEventListener('input', sync);
    const remove = button(doc, '×');
    remove.className = 'zai-model-chip-remove';
    remove.title = '删除此模型';
    remove.addEventListener('click', () => {
      chip.remove();
      sync();
    });
    chip.append(model, remove);
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
    const customRow = el(doc, 'div', 'zai-model-custom-row');
    const custom = input(doc, '');
    custom.placeholder = '输入自定义模型 ID';
    const addCustom = button(doc, '+ 添加');
    const commitCustom = () => {
      addModel(custom.value);
      custom.value = '';
    };
    addCustom.addEventListener('click', commitCustom);
    custom.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      commitCustom();
    });
    customRow.append(custom, addCustom);

    const list = MODEL_SUGGESTIONS[suggestionKey] ?? [];
    if (list.length > 0) {
      side.append(el(doc, 'div', 'zai-model-side-title', suggestionTitle(suggestionKey)));
      const selectedModels = new Set(currentModels());
      const suggestions = el(doc, 'div', 'zai-model-suggestions');
      for (const model of list) {
        const pick = button(doc, selectedModels.has(model) ? `✓ ${model}` : `+ ${model}`);
        pick.disabled = selectedModels.has(model);
        pick.addEventListener('click', () => addModel(model));
        suggestions.append(pick);
      }
      side.append(suggestions);
    } else {
      side.append(el(doc, 'div', 'zai-model-side-title', '自定义模型'));
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
      suggestionKey = key;
      refreshSuggestions();
    },
  };
}

function suggestionTitle(key: ModelSuggestionKey): string {
  switch (key) {
    case 'openai':
      return 'OpenAI 预设模型';
    case 'claude':
      return 'Claude 预设模型';
    case 'deepseek':
      return 'DeepSeek 预设模型';
    case 'compat':
      return '自定义模型';
  }
}

function readPresetControls(doc: Document): ModelPreset[] {
  const previous = new Map(loadPresets(zoteroPrefs()).map((preset) => [preset.id, preset]));
  return Array.from(doc.querySelectorAll('.zai-preset-row')).map((row) => {
    const card = row as HTMLElement;
    const provider = controlValue(card, 'provider') === 'anthropic' ? 'anthropic' : 'openai';
    const models = splitList(controlValue(card, 'models'));
    const fallbackModel = DEFAULT_MODELS[provider];
    const model = models[0] || fallbackModel;
    const prior = previous.get(card.dataset.id ?? '');
    const extras = provider === 'openai'
      ? {
          ...(prior?.extras ?? {}),
          reasoningEffort: reasoningEffortValue(prior?.extras?.reasoningEffort),
          reasoningSummary: reasoningSummaryValue(controlValue(card, 'reasoningSummary')),
        }
      : {
          ...(prior?.extras ?? {}),
          vendor: vendorValue(controlValue(card, 'vendor'), prior?.extras?.vendor),
        };
    return {
      id: card.dataset.id || makeId('preset'),
      provider,
      label: controlValue(card, 'label') || (provider === 'anthropic' ? 'Claude' : 'GPT'),
      apiKey: controlValue(card, 'apiKey'),
      baseUrl: controlValue(card, 'baseUrl') || DEFAULT_BASE_URLS[provider],
      model,
      models: models.length ? models : model ? [model] : [],
      maxTokens: Number(controlValue(card, 'maxTokens')) || 8192,
      extras,
    };
  });
}

function vendorValue(
  raw: string,
  fallback: AnthropicVendor | undefined,
): AnthropicVendor {
  if (raw === 'claude' || raw === 'deepseek' || raw === 'compat') return raw;
  return fallback ?? 'compat';
}

async function savePresetControlsWithConnectivity(doc: Document): Promise<void> {
  const save = byID<HTMLButtonElement>(doc, 'zai-preset-save');
  const previous = loadPresets(zoteroPrefs());
  const rawPresets = readPresetControls(doc).filter(
    (preset) => preset.apiKey || preset.baseUrl || preset.model || preset.models?.length,
  );
  for (const preset of rawPresets) {
    if (!preset.apiKey.trim()) {
      setStatus(doc, 'zai-preset-status', `${preset.label} API Key 为空，未保存。`, true);
      return;
    }
    if (!preset.model.trim()) {
      setStatus(doc, 'zai-preset-status', `${preset.label} Model 为空，未保存。`, true);
      return;
    }
  }
  save?.setAttribute('disabled', 'true');
  try {
    savePresets(zoteroPrefs(), rawPresets);
    renderPresetRows(doc, loadPresets(zoteroPrefs()));
    renderTranslateSettings(doc);
    updatePresetSaveButton(doc);
    refreshSidebarPreferences();
    setStatus(doc, 'zai-preset-status', '账号配置已保存，侧边栏已刷新。');
  } catch (err) {
    setStatus(doc, 'zai-preset-status', sanitizedTestError(err, rawPresets), true);
  } finally {
    save?.removeAttribute('disabled');
  }
}

function attachPresetDirtyListeners(doc: Document): void {
  const controls = Array.from(
    doc.querySelectorAll(
      '.zai-preset-row input, .zai-preset-row textarea, .zai-preset-row select',
    ),
  ) as Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;
  for (const control of controls) {
    control.addEventListener('input', () => updatePresetSaveButton(doc));
    control.addEventListener('change', () => updatePresetSaveButton(doc));
  }
}

function updatePresetSaveButton(doc: Document): void {
  const save = byID<HTMLButtonElement>(doc, 'zai-preset-save');
  if (!save) return;
  const current = readPresetControls(doc).filter(
    (preset) => preset.apiKey || preset.baseUrl || preset.model || preset.models?.length,
  );
  const saved = loadPresets(zoteroPrefs());
  const changed = presetListSignature(current) !== presetListSignature(saved);
  const hasNew = current.some(
    (preset) => !saved.some((existing) => existing.id === preset.id),
  );
  save.disabled = !changed;
  save.textContent = '保存账号配置';
  save.title = changed ? '' : '账号配置没有新增或未保存改动';
}

function presetListSignature(presets: ModelPreset[]): string {
  return JSON.stringify(
    presets.map((preset) => ({
      id: preset.id,
      provider: preset.provider,
      label: preset.label,
      apiKey: preset.apiKey,
      baseUrl: preset.baseUrl,
      model: preset.model,
      models: preset.models ?? [],
      maxTokens: preset.maxTokens,
      extras: preset.extras ?? {},
    })),
  );
}

function presetConnectivitySignature(preset: ModelPreset): string {
  return JSON.stringify({
    provider: preset.provider,
    apiKey: preset.apiKey,
    baseUrl: preset.baseUrl,
    model: preset.model,
    maxTokens: preset.maxTokens,
    reasoningEffort: preset.extras?.reasoningEffort,
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
    if (preset.provider === 'openai') {
      return await testOpenAIConnectivity(preset, controller.signal);
    }
    const messages: Message[] = [{ role: 'user', content: 'Reply OK.' }];
    let sawAnyChunk = false;
    for await (const chunk of getProvider(preset).stream(
      messages,
      'Connectivity test. Reply with OK only.',
      { ...preset, maxTokens: Math.min(Math.max(preset.maxTokens || 256, 256), 512) },
      controller.signal,
    )) {
      if (chunk.type === 'error') throw new Error(chunk.message);
      sawAnyChunk = true;
      if (chunk.type === 'text_delta' || chunk.type === 'usage') break;
    }
    return {
      preset,
      message: sawAnyChunk
        ? `连接成功：${preset.provider} / ${preset.model}`
        : `连接完成：${preset.provider} / ${preset.model}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function testOpenAIConnectivity(
  preset: ModelPreset,
  signal: AbortSignal,
): Promise<{ message: string; preset: ModelPreset }> {
  const withMaxTokens = await requestOpenAIConnectivity(preset, signal, true);
  if (withMaxTokens.ok) {
    return {
      preset: withOpenAIChatCompletions(withOmitMaxOutputTokens(preset, false), false),
      message: `连接成功：${preset.provider} / ${preset.model}（支持 Max tokens）`,
    };
  }
  // 404 = endpoint doesn't exist; reasoning error = param unsupported → both mean Chat Completions only
  if (withMaxTokens.status === 404 || isReasoningUnsupported(withMaxTokens.body)) {
    const chatResult = await requestChatCompletionsConnectivity(preset, signal);
    if (!chatResult.ok) throw new Error(openAITestErrorMessage(chatResult));
    return {
      preset: withOpenAIChatCompletions(preset, true),
      message:
        `连接成功：${preset.provider} / ${preset.model}` +
        '（不支持 Responses API，已切换为 Chat Completions）',
    };
  }
  if (!isUnsupportedMaxOutputTokens(withMaxTokens.body)) {
    throw new Error(openAITestErrorMessage(withMaxTokens));
  }
  const withoutMaxTokens = await requestOpenAIConnectivity(preset, signal, false);
  if (!withoutMaxTokens.ok) throw new Error(openAITestErrorMessage(withoutMaxTokens));
  return {
    preset: withOpenAIChatCompletions(withOmitMaxOutputTokens(preset, true), false),
    message:
      `连接成功：${preset.provider} / ${preset.model}` +
      '（服务不支持 Max tokens，已保存为不发送）',
  };
}

type OpenAITestResult =
  | { ok: true }
  | { ok: false; status: number; body: string };

async function requestOpenAIConnectivity(
  preset: ModelPreset,
  signal: AbortSignal,
  includeMaxOutputTokens: boolean,
): Promise<OpenAITestResult> {
  const body = {
    model: preset.model,
    instructions: 'Connectivity test. Reply OK only.',
    input: [{ role: 'user', content: 'Reply OK.' }],
    ...(includeMaxOutputTokens ? { max_output_tokens: 256 } : {}),
    ...openAIResponsesReasoningBodyParam(preset),
    stream: true,
    store: false,
  };
  const response = await fetch(openAIResponsesUrl(preset.baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${preset.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });
  if (response.ok) {
    await response.body?.cancel();
    return { ok: true };
  }
  return { ok: false, status: response.status, body: await response.text() };
}

function openAIResponsesUrl(baseUrl: string): string {
  const root = baseUrl.trim() || 'https://api.openai.com/v1';
  return `${root.replace(/\/+$/, '')}/responses`;
}

function openAIResponsesReasoningBodyParam(
  preset: ModelPreset,
): {
  reasoning?: {
    effort: ReasoningEffort;
    summary?: Exclude<ReasoningSummary, 'none'>;
  };
} {
  if (!shouldSendOpenAIResponsesReasoning(preset)) return {};
  const summary = preset.extras?.reasoningSummary ?? DEFAULT_REASONING_SUMMARY;
  return {
    reasoning: {
      effort: preset.extras?.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
      ...(summary === 'none' ? {} : { summary }),
    },
  };
}

function shouldSendOpenAIResponsesReasoning(preset: ModelPreset): boolean {
  if (!isOfficialOpenAIEndpointForPreset(preset)) {
    return preset.extras?.omitResponsesReasoningForCache !== true;
  }
  return true;
}

function isOfficialOpenAIEndpointForPreset(preset: ModelPreset): boolean {
  const baseUrl = preset.baseUrl.trim();
  if (!baseUrl) return true;
  try {
    return new URL(baseUrl).hostname === 'api.openai.com';
  } catch {
    return false;
  }
}

function isUnsupportedMaxOutputTokens(body: string): boolean {
  return /unsupported parameter:\s*max_output_tokens|max_output_tokens.*unsupported/i.test(
    body,
  );
}

function isReasoningUnsupported(body: string): boolean {
  return /unsupported_parameter|unsupported parameter/i.test(body) &&
    /reasoning/i.test(body);
}

function withOpenAIChatCompletions(preset: ModelPreset, use: boolean): ModelPreset {
  const extras = { ...preset.extras };
  if (use) extras.openaiUseChatCompletions = true;
  else delete extras.openaiUseChatCompletions;
  return { ...preset, extras };
}

async function requestChatCompletionsConnectivity(
  preset: ModelPreset,
  signal: AbortSignal,
): Promise<OpenAITestResult> {
  const base = (preset.baseUrl.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${preset.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: preset.model,
      messages: [{ role: 'user', content: 'Reply OK.' }],
      max_tokens: 16,
      stream: false,
    }),
    signal,
  });
  if (response.ok) {
    await response.body?.cancel();
    return { ok: true };
  }
  return { ok: false, status: response.status, body: await response.text() };
}

function openAITestErrorMessage(
  result: Exclude<OpenAITestResult, { ok: true }>,
): string {
  return `HTTP ${result.status}: ${result.body || 'no body'}`;
}

function withOmitMaxOutputTokens(
  preset: ModelPreset,
  omit: boolean,
): ModelPreset {
  const extras = { ...preset.extras };
  if (omit) extras.omitMaxOutputTokens = true;
  else delete extras.omitMaxOutputTokens;
  return { ...preset, extras };
}

function sanitizedTestError(err: unknown, presets: ModelPreset[]): string {
  let message = err instanceof Error ? err.message : String(err);
  for (const preset of presets) {
    if (preset.apiKey) message = message.split(preset.apiKey).join('[API_KEY]');
  }
  if (message.toLowerCase().includes('abort')) return '连接超时或已取消，未保存。';
  return `连接失败：${message}。未保存。`;
}

function renderPromptSettings(doc: Document): void {
  const settings = loadQuickPromptSettings(zoteroPrefs());
  populateBuiltInPromptControls(doc, settings);
  const custom = byID<HTMLElement>(doc, 'zai-custom-prompts');
  custom?.replaceChildren();
  for (const buttonConfig of settings.customButtons) addCustomPromptRow(doc, buttonConfig);
  setStatus(doc, 'zai-prompt-status', '已加载提示词配置。');
}

function populateBuiltInPromptControls(
  doc: Document,
  settings: QuickPromptSettings,
): void {
  const wrap = byID<HTMLElement>(doc, 'zai-built-in-prompts');
  if (!wrap) return;
  wrap.replaceChildren(
    builtInPromptControl(doc, 'summary', '总结论文', settings.builtIns.summary, DEFAULT_QUICK_PROMPT_SETTINGS.builtIns.summary),
    builtInPromptControl(doc, 'readingRoute', '阅读路线', settings.builtIns.readingRoute, DEFAULT_QUICK_PROMPT_SETTINGS.builtIns.readingRoute),
    builtInPromptControl(doc, 'fullTextHighlight', '全文重点', settings.builtIns.fullTextHighlight, DEFAULT_QUICK_PROMPT_SETTINGS.builtIns.fullTextHighlight),
    builtInPromptControl(doc, 'explainSelection', '解释选区', settings.builtIns.explainSelection, DEFAULT_QUICK_PROMPT_SETTINGS.builtIns.explainSelection),
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
  const wrap = el(doc, 'div', 'zai-prompt-option');
  const checkbox = doc.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = 'zai-selection-question-annotation-enabled';
  checkbox.checked = enabled;
  checkbox.addEventListener('change', () => {
    const settings = loadQuickPromptSettings(zoteroPrefs());
    saveQuickPromptSettings(zoteroPrefs(), {
      ...settings,
      selectionQuestionAnnotationEnabled: checkbox.checked,
    });
    refreshSidebarPreferences();
    setStatus(
      doc,
      'zai-prompt-status',
      checkbox.checked
        ? '普通选区提问后会自动生成建议注释，已直接保存。'
        : '普通选区提问后不再自动生成建议注释，已直接保存。',
    );
  });
  const save = button(doc, '保存提示词/按钮');
  save.addEventListener('click', () => savePromptControls(doc));
  const head = el(doc, 'div', 'zai-prompt-option-head');
  head.append(
    labelWrap(doc, checkbox, '普通选区提问后生成建议注释'),
    save,
  );
  wrap.append(
    head,
    el(
      doc,
      'div',
      'zai-pref-help',
      '默认开启：选中文本后在对话框手动提问，AI 回完会附带「建议注释」卡片，下方可一键保存为「💾 高亮+评论」或「🅣 新增文字」(T 工具)。解释选区按钮始终会生成建议注释。开启时会参考 PDF 注释颜色预设推荐颜色。',
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
  const wrap = el(doc, 'div', 'zai-built-in-prompt');
  const head = el(doc, 'div', 'zai-prompt-head');
  const title = el(doc, 'span', 'zai-prompt-title');
  const state = el(doc, 'span', 'zai-prompt-default-state');
  title.append(el(doc, 'span', '', label), state);
  head.append(title);
  const reset = button(doc, '恢复内置默认');
  reset.title = '把当前编辑框恢复为这个插件版本内置的默认提示词；需要点击“保存提示词”才会生效。';
  const area = textarea(doc, value);
  area.dataset.prompt = field;
  area.dataset.savedValue = value;
  const updateState = () => {
    updatePromptDefaultState(area, state, defaultValue);
  };
  reset.addEventListener('click', () => {
    area.value = defaultValue;
    updateState();
    setStatus(
      doc,
      'zai-prompt-status',
      `${label} 已填入当前插件内置默认；点击“保存提示词”后才会更新本地生效。`,
    );
  });
  area.addEventListener('input', updateState);
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
  const savedValue = area.dataset.savedValue ?? '';
  const current = area.value;
  const nextState =
    current !== savedValue ? 'dirty' : current === defaultValue ? 'default' : 'custom';
  const label =
    nextState === 'dirty'
      ? '编辑未保存'
      : nextState === 'default'
        ? '本地=内置默认'
        : '本地已自定义';
  const title =
    nextState === 'dirty'
      ? '当前编辑框内容还没有保存；点击“保存提示词”后才会成为本地提示词。'
      : nextState === 'default'
        ? '已保存的本地提示词与当前插件内置默认一致。'
        : '已保存的本地提示词不同于当前插件内置默认；点击“恢复内置默认”可改回。';
  state.textContent = label;
  state.dataset.state = nextState;
  state.title = title;
}

function addCustomPromptRow(
  doc: Document,
  config: { id: string; label: string; prompt: string; shortcut?: string },
): void {
  const list = byID<HTMLElement>(doc, 'zai-custom-prompts');
  if (!list) return;
  const card = el(doc, 'div', 'zai-subcard zai-custom-prompt-row');
  card.dataset.id = config.id;
  const title = el(doc, 'div', 'zai-subcard-title');
  title.append(el(doc, 'span', '', '自定义提示'));
  const remove = button(doc, '删除');
  remove.addEventListener('click', () => card.remove());
  title.append(remove);
  const label = input(doc, config.label);
  label.dataset.field = 'label';
  label.placeholder = '留空则只作为快捷键';
  const shortcut = input(doc, config.shortcut ?? '');
  shortcut.dataset.field = 'shortcut';
  shortcut.maxLength = 1;
  shortcut.placeholder = '例如：t';
  shortcut.title = '焦点在 PDF Reader 时按这个单键触发；支持 a-z / 0-9。';
  const prompt = textarea(doc, config.prompt);
  prompt.dataset.field = 'prompt';
  card.append(
    title,
    compactPromptFields(doc, label, shortcut),
    compactPromptField(doc, '提示词', prompt, true),
  );
  list.append(card);
}

function compactPromptFields(
  doc: Document,
  label: HTMLElement,
  shortcut: HTMLElement,
): HTMLElement {
  const wrap = el(doc, 'div', 'zai-custom-prompt-fields');
  wrap.append(
    compactPromptField(doc, '按钮名称（可空）', label),
    compactPromptField(doc, 'PDF 快捷键', shortcut),
  );
  return wrap;
}

function compactPromptField(
  doc: Document,
  label: string,
  control: HTMLElement,
  full = false,
): HTMLElement {
  const wrap = el(doc, 'div', 'zai-custom-prompt-field');
  if (full) wrap.classList.add('zai-custom-prompt-full');
  wrap.append(el(doc, 'label', '', label), control);
  return wrap;
}

function savePromptControls(doc: Document, okMessage = '提示词已保存，侧边栏按钮立即刷新。'): void {
  const result = readPromptControls(doc);
  if (typeof result === 'string') {
    setStatus(doc, 'zai-prompt-status', result, true);
    return;
  }
  saveQuickPromptSettings(zoteroPrefs(), result);
  renderPromptSettings(doc);
  refreshSidebarPreferences();
  setStatus(
    doc,
    'zai-prompt-status',
    `${okMessage} 当前自定义按钮：${customPromptLabels(result)}`,
  );
  flashButton(byID<HTMLButtonElement>(doc, 'zai-prompt-save'), '已保存');
}

function readPromptControls(doc: Document): QuickPromptSettings | string {
  const summary = promptText(doc, 'summary');
  const readingRoute = promptText(doc, 'readingRoute');
  const fullTextHighlight = promptText(doc, 'fullTextHighlight');
  const explainSelection = promptText(doc, 'explainSelection');
  if (!summary || !readingRoute || !fullTextHighlight || !explainSelection) {
    return '内置快捷按钮的提示词不能为空。';
  }
  const selectionQuestionAnnotationEnabled =
    byID<HTMLInputElement>(doc, 'zai-selection-question-annotation-enabled')
      ?.checked === true;
  const customButtons = [];
  for (const node of Array.from(doc.querySelectorAll('.zai-custom-prompt-row'))) {
    const row = node as HTMLElement;
    const label = controlValue(row, 'label');
    const shortcut = controlValue(row, 'shortcut');
    const prompt = controlValue(row, 'prompt');
    if (!label && !shortcut && !prompt) continue;
    if (!prompt) return '自定义提示必须填写提示词。';
    if (!label && !shortcut)
      return '自定义提示至少填写按钮名称或 PDF 快捷键。';
    customButtons.push({
      id: row.dataset.id || makeId('prompt'),
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
        .map((button) =>
          button.label || `快捷键 ${button.shortcut?.toUpperCase()}`,
        )
        .join('、')
    : '无';
}

function renderToolSettings(doc: Document): void {
  const settings = loadToolSettings(zoteroPrefs());
  const webSearch = byID<HTMLSelectElement>(doc, 'zai-tool-web-search');
  if (webSearch) webSearch.value = settings.webSearchMode;
  const colorGuide = byID<HTMLTextAreaElement>(
    doc,
    'zai-tool-annotation-color-guide',
  );
  if (colorGuide) colorGuide.value = settings.annotationColorGuide;
  const fontSize = byID<HTMLInputElement>(doc, 'zai-tool-text-annotation-font-size');
  if (fontSize) fontSize.value = String(settings.textAnnotationFontSize);
  const list = byID<HTMLElement>(doc, 'zai-mcp-list');
  list?.replaceChildren();
  for (const server of settings.mcpServers ?? []) addMcpRow(doc, server);
  setStatus(doc, 'zai-tool-status', '已加载联网/MCP配置。');
}

function addMcpRow(doc: Document, server: McpServerSettings): void {
  const list = byID<HTMLElement>(doc, 'zai-mcp-list');
  if (!list) return;
  const card = el(doc, 'div', 'zai-subcard zai-mcp-row');
  card.dataset.id = server.id;
  const title = el(doc, 'div', 'zai-subcard-title');
  const enabled = doc.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = server.enabled;
  enabled.dataset.field = 'enabled';
  title.append(el(doc, 'span', '', 'MCP Server'), labelWrap(doc, enabled, '启用'));
  const remove = button(doc, '删除');
  remove.addEventListener('click', () => card.remove());
  title.append(remove);
  const serverLabel = input(doc, server.serverLabel);
  serverLabel.dataset.field = 'serverLabel';
  const serverUrl = input(doc, server.serverUrl);
  serverUrl.dataset.field = 'serverUrl';
  const allowedTools = input(doc, server.allowedTools.join(', '));
  allowedTools.dataset.field = 'allowedTools';
  allowedTools.placeholder = '留空表示不限制工具；或填写 search, read_pdf';
  const approval = select(doc, [
    ['never', 'Never - 不需要审批'],
    ['always', 'Always - 请求审批'],
  ], server.requireApproval);
  approval.dataset.field = 'requireApproval';
  card.append(
    title,
    grid(doc, [
      ['Label', serverLabel],
      ['Server URL', serverUrl],
      ['Allowed tools', allowedTools],
      ['Approval', approval],
    ]),
  );
  list.append(card);
}

function readToolSettingsControls(doc: Document): ToolSettings {
  const existing = loadToolSettings(zoteroPrefs());
  const webSearch = byID<HTMLSelectElement>(doc, 'zai-tool-web-search');
  const mcpServers: McpServerSettings[] = [];
  for (const node of Array.from(doc.querySelectorAll('.zai-mcp-row'))) {
    const row = node as HTMLElement;
    const serverLabel = controlValue(row, 'serverLabel') || 'mcp';
    const serverUrl = controlValue(row, 'serverUrl');
    const enabled = checkboxValue(row, 'enabled');
    if (!serverLabel && !serverUrl) continue;
    mcpServers.push({
      id: row.dataset.id || makeId('mcp'),
      enabled,
      serverLabel,
      serverUrl,
      allowedTools: splitList(controlValue(row, 'allowedTools')),
      requireApproval: approvalValue(controlValue(row, 'requireApproval')),
    });
  }
  return {
    ...existing,
    webSearchMode: webSearchModeValue(webSearch?.value ?? 'disabled'),
    annotationColorGuide:
      byID<HTMLTextAreaElement>(doc, 'zai-tool-annotation-color-guide')?.value ??
      existing.annotationColorGuide,
    textAnnotationFontSize: Number(
      byID<HTMLInputElement>(doc, 'zai-tool-text-annotation-font-size')?.value ??
        existing.textAnnotationFontSize,
    ),
    mcpServers,
  };
}

function promptText(doc: Document, key: string): string {
  const area = doc.querySelector(`textarea[data-prompt="${key}"]`) as HTMLTextAreaElement | null;
  return area?.value.trim() ?? '';
}

function controlValue(root: ParentNode, field: string): string {
  const control = root.querySelector(`[data-field="${field}"]`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  return control?.value.trim() ?? '';
}

// Toggle a labeled grid row by hiding both the control and its preceding
// <label>. The grid pairs label+control as siblings, so the row is
// `previousElementSibling` (the label) plus the control itself.
function setRowVisible(control: HTMLElement, visible: boolean): void {
  control.style.display = visible ? '' : 'none';
  const label = control.previousElementSibling as HTMLElement | null;
  if (label && label.tagName.toLowerCase() === 'label') {
    label.style.display = visible ? '' : 'none';
  }
}

function checkboxValue(root: ParentNode, field: string): boolean {
  const control = root.querySelector(`[data-field="${field}"]`) as HTMLInputElement | null;
  return !!control?.checked;
}

function webSearchModeValue(value: string): WebSearchMode {
  return value === 'cached' || value === 'live' ? value : 'disabled';
}

function approvalValue(value: string): McpApprovalMode {
  return value === 'always' ? 'always' : 'never';
}

function reasoningEffortValue(value: unknown): ReasoningEffort {
  return typeof value === 'string' && ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(value)
    ? (value as ReasoningEffort)
    : DEFAULT_REASONING_EFFORT;
}

function reasoningSummaryValue(value: string): ReasoningSummary {
  return ['auto', 'concise', 'detailed', 'none'].includes(value)
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
    id: makeId('preset'),
    provider,
    label: provider === 'anthropic' ? 'Claude' : 'GPT',
    apiKey: '',
    baseUrl: DEFAULT_BASE_URLS[provider],
    model,
    models: model ? [model] : [],
    maxTokens: 8192,
    extras: provider === 'openai'
      ? {
          reasoningEffort: DEFAULT_REASONING_EFFORT,
          reasoningSummary: DEFAULT_REASONING_SUMMARY,
          agentPermissionMode: 'default',
        }
      : { agentPermissionMode: 'default' },
  };
}

function grid(doc: Document, rows: Array<[string | HTMLElement, HTMLElement]>): HTMLElement {
  const wrap = el(doc, 'div', 'zai-pref-grid');
  for (const [labelSpec, control] of rows) {
    const labelEl = typeof labelSpec === 'string' ? el(doc, 'label', '', labelSpec) : labelSpec;
    wrap.append(labelEl, control);
  }
  return wrap;
}

function labelWrap(doc: Document, control: HTMLElement, text: string): HTMLElement {
  const label = el(doc, 'label', 'zai-inline');
  label.append(control, doc.createTextNode(text));
  return label;
}

function input(doc: Document, value: string, type = 'text'): HTMLInputElement {
  const node = doc.createElement('input');
  node.type = type;
  node.value = value;
  return node;
}

function textarea(doc: Document, value: string): HTMLTextAreaElement {
  const node = doc.createElement('textarea');
  node.value = value;
  return node;
}

function select<T extends string>(
  doc: Document,
  options: Array<[T, string]>,
  value: string,
): HTMLSelectElement {
  const node = doc.createElement('select');
  for (const [optionValue, label] of options) {
    const option = doc.createElement('option');
    option.value = optionValue;
    option.textContent = label;
    node.append(option);
  }
  node.value = value;
  return node;
}

function option(doc: Document, value: string, label: string): HTMLOptionElement {
  const node = doc.createElement('option');
  node.value = value;
  node.textContent = label;
  return node;
}

function button(doc: Document, text: string): HTMLButtonElement {
  const node = doc.createElement('button');
  node.type = 'button';
  node.textContent = text;
  return node;
}

function el(
  doc: Document,
  tag: string,
  className = '',
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
  status.classList.toggle('zai-danger', danger);
}

function flashButton(button: HTMLButtonElement | null, text: string): void {
  if (!button) return;
  const original = button.textContent ?? '';
  button.textContent = text;
  button.ownerDocument?.defaultView?.setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function byID<T extends HTMLElement>(doc: Document, id: string): T | null {
  return doc.getElementById(id) as T | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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
