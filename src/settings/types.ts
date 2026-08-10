export type ProviderKind = 'anthropic' | 'openai';
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type ReasoningSummary = 'auto' | 'concise' | 'detailed' | 'none';
export type AgentPermissionMode = 'default' | 'yolo';
// Vendor distinguishes who actually answers an Anthropic-protocol request.
// Same Messages API, different thinking-mode dialects:
//   claude   = Anthropic Claude (real or reverse-proxied) — adaptive vs
//              enabled is decided per-model name, effort/budget mapped from
//              TranslateThinking.
//   deepseek = DeepSeek's Anthropic-compatible endpoint — uses
//              {thinking: {type: "enabled"}} + {output_config.effort}.
//   compat   = unknown third-party proxy — never send `thinking` so an
//              endpoint that doesn't recognize the field can't 400.
export type AnthropicVendor = 'claude' | 'deepseek' | 'compat';

export interface ModelPreset {
  id: string;
  label: string;
  provider: ProviderKind;
  apiKey: string;
  baseUrl: string;
  // Currently-active model — what providers actually send to the API. Stays
  // a single string so provider adapters don't need to change.
  model: string;
  // Available models for this preset. The composer-footer switcher lets the
  // user pick one and writes the choice back to `model`. Persisted in prefs
  // so the selection is sticky across sessions.
  // GOTCHA: optional for back-compat with legacy presets that only had
  // `model`. `normalizePreset` in storage.ts back-fills this on load.
  models?: string[];
  maxTokens: number;
  extras?: {
    reasoningEffort?: ReasoningEffort;
    reasoningSummary?: ReasoningSummary;
    agentPermissionMode?: AgentPermissionMode;
    omitMaxOutputTokens?: boolean;
    // Legacy preset-wide transport flag. New connectivity tests persist the
    // model-specific list below because one endpoint can expose different
    // protocol support per model (for example DeepSeek V4 Flash vs Pro).
    openaiUseChatCompletions?: boolean;
    openaiChatCompletionsModels?: string[];
    // Explicit cache-priority escape hatch for OpenAI-compatible relays where
    // the optional Responses `reasoning` object prevents long-prefix cache
    // hits. Default is false: respect the user's selected reasoning effort.
    omitResponsesReasoningForCache?: boolean;
    // Non-official OpenAI-compatible relays use prompt_cache_key/session_id
    // automatically. Set to false after a failed cache test to disable it.
    enableRelayPromptCache?: boolean;
    testStatus?: 'ok' | 'failed';
    // Anthropic-only — written by storage normalize / preset UI:
    vendor?: AnthropicVendor;
    // Translate-only signal — written by translator just before stream(),
    // never persisted via the preset UI. Presence enables thinking on the
    // Anthropic path; absence keeps the chat flow's existing no-thinking
    // behavior unchanged.
    translateThinking?: TranslateThinking;
    [key: string]: unknown;
  };
}

export function usesOpenAIChatCompletions(preset: ModelPreset): boolean {
  return (
    preset.extras?.openaiUseChatCompletions === true ||
    preset.extras?.openaiChatCompletionsModels?.includes(preset.model) === true
  );
}

export const DEFAULT_BASE_URLS: Record<ProviderKind, string> = {
  anthropic: '',
  openai: '',
};

export const DEFAULT_MODELS: Record<ProviderKind, string> = {
  anthropic: '',
  openai: '',
};

// =================================================================
//  MODEL CATALOG — single source of truth
// =================================================================
// Suggestion chips, thinking-dialect dispatch, and effort-level capping all
// read from this map. Adding a model or changing its capabilities is a
// one-place edit. Layout is intentionally vertical so additions are
// low-friction and diffs stay readable.
//
// Fields:
//   id               Model name as the API expects it.
//   thinkingDialect  Anthropic-only. Decides request shape:
//                      'adaptive' → {thinking:{type:"adaptive"}, output_config:{effort}}
//                                   (Opus 4.7 / 4.6, Sonnet 4.6, Mythos)
//                      'enabled'  → {thinking:{type:"enabled", budget_tokens:N}}
//                                   (older Claude: Haiku 4.5, Sonnet 4.5, …)
//                    Unset = no thinking config sent (OpenAI / DeepSeek
//                    handled separately; for Claude unknown IDs the
//                    heuristic in findClaudeDescriptor decides).
//   acceptsXhigh     Anthropic adaptive only. True iff the model accepts
//                    `effort: "xhigh"` per Anthropic's effort matrix
//                    (Opus 4.7 only as of writing). Other adaptive models
//                    reject xhigh and translator promotes it to `max`.
export interface ModelDescriptor {
  id: string;
  thinkingDialect?: 'adaptive' | 'enabled';
  acceptsXhigh?: boolean;
}

