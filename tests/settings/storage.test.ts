import { describe, it, expect } from 'vitest';
import {
  detectAnthropicVendor,
  loadPresets,
  savePresets,
  type PrefsStore,
} from '../../src/settings/storage';
import type { ModelPreset } from '../../src/settings/types';

function memPrefs(): PrefsStore {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k),
    set: (k, v) => {
      m.set(k, v);
    },
  };
}

const p1: ModelPreset = {
  id: 'a',
  label: 'Opus',
  provider: 'anthropic',
  apiKey: 'sk-x',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-opus-4-7-20251101',
  models: ['claude-opus-4-7-20251101'],
  maxTokens: 8192,
  // normalizeExtras auto-detects vendor from baseUrl/model and back-fills
  // reasoningEffort='high' (Anthropic's recommended default) on load.
  extras: { vendor: 'claude', reasoningEffort: 'high' },
};

function writePresetsRaw(prefs: PrefsStore, presets: unknown[]): void {
  prefs.set('extensions.zotero-ai-sidebar.presets', JSON.stringify(presets));
}

describe('preset storage', () => {
  it('returns empty list when nothing saved', () => {
    expect(loadPresets(memPrefs())).toEqual([]);
  });

  it('round-trips presets through JSON', () => {
    const prefs = memPrefs();
    savePresets(prefs, [p1]);
    expect(loadPresets(prefs)).toEqual([p1]);
  });

  it('returns empty list when stored value is corrupt JSON', () => {
    const prefs = memPrefs();
    prefs.set('extensions.zotero-ai-sidebar.presets', '{not json');
    expect(loadPresets(prefs)).toEqual([]);
  });

  it('normalizes the agent permission mode', () => {
    const prefs = memPrefs();
    prefs.set(
      'extensions.zotero-ai-sidebar.presets',
      JSON.stringify([
        {
          id: 'o',
          label: 'GPT',
          provider: 'openai',
          apiKey: 'sk',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.2',
          maxTokens: 1000,
          extras: { agentPermissionMode: 'yolo' },
        },
      ]),
    );

    expect(loadPresets(prefs)[0].extras?.agentPermissionMode).toBe('yolo');
  });

  it('preserves an explicit OpenAI model suggestion group', () => {
    const prefs = memPrefs();
    writePresetsRaw(prefs, [
      {
        id: 'ds-openai',
        label: 'DeepSeek relay',
        provider: 'openai',
        apiKey: 'sk',
        baseUrl: 'https://relay.example/v1',
        model: 'custom-model',
        models: ['custom-model'],
        maxTokens: 4000,
        extras: { modelSuggestionGroup: 'deepseek' },
      },
    ]);
    expect(loadPresets(prefs)[0].extras?.modelSuggestionGroup).toBe('deepseek');
  });

  it('back-fills models[] from a legacy preset with only `model`', () => {
    const prefs = memPrefs();
    writePresetsRaw(prefs, [
      {
        id: 'legacy',
        label: 'GPT',
        provider: 'openai',
        apiKey: 'sk',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.2',
        maxTokens: 4000,
      },
    ]);
    const [preset] = loadPresets(prefs);
    expect(preset.model).toBe('gpt-5.2');
    expect(preset.models).toEqual(['gpt-5.2']);
  });

  it('repairs a preset where active model is not in models[]', () => {
    const prefs = memPrefs();
    writePresetsRaw(prefs, [
      {
        id: 'mismatch',
        label: 'GPT',
        provider: 'openai',
        apiKey: 'sk',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.2-mini',
        models: ['gpt-5.2', 'gpt-4o'],
        maxTokens: 4000,
      },
    ]);
    const [preset] = loadPresets(prefs);
    // Active model preserved AND prepended to the list so it is selectable.
    expect(preset.model).toBe('gpt-5.2-mini');
    expect(preset.models).toEqual(['gpt-5.2-mini', 'gpt-5.2', 'gpt-4o']);
  });

  it('falls back to models[0] when `model` is empty', () => {
    const prefs = memPrefs();
    writePresetsRaw(prefs, [
      {
        id: 'no-active',
        label: 'GPT',
        provider: 'openai',
        apiKey: 'sk',
        baseUrl: 'https://api.openai.com/v1',
        model: '',
        models: ['gpt-5.2', 'gpt-4o'],
        maxTokens: 4000,
      },
    ]);
    const [preset] = loadPresets(prefs);
    expect(preset.model).toBe('gpt-5.2');
    expect(preset.models).toEqual(['gpt-5.2', 'gpt-4o']);
  });

  it('auto-detects anthropic vendor from baseUrl host', () => {
    const prefs = memPrefs();
    writePresetsRaw(prefs, [
      {
        id: 'ds',
        label: 'DeepSeek',
        provider: 'anthropic',
        apiKey: 'sk',
        baseUrl: 'https://api.deepseek.com/anthropic',
        model: 'deepseek-v4-flash',
        models: ['deepseek-v4-flash'],
        maxTokens: 8192,
      },
    ]);
    expect(loadPresets(prefs)[0].extras?.vendor).toBe('deepseek');
  });

  it('auto-detects anthropic vendor as claude for legacy presets without vendor', () => {
    const prefs = memPrefs();
    writePresetsRaw(prefs, [
      {
        id: 'legacy',
        label: 'Claude',
        provider: 'anthropic',
        apiKey: 'sk',
        baseUrl: '',
        model: 'claude-sonnet-4-6',
        models: ['claude-sonnet-4-6'],
        maxTokens: 8192,
      },
    ]);
    // Legacy preset (no extras.vendor) but model is `claude-*` → detect 'claude'.
    expect(loadPresets(prefs)[0].extras?.vendor).toBe('claude');
  });

  it('preserves an explicitly stored vendor over auto-detect', () => {
    const prefs = memPrefs();
    writePresetsRaw(prefs, [
      {
        id: 'override',
        label: 'Custom',
        provider: 'anthropic',
        apiKey: 'sk',
        // baseUrl would normally suggest 'claude'…
        baseUrl: 'https://api.anthropic.com',
        // …but the user pinned vendor='compat' (e.g. they know the proxy
        // dropped behind this URL doesn't honor `thinking`).
        extras: { vendor: 'compat' },
        model: 'whatever',
        models: ['whatever'],
        maxTokens: 8192,
      },
    ]);
    expect(loadPresets(prefs)[0].extras?.vendor).toBe('compat');
  });

  it('detectAnthropicVendor falls back to compat for unknown urls and models', () => {
    expect(detectAnthropicVendor('', '')).toBe('compat');
    expect(detectAnthropicVendor('https://example.com/v1', 'mystery')).toBe('compat');
    expect(detectAnthropicVendor('https://api.deepseek.com/anthropic', 'mystery')).toBe(
      'deepseek',
    );
    expect(detectAnthropicVendor('https://api.anthropic.com', 'claude-haiku-4-5')).toBe(
      'claude',
    );
  });

  it('round-trips a multi-model preset', () => {
    const prefs = memPrefs();
    const multi: ModelPreset = {
      ...p1,
      model: 'claude-sonnet-4-6',
      models: ['claude-opus-4-7-20251101', 'claude-sonnet-4-6'],
    };
    savePresets(prefs, [multi]);
    expect(loadPresets(prefs)[0]).toEqual(multi);
  });
});
