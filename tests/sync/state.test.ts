import { beforeEach, describe, expect, it } from 'vitest';
import type { PrefsStore } from '../../src/settings/storage';
import {
  loadTranslateSettings,
  saveTranslateSettings,
} from '../../src/translate/settings';
import { DEFAULT_TRANSLATE_SETTINGS } from '../../src/settings/types';
import { savePresets } from '../../src/settings/storage';
import { saveQuickPromptSettings } from '../../src/settings/quick-prompts';
import { saveToolSettings } from '../../src/settings/tool-settings';
import { saveUiSettings } from '../../src/settings/ui-settings';
import {
  DEFAULT_LOCAL_UI_SETTINGS,
  saveLocalUiSettings,
} from '../../src/settings/local-ui-settings';
import {
  applySyncSnapshot,
  buildSyncSnapshot,
  parseSyncSnapshot,
  SYNC_SCHEMA,
} from '../../src/sync/state';
import { loadPresets } from '../../src/settings/storage';
import { loadQuickPromptSettings } from '../../src/settings/quick-prompts';
import { loadToolSettings } from '../../src/settings/tool-settings';
import { loadUiSettings } from '../../src/settings/ui-settings';
import {
  loadChatConversations,
  loadChatMessages,
  saveChatConversations,
  saveChatMessages,
} from '../../src/settings/chat-history';
import {
  getCachedTranslation,
  setCachedTranslation,
  translateCachePath,
} from '../../src/translate/cache';

function memPrefs(): PrefsStore {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key),
    set: (key, value) => map.set(key, value),
  };
}

let files: Map<string, string>;

beforeEach(() => {
  files = new Map();
  Object.defineProperty(globalThis, 'Zotero', {
    configurable: true,
    value: {
      DataDirectory: { dir: '/tmp/zotero-data' },
      Profile: { dir: '/tmp/zotero-profile' },
      File: {
        getContentsAsync: async (path: string) => {
          const value = files.get(path);
          if (value == null) throw new Error(`missing file: ${path}`);
          return value;
        },
        putContentsAsync: async (_path: string, contents: string) => {
          files.set(_path, contents);
        },
      },
      Items: {
        get: (id: number) =>
          id === 42
            ? { key: 'AAAA1111', libraryID: 1, id: 42 }
            : id === 99
              ? { key: 'BBBB2222', libraryID: 1, id: 99 }
              : false,
        getByLibraryAndKey: (libraryID: number, key: string) => {
          if (libraryID !== 1) return false;
          if (key === 'AAAA1111') return { key, libraryID, id: 42 };
          if (key === 'BBBB2222') return { key, libraryID, id: 99 };
          return false;
        },
        // Empty library by default — annotation tests live in their own
        // file with their own Zotero stub.
        getAll: () => [],
        getAsync: async () => null,
      },
      Libraries: {
        get: (libraryID: number) =>
          libraryID === 1 ? { libraryType: 'user', id: 1 } : undefined,
        userLibraryID: 1,
      },
      Groups: {
        get: () => false,
        getAll: () => [],
      },
      Annotations: {
        saveFromJSON: async () => ({ id: 0, key: '' }),
      },
    },
  });
});