export const MODEL_CATALOG: Record<'openai' | AnthropicVendor, ModelDescriptor[]> = {
  openai: [
    { id: 'gpt-5.6-sol' },
    { id: 'gpt-5.6-terra' },
    { id: 'gpt-5.6-luna' },
    { id: 'gpt-5.5' },
    { id: 'gpt-5.4' },
    { id: 'gpt-5.4-mini' },
    { id: 'gpt-5.3-codex' },
    { id: 'gpt-5.2' },
  ],
  claude: [
    { id: 'claude-opus-4-7',           thinkingDialect: 'adaptive', acceptsXhigh: true },
    { id: 'claude-opus-4-6',           thinkingDialect: 'adaptive' },
    { id: 'claude-sonnet-4-6',         thinkingDialect: 'adaptive' },
    { id: 'claude-haiku-4-5-20251001', thinkingDialect: 'enabled'  },
  ],
  deepseek: [
    { id: 'deepseek-v4-flash' },
    { id: 'deepseek-v4-pro' },
  ],
  compat: [],
};

// Derived view: id-only suggestion lists (the preset card chip-row reads this).
export const MODEL_SUGGESTIONS: Record<'openai' | AnthropicVendor, string[]> = {
  openai: MODEL_CATALOG.openai.map((m) => m.id),
  claude: MODEL_CATALOG.claude.map((m) => m.id),
  deepseek: MODEL_CATALOG.deepseek.map((m) => m.id),
  compat: [],
};

// Look up a Claude model's thinking-mode metadata. Catalog hits give precise
// answers; unknown IDs fall through to a name-pattern heuristic so a future
// Claude variant we haven't catalogued yet still works (drop the entry into
// MODEL_CATALOG.claude later for tighter control).
export function findClaudeDescriptor(model: string): ModelDescriptor {
  const exact = MODEL_CATALOG.claude.find((m) => m.id === model);
  if (exact) return exact;
  if (/(opus-4-7|opus-4-6|sonnet-4-6|mythos)/i.test(model)) {
    return {
      id: model,
      thinkingDialect: 'adaptive',
      acceptsXhigh: /opus-4-7/i.test(model),
    };
  }
  return { id: model, thinkingDialect: 'enabled' };
}

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'xhigh';
export const DEFAULT_REASONING_SUMMARY: ReasoningSummary = 'concise';

export const REASONING_EFFORT_OPTIONS: Array<[ReasoningEffort, string]> = [
  ['low', 'Low - 快速，较少推理'],
  ['medium', 'Medium - 默认平衡'],
  ['high', 'High - 更强推理'],
  ['xhigh', 'Extra high - 最强推理'],
];

export const REASONING_SUMMARY_OPTIONS: Array<[ReasoningSummary, string]> = [
  ['concise', 'Concise - 简短显示思考摘要'],
  ['detailed', 'Detailed - 更详细的思考摘要'],
  ['auto', 'Auto - 由模型决定'],
  ['none', 'None - 不显示思考'],
];

export function newPreset(provider: ProviderKind): ModelPreset {
  const defaultModel = DEFAULT_MODELS[provider];
  return {
    id: crypto.randomUUID(),
    label: provider === 'anthropic' ? 'Claude' : 'GPT',
    provider,
    apiKey: '',
    baseUrl: DEFAULT_BASE_URLS[provider],
    model: defaultModel,
    models: defaultModel ? [defaultModel] : [],
    maxTokens: 8192,
    extras: provider === 'openai'
      ? {
          reasoningEffort: DEFAULT_REASONING_EFFORT,
          reasoningSummary: DEFAULT_REASONING_SUMMARY,
        }
      // Anthropic default: 'high' is Anthropic's recommended adaptive
      // effort and a sensible default for older enabled-mode budgets.
      : { reasoningEffort: 'high' },
  };
}

// 'off' = 不思考；其它四档对应模型的思考强度。
// 各 provider 路径下 'off' 的具体行为：
//   OpenAI         → reasoning.effort = 'none'
//   Claude (任一 dialect) → 不发 thinking 字段（Claude 默认就是不思考）
//   DeepSeek       → thinking: {type: "disabled"}（DeepSeek 默认是 enabled，必须显式关）
//   compat         → 维持原有"不发"行为
export type TranslateThinking = 'off' | 'low' | 'medium' | 'high' | 'xhigh';
export type TranslateContextLevel = 'none' | 'paragraph' | 'page';
export type TranslateOverlayPosition = 'above' | 'below';
export type TranslateTriggerMode = 'single' | 'double';
export type TranslateOverlaySize = 'compact' | 'adaptive';

export interface TranslateSettings {
  enabled: boolean;
  presetId: string;
  model: string;
  thinking: TranslateThinking;
  ctxLevel: TranslateContextLevel;
  overlayPosition: TranslateOverlayPosition;
  overlaySize: TranslateOverlaySize;
  triggerMode: TranslateTriggerMode;
  prevSentenceKey: string;
  nextSentenceKey: string;
  // Whole-paragraph translation. Sticky: a card seeds its 整段 toggle from this,
  // and toggling 整段 on a card writes it back, so the choice persists.
  defaultParagraph: boolean;
}

export const DEFAULT_TRANSLATE_SETTINGS: TranslateSettings = {
  enabled: false,
  presetId: '',
  model: '',
  thinking: 'low',
  ctxLevel: 'none',
  overlayPosition: 'above',
  overlaySize: 'compact',
  triggerMode: 'single',
  prevSentenceKey: 'Shift+Enter',
  nextSentenceKey: 'Enter',
  defaultParagraph: false,
};
