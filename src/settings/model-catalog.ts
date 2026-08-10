import {
  MODEL_CATALOG,
  type AnthropicVendor,
  type ModelSuggestionKey,
  type ModelSuggestionGroup,
  type ProviderKind,
} from './types';

/**
 * Resolve the small set of predefined model suggestions for a preset draft.
 *
 * Anthropic is intentionally driven by its persisted Vendor: that setting
 * changes the actual thinking request dialect. OpenAI-compatible presets have
 * no vendor setting; in `auto` mode their suggestion catalog is inferred from
 * Base URL and configured model IDs, while the selector can pin a group.
 * Unknown and empty services get no guesses; the custom model input remains
 * available in both cases.
 */
export function resolveModelSuggestionKey(
  provider: ProviderKind,
  baseUrl: string,
  models: string[],
  anthropicVendor?: AnthropicVendor,
  group: ModelSuggestionGroup = 'auto',
): ModelSuggestionKey {
  if (provider === 'anthropic') {
    return anthropicVendor === 'claude' || anthropicVendor === 'deepseek'
      ? anthropicVendor
      : 'compat';
  }
  if (group !== 'auto') return group;

  const url = baseUrl.trim().toLowerCase();
  const modelIds = models
    .map((model) => model.trim().toLowerCase())
    .filter(Boolean);

  // Base URL is the strongest signal: one endpoint can expose several model
  // families, so an explicit provider hostname wins over an individual ID.
  if (url.includes('deepseek')) return 'deepseek';
  if (url.includes('openai.com')) return 'openai';

  // For generic relays, use the configured IDs as a conservative fallback.
  if (modelIds.some((model) => /^deepseek(?:[-_]|$)/i.test(model))) {
    return 'deepseek';
  }
  if (modelIds.some((model) => /^(?:claude|anthropic)(?:[-_]|$)/i.test(model))) {
    return 'claude';
  }
  if (
    modelIds.some(
      (model) =>
        MODEL_CATALOG.openai.some(
          (descriptor) => descriptor.id.toLowerCase() === model,
        ) || /^(?:gpt-|o[1-9](?:[-_]|$)|chatgpt-|codex-)/i.test(model),
    )
  ) {
    return 'openai';
  }

  return 'custom';
}

/** Infer only the initial selector value from a user-provided preset name. */
export function inferModelSuggestionGroupFromName(
  label: string,
): Exclude<ModelSuggestionGroup, 'auto'> | undefined {
  const name = label.trim().toLowerCase();
  if (name.includes('deepseek') || name.includes('深度求索')) return 'deepseek';
  if (name.includes('claude') || name.includes('anthropic')) return 'claude';
  if (name.includes('openai')) return 'openai';
  return undefined;
}