describe('sync snapshot round trip', () => {
  it('builds a snapshot with syncable settings, chat history, and translate cache', async () => {
    const prefs = memPrefs();
    savePresets(prefs, [
      {
        id: 'preset-1',
        label: 'GPT',
        provider: 'openai',
        apiKey: 'sk-xxx',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.1',
        models: ['gpt-5.1'],
        maxTokens: 8192,
        extras: {
          reasoningEffort: 'medium',
          reasoningSummary: 'auto',
          agentPermissionMode: 'default',
        },
      },
    ]);
    saveUiSettings(prefs, {
      messageActionsPosition: 'bottom-right',
      messageActionsLayout: 'edge',
      preferenceBorderStyle: 'soft',
      chatFontFamily: 'Noto Serif CJK SC, serif',
      userProfile: { label: 'me', avatar: '🙂' },
      assistantProfile: { label: 'ai', avatar: '🤖' },
      composerQueueWhileSending: true,
    });
    saveQuickPromptSettings(prefs, {
      builtIns: {
        summary: 'sum',
        readingRoute: 'route',
        fullTextHighlight: 'highlight',
        explainSelection: 'explain',
      },
      selectionQuestionAnnotationEnabled: true,
      customButtons: [{ id: 'a', label: 'A', prompt: 'do A', shortcut: 't' }],
    });
    saveToolSettings(prefs, {
      webSearchMode: 'live',
      mcpServers: [],
      textAnnotationFontSize: 22,
      arxivMcp: {
        enabled: false,
        serverLabel: 'arxiv',
        serverUrl: '',
        allowedTools: ['search'],
        requireApproval: 'never',
      },
    });
    saveLocalUiSettings(prefs, {
      ...DEFAULT_LOCAL_UI_SETTINGS,
      chatFontSizePx: 18,
    });
    await saveChatMessages(42, [
      {
        role: 'user',
        content: 'hello',
        task: {
          id: 'task-local',
          kind: 'selection',
          title: '选中文字提问',
          promptPreview: 'hello',
          createdAt: 1,
          completedAt: 2,
        },
      },
      { role: 'assistant', content: 'hi there' },
    ]);
    await setCachedTranslation('translate-key', {
      text: '你好。',
      model: 'gpt-5.4',
      createdAt: 1000,
    });

    const snapshot = await buildSyncSnapshot(prefs);
    expect(snapshot.schema).toBe(SYNC_SCHEMA);
    expect(snapshot.presets).toHaveLength(1);
    expect(snapshot.uiSettings.messageActionsPosition).toBe('bottom-right');
    expect(snapshot.uiSettings.chatFontFamily).toBe('Noto Serif CJK SC, serif');
    expect(snapshot).not.toHaveProperty('localUiSettings');
    expect(JSON.stringify(snapshot)).not.toContain('chatFontSizePx');
    expect(snapshot.quickPrompts.customButtons).toHaveLength(1);
    expect(snapshot.quickPrompts.customButtons[0].shortcut).toBe('t');
    expect(snapshot.quickPrompts.selectionQuestionAnnotationEnabled).toBe(true);
    expect(snapshot.toolSettings.webSearchMode).toBe('live');
    expect(snapshot.toolSettings.textAnnotationFontSize).toBe(22);
    expect(snapshot.uiSettings.composerQueueWhileSending).toBe(true);
    expect(snapshot.threads).toHaveLength(1);
    expect(snapshot.threads?.[0].itemKey).toBe('AAAA1111');
    expect(JSON.stringify(snapshot)).toContain('hi there');
    expect(snapshot.translateCache?.entries['translate-key']?.text).toBe(
      '你好。',
    );
    expect(snapshot.annotations).toEqual([]);
  });

  it('parses, applies, and re-loads the same state on a fresh prefs store', async () => {
    const sourcePrefs = memPrefs();
    saveUiSettings(sourcePrefs, {
      messageActionsPosition: 'top-right',
      messageActionsLayout: 'inside',
      preferenceBorderStyle: 'clear',
      chatFontFamily: 'LXGW WenKai, serif',
      userProfile: { label: 'YOU', avatar: '' },
      assistantProfile: { label: 'AI', avatar: '' },
      composerQueueWhileSending: true,
    });
    saveToolSettings(sourcePrefs, {
      ...loadToolSettings(sourcePrefs),
      textAnnotationFontSize: 24,
    });
    const snapshot = await buildSyncSnapshot(sourcePrefs);
    const json = JSON.stringify(snapshot);

    const targetPrefs = memPrefs();
    const parsed = parseSyncSnapshot(json);
    const result = await applySyncSnapshot(targetPrefs, parsed);

    expect(result.annotations.imported).toBe(0);
    expect(result.threads.imported).toBe(0);
    expect(result.translateCache.imported).toBe(0);
    expect(loadUiSettings(targetPrefs).messageActionsPosition).toBe(
      'top-right',
    );
    expect(loadUiSettings(targetPrefs).chatFontFamily).toBe(
      'LXGW WenKai, serif',
    );
    expect(loadPresets(targetPrefs)).toEqual([]);
    expect(loadQuickPromptSettings(targetPrefs).builtIns.summary).toBeTruthy();
    expect(loadToolSettings(targetPrefs).webSearchMode).toBe('disabled');
    expect(loadToolSettings(targetPrefs).textAnnotationFontSize).toBe(24);
    expect(loadUiSettings(targetPrefs).composerQueueWhileSending).toBe(true);
  });

  it('rejects a snapshot with the wrong schema', () => {
    expect(() => parseSyncSnapshot('{"schema":"other"}')).toThrow(/schema/);
  });

  it('rejects unparseable JSON', () => {
    expect(() => parseSyncSnapshot('not json')).toThrow(/解析/);
  });

  it('imports portable chat threads by Zotero item key', async () => {
    const json = JSON.stringify({
      schema: SYNC_SCHEMA,
      exportedAt: '2026-05-02T00:00:00Z',
      presets: [],
      uiSettings: {},
      quickPrompts: {},
      toolSettings: {},
      threads: [
        {
          libraryType: 'user',
          itemKey: 'AAAA1111',
          updatedAt: '2026-05-02T00:00:00Z',
          messages: [
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'hi there' },
          ],
        },
      ],
    });
    const prefs = memPrefs();
    const result = await applySyncSnapshot(prefs, parseSyncSnapshot(json));
    expect(result.annotations.imported).toBe(0);
    expect(result.threads.imported).toBe(1);
    expect(result.threads.unresolved).toBe(0);
    expect((await loadChatMessages(42))[1]?.content).toBe('hi there');
  });

  it('merges cloud chat threads without deleting local-only messages', async () => {
    await saveChatMessages(42, [
      { role: 'user', content: 'local question' },
      { role: 'assistant', content: 'local answer' },
    ]);
    const json = JSON.stringify({
      schema: SYNC_SCHEMA,
      exportedAt: '2026-05-02T00:00:00Z',
      presets: [],
      uiSettings: {},
      quickPrompts: {},
      toolSettings: {},
      threads: [
        {
          libraryType: 'user',
          itemKey: 'AAAA1111',
          updatedAt: '2026-05-02T00:00:00Z',
          messages: [
            { role: 'user', content: 'cloud question' },
            { role: 'assistant', content: 'cloud answer' },
          ],
        },
      ],
    });
    const result = await applySyncSnapshot(memPrefs(), parseSyncSnapshot(json));
    const messages = await loadChatMessages(42);
    expect(result.threads.imported).toBe(1);
    expect(messages.map((message) => message.content)).toEqual([
      'local question',
      'local answer',
      'cloud question',
      'cloud answer',
    ]);
  });

  it('keeps multiple conversations for the same Zotero item separate', async () => {
    const json = JSON.stringify({
      schema: SYNC_SCHEMA,
      exportedAt: '2026-08-10T00:00:00Z',
      presets: [],
      uiSettings: {},
      quickPrompts: {},
      toolSettings: {},
      threads: [
        {
          libraryType: 'user',
          itemKey: 'AAAA1111',
          conversationID: 'summary',
          title: '论文总结',
          historyMode: 'previous',
          draftText: '',
          active: false,
          createdAt: '2026-08-09T00:00:00Z',
          updatedAt: '2026-08-10T00:00:00Z',
          messages: [
            { role: 'user', content: '总结论文' },
            { role: 'assistant', content: '总结结果' },
          ],
        },
        {
          libraryType: 'user',
          itemKey: 'AAAA1111',
          conversationID: 'temporary',
          title: '临时问题',
          presetID: 'preset-2',
          historyMode: 'none',
          draftText: '尚未发送的问题',
          active: true,
          createdAt: '2026-08-10T00:00:00Z',
          updatedAt: '2026-08-10T00:00:00Z',
          messages: [],
        },
      ],
    });

    const result = await applySyncSnapshot(memPrefs(), parseSyncSnapshot(json));
    const workspace = await loadChatConversations(42);

    expect(result.threads.imported).toBe(2);
    expect(workspace.activeConversationID).toBe('temporary');
    expect(workspace.conversations).toHaveLength(2);
    expect(workspace.conversations[0].messages[1]?.content).toBe('总结结果');
    expect(workspace.conversations[1]).toMatchObject({
      id: 'temporary',
      presetID: 'preset-2',
      draftText: '尚未发送的问题',
      historyMode: 'none',
      messages: [],
    });
  });

  it('exports every conversation with its active and history settings', async () => {
    await saveChatConversations(42, {
      activeConversationID: 'second',
      conversations: [
        {
          id: 'first',
          title: '第一组',
          createdAt: '2026-08-09T00:00:00Z',
          updatedAt: '2026-08-09T01:00:00Z',
          messages: [{ role: 'user', content: 'first' }],
          draftText: '',
          historyMode: 'all',
        },
        {
          id: 'second',
          title: '第二组',
          createdAt: '2026-08-10T00:00:00Z',
          updatedAt: '2026-08-10T01:00:00Z',
          messages: [],
          presetID: 'preset-2',
          draftText: 'draft',
          historyMode: 'none',
        },
      ],
    });

    const snapshot = await buildSyncSnapshot(memPrefs());

    expect(snapshot.threads).toHaveLength(2);
    expect(snapshot.threads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conversationID: 'first',
          active: false,
          historyMode: 'all',
        }),
        expect.objectContaining({
          conversationID: 'second',
          active: true,
          presetID: 'preset-2',
          draftText: 'draft',
          historyMode: 'none',
          messages: [],
        }),
      ]),
    );
  });

  it('counts unresolved chat threads when the Zotero item is not local yet', async () => {
    const json = JSON.stringify({
      schema: SYNC_SCHEMA,
      exportedAt: '2026-05-02T00:00:00Z',
      presets: [],
      uiSettings: {},
      quickPrompts: {},
      toolSettings: {},
      threads: [
        {
          libraryType: 'user',
          itemKey: 'ZZZZ9999',
          updatedAt: '2026-05-02T00:00:00Z',
          messages: [{ role: 'user', content: 'orphan' }],
        },
      ],
    });
    const prefs = memPrefs();
    const result = await applySyncSnapshot(prefs, parseSyncSnapshot(json));
    expect(result.threads.imported).toBe(0);
    expect(result.threads.unresolved).toBe(1);
  });

  it('round-trips translateSettings and translateCache', async () => {
    const prefs = memPrefs();
    saveTranslateSettings(prefs, {
      ...DEFAULT_TRANSLATE_SETTINGS,
      enabled: true,
      presetId: 'gpt-preset',
      model: 'gpt-5.4',
      thinking: 'medium',
      ctxLevel: 'none',
      overlayPosition: 'below',
      overlaySize: 'adaptive',
      triggerMode: 'double',
      nextSentenceKey: 'Alt+N',
      prevSentenceKey: 'Alt+P',
    });
    await setCachedTranslation('cache-key', {
      text: '缓存译文',
      model: 'gpt-5.4',
      createdAt: 2000,
    });
    const snap = await buildSyncSnapshot(prefs);
    const json = JSON.stringify(snap);
    const reparsed = parseSyncSnapshot(json);
    expect(reparsed.translateSettings?.enabled).toBe(true);
    expect(reparsed.translateSettings?.model).toBe('gpt-5.4');
    expect(reparsed.translateSettings?.thinking).toBe('medium');
    expect(reparsed.translateSettings?.ctxLevel).toBe('none');
    expect(reparsed.translateSettings?.overlayPosition).toBe('below');
    expect(reparsed.translateSettings?.overlaySize).toBe('adaptive');
    expect(reparsed.translateSettings?.triggerMode).toBe('double');
    expect(reparsed.translateSettings?.nextSentenceKey).toBe('Alt+N');
    expect(reparsed.translateSettings?.prevSentenceKey).toBe('Alt+P');
    expect(reparsed.translateCache?.entries['cache-key']?.text).toBe(
      '缓存译文',
    );

    const targetPrefs = memPrefs();
    files = new Map();
    await applySyncSnapshot(targetPrefs, reparsed);
    const pulled = loadTranslateSettings(targetPrefs);
    expect(pulled.presetId).toBe('gpt-preset');
    expect(pulled.model).toBe('gpt-5.4');
    expect(pulled.thinking).toBe('medium');
    expect(pulled.ctxLevel).toBe('none');
    expect(pulled.overlayPosition).toBe('below');
    expect(pulled.overlaySize).toBe('adaptive');
    expect(pulled.triggerMode).toBe('double');
    expect(pulled.nextSentenceKey).toBe('Alt+N');
    expect(pulled.prevSentenceKey).toBe('Alt+P');
    expect((await getCachedTranslation('cache-key'))?.text).toBe('缓存译文');
    expect(files.has(translateCachePath())).toBe(true);
  });

  it('accepts snapshots missing translate fields (back-compat)', () => {
    const json = JSON.stringify({
      schema: SYNC_SCHEMA,
      exportedAt: '',
      presets: [],
      uiSettings: {},
      quickPrompts: {},
      toolSettings: {},
      annotations: [],
    });
    const snap = parseSyncSnapshot(json);
    expect(snap.translateSettings).toBeUndefined();
    expect(snap.threads).toEqual([]);
    expect(snap.translateCache?.entries).toEqual({});
  });
});
