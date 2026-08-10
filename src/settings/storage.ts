import {
  DEFAULT_BASE_URLS,
  DEFAULT_MODELS,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_REASONING_SUMMARY,
  type AgentPermissionMode,
  type AnthropicVendor,
  type ModelPreset,
  type ModelSuggestionGroup,
  type ProviderKind,
  type ReasoningEffort,
  type ReasoningSummary,
} from './types';

// Model-preset persistence backed by Zotero's preferences API.
//
// INVARIANT: all presets serialize to a SINGLE JSON string under one pref
// key. WHY one blob (instead of one pref per field): keeps `crud` atomic
// and lets us evolve the preset shape without registering new prefs each
// time. Cost: any read parses the whole list — fine, the list is small.
//
// `PrefsStore` is the seam used by tests so we don't need a Zotero global.
// `zoteroPrefs()` is the production binding — `Zotero.Prefs.get(k, true)`
// where the trailing `true` is the GLOBAL pref flag (per-profile, not
// per-zotero-instance). REF: Zotero source `chrome/content/zotero/xpcom/prefs.js`.

export interface PrefsStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

const KEY = 'extensions.zotero-ai-sidebar.presets';

export function loadPresets(prefs: PrefsStore): ModelPreset[] {
  const raw = prefs.get(KEY);
  if (!raw) return [];
  try {
    return normalizePresetList(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function savePresets(prefs: PrefsStore, presets: ModelPreset[]): void {
  prefs.set(KEY, JSON.stringify(normalizePresetList(presets)));
}

export function normalizePresetList(value: unknown): ModelPreset[] {
  return Array.isArray(value)
    ? value.map(normalizePreset).filter((p): p is ModelPreset => p != null)
    : [];
}

export function zoteroPrefs(): PrefsStore {
  return {
    get: (k) => {
      const v = (Zotero as unknown as { Prefs: { get: (k: string, global: boolean) => unknown } }).Prefs.get(k, true);
      return typeof v === 'string' ? v : undefined;
    },
    set: (k, v) => {
      (Zotero as unknown as { Prefs: { set: (k: string, v: string, global: boolean) => void } }).Prefs.set(k, v, true);
    },
  };
}

// Schema-rot resilience: treats every persisted preset as untrusted JSON.
// Provider is the only HARD constraint — without a valid provider we can't
// build a Provider object, so we drop the entry. Every other field gets a
// best-effort coercion + default. Mirrors chat-history.ts normalization.
// GOTCHA: `id` defaults to `preset-${Date.now()}` rather than a UUID; this
// fallback is only hit on legacy entries that pre-date `crypto.randomUUID()`.
function normalizePreset(value: unknown): ModelPreset | null {
  if (!value || typeof value !== 'object') return null;
  const preset = value as Partial<ModelPreset>;
  if (preset.provider !== 'openai' && preset.provider !== 'anthropic') return null;
  const provider = preset.provider as ProviderKind;
  const { model, models } = normalizeModels(provider, preset.model, preset.models);
  const baseUrl = String(preset.baseUrl || DEFAULT_BASE_URLS[provider]);
  return {
    id: String(preset.id || `preset-${Date.now()}`),
    label: String(preset.label || (provider === 'anthropic' ? 'Claude' : 'GPT')),
    provider,
    apiKey: String(preset.apiKey || ''),
    baseUrl,
    model,
    models,
    maxTokens: Number(preset.maxTokens || 8192),
    extras: normalizeExtras(provider, preset.extras, baseUrl, model),
  };
}

// Migration + repair for the active model and the available-models list.
// Three legacy/invalid shapes we have to handle without losing user data:
//   1. Legacy preset (only `model`, no `models`) → `models = [model]`.
//   2. New preset with `models` but `model` empty → `model = models[0]`.
//   3. User edited `model` to something not in `models` (out-of-band or
//      via toolbar dropdown before adding to list) → prepend `model` so the
//      active selection stays available.
// INVARIANT on return: `model` is non-empty (DEFAULT_MODELS fallback) and
// `models` includes `model` as one of its entries.
function normalizeModels(
  provider: ProviderKind,
  rawModel: unknown,
  rawModels: unknown,
): { model: string; models: string[] } {
  const fromList = Array.isArray(rawModels)
    ? rawModels
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0)
    : [];
  const trimmedActive = typeof rawModel === 'string' ? rawModel.trim() : '';
  const active =
    trimmedActive ||
    (fromList.length > 0 ? fromList[0] : DEFAULT_MODELS[provider]);
  // Dedupe while preserving the user's list order. Only prepend `active`
  // when it is missing from the list — that way reordering done in the
  // editor survives a save/load round-trip.
  const seen = new Set<string>();
  const ordered: string[] = [];
  const sourceOrder = fromList.includes(active) ? fromList : [active, ...fromList];
  for (const entry of sourceOrder) {
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    ordered.push(entry);
  }
  return { model: active, models: ordered };
}

// `extras` is provider-specific. OpenAI uses reasoning-* fields (Responses
// API); Anthropic uses `vendor` to pick the thinking-mode dialect (set by
// the preset UI, auto-detected from baseUrl/model on legacy load). OpenAI
// presets may persist a UI-only model suggestion group separately.
function normalizeExtras(
  provider: ProviderKind,
  extras: ModelPreset['extras'],
  baseUrl: string,
  model: string,
): ModelPreset['extras'] {
  if (provider === 'anthropic') {
    const vendor = isAnthropicVendor(extras?.vendor)
      ? extras.vendor
      : detectAnthropicVendor(baseUrl, model);
    // Chat thinking level. Anthropic recommends `high` as the default
    // adaptive effort; we use the same default for older enabled-mode
    // models too. Compat vendor ignores this field entirely.
    const reasoningEffort = isReasoningEffort(extras?.reasoningEffort)
      ? extras.reasoningEffort
      : 'high';
    return { ...extras, vendor, reasoningEffort };
  }
  const rawEffort = extras?.reasoningEffort;
  const normalized = { ...extras };
  if (isModelSuggestionGroup(extras?.modelSuggestionGroup)) {
    normalized.modelSuggestionGroup = extras.modelSuggestionGroup;
  } else {
    delete normalized.modelSuggestionGroup;
  }
  return {
    ...normalized,
    reasoningEffort: isReasoningEffort(rawEffort)
      ? rawEffort
      : DEFAULT_REASONING_EFFORT,
    reasoningSummary: isReasoningSummary(extras?.reasoningSummary)
      ? extras.reasoningSummary
      : DEFAULT_REASONING_SUMMARY,
    agentPermissionMode: isAgentPermissionMode(extras?.agentPermissionMode)
      ? extras.agentPermissionMode
      : 'default',
  };
}

function isModelSuggestionGroup(value: unknown): value is ModelSuggestionGroup {
  return (
    value === 'auto' ||
    value === 'openai' ||
    value === 'deepseek' ||
    value === 'claude' ||
    value === 'custom'
  );
}

// Initial vendor guess for legacy presets that pre-date the field. Heuristic:
// baseUrl wins (most explicit), then model-name family, default to `compat`
// (safe — no thinking sent). User can always override in the preset UI.
export function detectAnthropicVendor(
  baseUrl: string,
  model: string,
): AnthropicVendor {
  const url = baseUrl.toLowerCase();
  const id = model.toLowerCase();
  if (url.includes('deepseek') || id.startsWith('deepseek')) return 'deepseek';
  if (url.includes('anthropic.com') || id.startsWith('claude')) return 'claude';
  return 'compat';
}

function isAnthropicVendor(value: unknown): value is AnthropicVendor {
  return value === 'claude' || value === 'deepseek' || value === 'compat';
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return (
    value === 'none' ||
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
  );
}

function isReasoningSummary(value: unknown): value is ReasoningSummary {
  return (
    value === 'auto' ||
    value === 'concise' ||
    value === 'detailed' ||
    value === 'none'
  );
}

function isAgentPermissionMode(value: unknown): value is AgentPermissionMode {
  return value === 'default' || value === 'yolo';
}
