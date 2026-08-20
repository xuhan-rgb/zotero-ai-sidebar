import { describe, expect, it } from 'vitest';
import type { PrefsStore } from '../../src/settings/storage';
import {
  DEFAULT_UI_SETTINGS,
  loadUiSettings,
  saveUiSettings,
} from '../../src/settings/ui-settings';

function memPrefs(): PrefsStore {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key),
    set: (key, value) => map.set(key, value),
  };
}

describe('ui settings storage', () => {
  it('returns defaults for missing or invalid settings', () => {
    expect(loadUiSettings(memPrefs())).toEqual(DEFAULT_UI_SETTINGS);
    const prefs = memPrefs();
    prefs.set('extensions.zotero-ai-sidebar.uiSettings', '{bad');
    expect(loadUiSettings(prefs)).toEqual(DEFAULT_UI_SETTINGS);
  });

  it('round trips profiles and action position', () => {
    const prefs = memPrefs();
    saveUiSettings(prefs, {
      messageActionsPosition: 'top-right',
      messageActionsLayout: 'inside',
      preferenceBorderStyle: 'clear',
      chatFontFamily: '"LXGW WenKai", serif',
      userProfile: { label: '我', avatar: '🙂' },
      assistantProfile: { label: '助手', avatar: 'https://example.test/ai.png' },
      assistantSignatures: [
        'Why am I reading this paper? Keep the question in sight.',
        'Answers can be borrowed, but the thinking must be your own.',
      ],
      assistantSignaturesEnabled: true,
      composerQueueWhileSending: true,
      confirmConversationDeletion: false,
      maxParallelConversations: 6,
    });

    expect(loadUiSettings(prefs)).toEqual({
      messageActionsPosition: 'top-right',
      messageActionsLayout: 'inside',
      preferenceBorderStyle: 'clear',
      chatFontFamily: '"LXGW WenKai", serif',
      userProfile: { label: '我', avatar: '🙂' },
      assistantProfile: { label: '助手', avatar: 'https://example.test/ai.png' },
      assistantSignatures: [
        'Why am I reading this paper? Keep the question in sight.',
        'Answers can be borrowed, but the thinking must be your own.',
      ],
      assistantSignaturesEnabled: true,
      composerQueueWhileSending: true,
      confirmConversationDeletion: false,
      maxParallelConversations: 6,
    });
  });

  it('defaults to two parallel conversations and clamps the configured limit', () => {
    expect(loadUiSettings(memPrefs()).maxParallelConversations).toBe(2);
    const prefs = memPrefs();
    prefs.set(
      'extensions.zotero-ai-sidebar.uiSettings',
      JSON.stringify({ maxParallelConversations: 99 }),
    );
    expect(loadUiSettings(prefs).maxParallelConversations).toBe(8);
    prefs.set(
      'extensions.zotero-ai-sidebar.uiSettings',
      JSON.stringify({ maxParallelConversations: 0 }),
    );
    expect(loadUiSettings(prefs).maxParallelConversations).toBe(1);
  });

  it('deletes without confirmation by default and persists an explicit opt-in', () => {
    expect(loadUiSettings(memPrefs()).confirmConversationDeletion).toBe(false);
    const prefs = memPrefs();
    saveUiSettings(prefs, {
      ...DEFAULT_UI_SETTINGS,
      confirmConversationDeletion: true,
    });
    expect(loadUiSettings(prefs).confirmConversationDeletion).toBe(true);
  });

  it('treats only an explicit `true` as enabling composerQueueWhileSending', () => {
    const prefs = memPrefs();
    prefs.set(
      'extensions.zotero-ai-sidebar.uiSettings',
      JSON.stringify({ composerQueueWhileSending: 'truthy-but-not-true' }),
    );
    expect(loadUiSettings(prefs).composerQueueWhileSending).toBe(false);

    prefs.set(
      'extensions.zotero-ai-sidebar.uiSettings',
      JSON.stringify({ composerQueueWhileSending: true }),
    );
    expect(loadUiSettings(prefs).composerQueueWhileSending).toBe(true);

    expect(loadUiSettings(memPrefs()).composerQueueWhileSending).toBe(false);
  });

  it('normalizes chat font family values', () => {
    const prefs = memPrefs();
    saveUiSettings(prefs, {
      ...DEFAULT_UI_SETTINGS,
      chatFontFamily: ' Noto Serif CJK SC, serif ',
    });

    expect(loadUiSettings(prefs).chatFontFamily).toBe(
      'Noto Serif CJK SC, serif',
    );

    prefs.set(
      'extensions.zotero-ai-sidebar.uiSettings',
      JSON.stringify({ chatFontFamily: 'safe; color:red' }),
    );
    expect(loadUiSettings(prefs).chatFontFamily).toBe('');
  });

  it('falls back to the soft preference border style for unknown values', () => {
    const prefs = memPrefs();
    prefs.set(
      'extensions.zotero-ai-sidebar.uiSettings',
      JSON.stringify({ preferenceBorderStyle: 'high-contrast' }),
    );
    expect(loadUiSettings(prefs).preferenceBorderStyle).toBe('soft');
  });

  it('adds the default signature list to settings saved by an older version', () => {
    const prefs = memPrefs();
    prefs.set(
      'extensions.zotero-ai-sidebar.uiSettings',
      JSON.stringify({
        userProfile: { label: '我', avatar: '' },
        assistantProfile: { label: 'AI', avatar: '' },
      }),
    );

    expect(loadUiSettings(prefs).assistantSignatures).toEqual([
      'Why am I reading this paper? Keep the question in sight.',
      'Answers can be borrowed, but the thinking must be your own.',
    ]);
    expect(loadUiSettings(prefs).assistantSignaturesEnabled).toBe(true);
  });

  it('preserves customized, empty, and disabled signature settings', () => {
    const prefs = memPrefs();
    saveUiSettings(prefs, {
      ...DEFAULT_UI_SETTINGS,
      assistantSignatures: ['My own reminder.'],
      assistantSignaturesEnabled: false,
    });
    expect(loadUiSettings(prefs).assistantSignatures).toEqual([
      'My own reminder.',
    ]);
    expect(loadUiSettings(prefs).assistantSignaturesEnabled).toBe(false);

    saveUiSettings(prefs, {
      ...DEFAULT_UI_SETTINGS,
      assistantSignatures: [],
      assistantSignaturesEnabled: false,
    });
    expect(loadUiSettings(prefs).assistantSignatures).toEqual([]);
    expect(loadUiSettings(prefs).assistantSignaturesEnabled).toBe(false);
  });

  it('migrates semicolon-delimited signatures in their original order', () => {
    const prefs = memPrefs();
    prefs.set(
      'extensions.zotero-ai-sidebar.uiSettings',
      JSON.stringify({
        assistantSignatures: ' first ;； second； third ',
      }),
    );

    expect(loadUiSettings(prefs).assistantSignatures).toEqual([
      'first',
      'second',
      'third',
    ]);
  });
});
