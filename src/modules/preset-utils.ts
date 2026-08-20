import { getProvider } from "../providers/factory";
import type { Message } from "../providers/types";
import { savePresets, zoteroPrefs } from "../settings/storage";
import {
  DEFAULT_BASE_URLS,
  DEFAULT_MODELS,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_REASONING_SUMMARY,
  REASONING_EFFORT_OPTIONS,
  type AgentPermissionMode,
  type ModelPreset,
  type ProviderKind,
  type ReasoningEffort,
  type ReasoningSummary,
} from "../settings/types";

export interface PresetState {
  presets: ModelPreset[];
  selectedId: string | null;
  sending?: boolean;
}

export function selectedPreset(state: PresetState): ModelPreset | null {
  return (
    state.presets.find((p) => p.id === state.selectedId) ??
    state.presets[0] ??
    null
  );
}

export function selectedChatPreset(state: PresetState): ModelPreset | null {
  const presets = configuredPresets(state);
  return presets.find((p) => p.id === state.selectedId) ?? presets[0] ?? null;
}

export function configuredPresets(state: PresetState): ModelPreset[] {
  return state.presets.filter(isPresetConfigured);
}

export function isPresetConfigured(preset: ModelPreset): boolean {
  return !!preset.apiKey.trim() && !!preset.model.trim();
}

export function agentPermissionMode(
  preset: ModelPreset | null | undefined,
): AgentPermissionMode {
  return preset?.extras?.agentPermissionMode === "yolo" ? "yolo" : "default";
}

export function withAgentPermissionMode(
  preset: ModelPreset,
  mode: AgentPermissionMode,
): ModelPreset {
  return {
    ...preset,
    extras: {
      ...preset.extras,
      agentPermissionMode: mode,
    },
  };
}

// Reasoning effort is editable for any preset that actually consumes it:
// OpenAI Responses presets always do; Anthropic presets do iff their vendor
// is Claude or DeepSeek (compat = unknown third-party that never gets a
// thinking field, so the control is meaningless and stays disabled).
export function isReasoningDisabledForDraft(draft: ModelPreset): boolean {
  if (draft.provider === "openai") return false;
  if (draft.provider === "anthropic") {
    const vendor = draft.extras?.vendor ?? "compat";
    return vendor === "compat";
  }
  return true;
}

// DeepSeek's Anthropic-format endpoint advertises only two effective effort
// values — high and max (their docs note 3: low/medium → high, xhigh →
// max). The composer dropdown for DeepSeek presets surfaces just those, so
// users can't pick a level that silently maps to something else.
const REASONING_EFFORT_OPTIONS_DEEPSEEK: Array<[ReasoningEffort, string]> = [
  ["high", "High - 标准思考（DeepSeek 默认）"],
  // We persist 'xhigh' on the preset; on the wire DeepSeek reads it as
  // max. Same approach used by the translate panel for consistency.
  ["xhigh", "Max - 强思考（复杂任务）"],
];

export function reasoningEffortOptionsForPreset(
  preset: ModelPreset,
): Array<[ReasoningEffort, string]> {
  if (preset.provider === "anthropic" && preset.extras?.vendor === "deepseek") {
    return REASONING_EFFORT_OPTIONS_DEEPSEEK;
  }
  return REASONING_EFFORT_OPTIONS;
}

// Collapse a persisted effort to one that exists in the preset's visible
// option list. Currently only DeepSeek collapses — low/medium → high.
export function collapseReasoningForPreset(
  preset: ModelPreset,
  effort: ReasoningEffort,
): ReasoningEffort {
  if (preset.provider === "anthropic" && preset.extras?.vendor === "deepseek") {
    if (effort === "low" || effort === "medium") return "high";
  }
  return effort;
}

export function withReasoningEffort(
  preset: ModelPreset,
  effort: ReasoningEffort,
): ModelPreset {
  return {
    ...preset,
    extras: {
      ...preset.extras,
      reasoningEffort: effort,
    },
  };
}

export function reasoningEffortLabel(effort: ReasoningEffort): string {
  return (
    REASONING_EFFORT_OPTIONS.find(([value]) => value === effort)?.[1] ?? effort
  );
}

export function reasoningEffortShortLabel(effort: ReasoningEffort): string {
  const label = reasoningEffortLabel(effort);
  return label.split(" - ")[0] || label;
}

export function persist(state: PresetState) {
  savePresets(zoteroPrefs(), state.presets);
}

export function upsertPreset(state: PresetState, next: ModelPreset) {
  const index = state.presets.findIndex((p) => p.id === next.id);
  state.presets =
    index >= 0
      ? state.presets.map((p) => (p.id === next.id ? next : p))
      : [...state.presets, next];
}

export function presetSelectLabel(preset: ModelPreset): string {
  return `${preset.label} (${preset.provider})`;
}

export function updateToolbarOption(mount: HTMLElement, preset: ModelPreset) {
  const option = Array.from(
    mount.querySelectorAll(
      ".preset-switcher option, .composer-preset-switcher option",
    ),
  ).find((node) => (node as HTMLOptionElement).value === preset.id) as
    | HTMLOptionElement
    | undefined;
  if (option) {
    option.textContent = presetSelectLabel(preset);
  }
}

export async function testPresetConnectivity(
  preset: ModelPreset,
  signal: AbortSignal,
): Promise<{ message: string; preset: ModelPreset }> {
  if (!preset.apiKey.trim()) throw new Error("API Key 为空");
  if (!preset.model.trim()) throw new Error("Model 为空");
  if (preset.provider === "openai") {
    return testOpenAIConnectivity(preset, signal);
  }

  const testPreset = {
    ...preset,
    maxTokens: Math.min(Math.max(preset.maxTokens || 256, 256), 512),
  };
  const messages: Message[] = [{ role: "user", content: "Reply OK." }];
  const provider = getProvider(testPreset);
  let sawAnyChunk = false;

  for await (const chunk of provider.stream(
    messages,
    "Connectivity test. Reply with OK only.",
    testPreset,
    signal,
  )) {
    if (chunk.type === "error") throw new Error(chunk.message);
    sawAnyChunk = true;
    if (chunk.type === "text_delta" || chunk.type === "usage") break;
  }

  return {
    preset,
    message: sawAnyChunk
      ? `连接成功：${preset.provider} / ${preset.model}`
      : `连接完成：${preset.provider} / ${preset.model}`,
  };
}

export async function detectOpenAIModelTransports(
  preset: ModelPreset,
  signal: AbortSignal,
): Promise<ModelPreset> {
  if (preset.provider !== "openai") return preset;
  const models = [
    ...new Set(
      (preset.models?.length ? preset.models : [preset.model])
        .map((model) => model.trim())
        .filter(Boolean),
    ),
  ];
  let detected = preset;
  for (const model of models) {
    const result = await testPresetConnectivity({ ...detected, model }, signal);
    detected = { ...detected, extras: result.preset.extras };
  }
  return { ...detected, model: preset.model };
}

async function testOpenAIConnectivity(
  preset: ModelPreset,
  signal: AbortSignal,
): Promise<{ message: string; preset: ModelPreset }> {
  const withMaxTokens = await requestOpenAIConnectivity(preset, signal, true);
  if (withMaxTokens.ok) {
    return {
      preset: withOpenAIChatCompletions(
        withOmitMaxOutputTokens(preset, false),
        false,
      ),
      message: `连接成功：${preset.provider} / ${preset.model}（支持 Max tokens）`,
    };
  }

  if (isOpenAIResponsesUnavailable(withMaxTokens)) {
    return testChatCompletionsFallback(preset, signal);
  }

  if (!isUnsupportedMaxOutputTokens(withMaxTokens.body)) {
    throw new Error(openAITestErrorMessage(withMaxTokens));
  }

  const withoutMaxTokens = await requestOpenAIConnectivity(
    preset,
    signal,
    false,
  );
  if (!withoutMaxTokens.ok) {
    if (isOpenAIResponsesUnavailable(withoutMaxTokens)) {
      return testChatCompletionsFallback(preset, signal);
    }
    throw new Error(openAITestErrorMessage(withoutMaxTokens));
  }

  return {
    preset: withOpenAIChatCompletions(
      withOmitMaxOutputTokens(preset, true),
      false,
    ),
    message:
      `连接成功：${preset.provider} / ${preset.model}` +
      "（服务不支持 Max tokens，已保存为不发送）",
  };
}

async function testChatCompletionsFallback(
  preset: ModelPreset,
  signal: AbortSignal,
): Promise<{ message: string; preset: ModelPreset }> {
  const result = await requestChatCompletionsConnectivity(preset, signal);
  if (!result.ok) throw new Error(openAITestErrorMessage(result));
  return {
    preset: withOpenAIChatCompletions(preset, true),
    message:
      `连接成功：${preset.provider} / ${preset.model}` +
      "（不支持 Responses API，已切换为 Chat Completions）",
  };
}

type OpenAITestResult =
  | { ok: true }
  | { ok: false; status: number; body: string };

interface PromptCacheTestOptions {
  promptCacheKey?: string;
  pinnedFullText?: string;
  sourceLabel?: string;
}

interface PromptCacheRun {
  status: number;
  body: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export async function testPresetPromptCache(
  preset: ModelPreset,
  signal: AbortSignal,
  options: PromptCacheTestOptions = {},
): Promise<{ message: string; preset: ModelPreset }> {
  if (!preset.apiKey.trim()) throw new Error("API Key 为空");
  if (!preset.model.trim()) throw new Error("Model 为空");
  if (preset.provider !== "openai") throw new Error("仅支持 OpenAI 兼容预设");

  const cachePreset = withRelayPromptCache(preset, true);
  try {
    const runs = await requestPromptCachePair(cachePreset, signal, options);
    const second = runs[1];
    const rate = second.inputTokens
      ? second.cachedTokens / second.inputTokens
      : 0;
    return {
      preset: cachePreset,
      message:
        `缓存测试完成（${options.sourceLabel ?? "测试文本"}）：` +
        `第 2 次 cache hit ${second.cachedTokens}/${second.inputTokens}` +
        `（${Math.round(rate * 10000) / 100}%）`,
    };
  } catch (cacheError) {
    if (!isOfficialOpenAIEndpointForPreset(preset)) {
      const disabled = withRelayPromptCache(preset, false);
      try {
        await requestPromptCacheOnce(disabled, signal, options, false);
        return {
          preset: disabled,
          message:
            "缓存参数测试失败，但关闭 relay prompt cache 后连接成功；" +
            "已自动关闭该预设的 relay prompt cache。",
        };
      } catch {
        // Preserve the original cache error when disabling does not fix it.
      }
    }
    throw cacheError;
  }
}

async function requestOpenAIConnectivity(
  preset: ModelPreset,
  signal: AbortSignal,
  includeMaxOutputTokens: boolean,
): Promise<OpenAITestResult> {
  const body = {
    model: preset.model,
    instructions: "Connectivity test. Reply OK only.",
    input: [{ role: "user", content: "Reply OK." }],
    ...(includeMaxOutputTokens ? { max_output_tokens: 256 } : {}),
    ...openAIResponsesReasoningBodyParam(preset),
    stream: true,
    store: false,
  };
  const response = await fetch(openAIResponsesUrl(preset.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${preset.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (response.ok) {
    await response.body?.cancel();
    return { ok: true };
  }
  return {
    ok: false,
    status: response.status,
    body: await response.text(),
  };
}

async function requestChatCompletionsConnectivity(
  preset: ModelPreset,
  signal: AbortSignal,
): Promise<OpenAITestResult> {
  const base = (preset.baseUrl.trim() || "https://api.openai.com/v1").replace(
    /\/+$/,
    "",
  );
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${preset.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: preset.model,
      messages: [{ role: "user", content: "Reply OK." }],
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

async function requestPromptCachePair(
  preset: ModelPreset,
  signal: AbortSignal,
  options: PromptCacheTestOptions,
): Promise<[PromptCacheRun, PromptCacheRun]> {
  const first = await requestPromptCacheOnce(preset, signal, options, true);
  await sleep(2500);
  const second = await requestPromptCacheOnce(preset, signal, options, true);
  return [first, second];
}

async function requestPromptCacheOnce(
  preset: ModelPreset,
  signal: AbortSignal,
  options: PromptCacheTestOptions,
  includeCacheParams: boolean,
): Promise<PromptCacheRun> {
  const key = stablePromptCacheKey(
    options.promptCacheKey ??
      `zai:${preset.provider}:${preset.id}:${preset.model}:cache-test`,
  );
  const body = {
    model: preset.model,
    instructions: "Prompt cache test. Reply CACHE_OK only.",
    input: [
      {
        role: "user",
        content: `[Paper full text]\n${promptCacheTestText(options.pinnedFullText)}`,
      },
      { role: "user", content: "只回复 CACHE_OK。" },
    ],
    ...openAIResponsesReasoningBodyParam(preset),
    ...(includeCacheParams ? openAIPromptCacheBodyParam(preset, key) : {}),
    stream: true,
    store: false,
  };
  const headers: Record<string, string> = {
    Authorization: `Bearer ${preset.apiKey}`,
    "Content-Type": "application/json",
  };
  if (includeCacheParams && shouldSendRelayPromptCacheForPreset(preset)) {
    headers.session_id = key;
  }
  const response = await fetch(openAIResponsesUrl(preset.baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${bodyText || "no body"}`);
  }
  const usage = parseResponsesUsageFromSse(bodyText);
  return {
    status: response.status,
    body: bodyText,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedTokens: usage.cachedTokens,
  };
}

function promptCacheTestText(text: string | undefined): string {
  if (text?.trim()) return text;
  return Array.from(
    { length: 700 },
    (_, i) =>
      `Cache smoke paragraph ${i}: fixed prefix for prompt cache verification.`,
  ).join("\n");
}

function parseResponsesUsageFromSse(body: string): {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
} {
  let usage:
    | {
        input_tokens?: number;
        output_tokens?: number;
        input_tokens_details?: { cached_tokens?: number };
      }
    | undefined;
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === "[DONE]") continue;
    try {
      const event = JSON.parse(raw) as {
        type?: string;
        response?: { usage?: typeof usage };
      };
      if (event.type === "response.completed" && event.response?.usage) {
        usage = event.response.usage;
      }
    } catch {
      // Ignore non-JSON stream lines.
    }
  }
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cachedTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
  };
}

function openAIPromptCacheBodyParam(
  preset: ModelPreset,
  key: string,
): { prompt_cache_key?: string; prompt_cache_retention?: "24h" } {
  if (!shouldSendPromptCacheKeyForPreset(preset)) return {};
  return {
    prompt_cache_key: key,
    ...(isOfficialOpenAIEndpointForPreset(preset) &&
    supportsExtendedPromptCacheForPreset(preset.model)
      ? { prompt_cache_retention: "24h" as const }
      : {}),
  };
}

function openAIResponsesUrl(baseUrl: string): string {
  const root = baseUrl.trim() || "https://api.openai.com/v1";
  return `${root.replace(/\/+$/, "")}/responses`;
}

function openAIResponsesReasoningBodyParam(preset: ModelPreset): {
  reasoning?: {
    effort: ReasoningEffort;
    summary?: Exclude<ReasoningSummary, "none">;
  };
} {
  if (!shouldSendOpenAIResponsesReasoning(preset)) return {};
  const summary = preset.extras?.reasoningSummary ?? DEFAULT_REASONING_SUMMARY;
  return {
    reasoning: {
      effort: preset.extras?.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
      ...(summary === "none" ? {} : { summary }),
    },
  };
}

function shouldSendOpenAIResponsesReasoning(preset: ModelPreset): boolean {
  if (preset.provider !== "openai") return false;
  if (!isOfficialOpenAIEndpointForPreset(preset)) {
    return preset.extras?.omitResponsesReasoningForCache !== true;
  }
  return true;
}

function isOfficialOpenAIEndpointForPreset(preset: ModelPreset): boolean {
  const baseUrl = preset.baseUrl.trim();
  if (!baseUrl) return true;
  try {
    return new URL(baseUrl).hostname === "api.openai.com";
  } catch {
    return false;
  }
}

function shouldSendPromptCacheKeyForPreset(preset: ModelPreset): boolean {
  return (
    isOfficialOpenAIEndpointForPreset(preset) ||
    shouldSendRelayPromptCacheForPreset(preset)
  );
}

function shouldSendRelayPromptCacheForPreset(preset: ModelPreset): boolean {
  return (
    !isOfficialOpenAIEndpointForPreset(preset) &&
    preset.extras?.enableRelayPromptCache !== false
  );
}

function supportsExtendedPromptCacheForPreset(model: string): boolean {
  return /^(gpt-5|gpt-4\.1)(?:[.-]|$)/i.test(model.trim());
}

function stablePromptCacheKey(value: string | undefined): string {
  const cleaned = (value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9:_-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 64);
  return cleaned || "zai:openai";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isUnsupportedMaxOutputTokens(body: string): boolean {
  return /unsupported parameter:\s*max_output_tokens|max_output_tokens.*unsupported/i.test(
    body,
  );
}

function isOpenAIResponsesUnavailable(
  result: Exclude<OpenAITestResult, { ok: true }>,
): boolean {
  if ([404, 405, 501].includes(result.status)) return true;
  if (isReasoningUnsupported(result.body)) return true;
  const namesResponses =
    /codex integration|responses?\s+(?:api|endpoint)|\/responses\b/i.test(
      result.body,
    );
  const saysUnavailable =
    /unsupported|not support|does not (?:yet )?support|not available|unavailable|will be available|instead for now/i.test(
      result.body,
    );
  return namesResponses && saysUnavailable;
}

function isReasoningUnsupported(body: string): boolean {
  return (
    /unsupported_parameter|unsupported parameter/i.test(body) &&
    /reasoning/i.test(body)
  );
}

function openAITestErrorMessage(
  result: Exclude<OpenAITestResult, { ok: true }>,
) {
  return `HTTP ${result.status}: ${result.body || "no body"}`;
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

function withOpenAIChatCompletions(
  preset: ModelPreset,
  use: boolean,
): ModelPreset {
  const extras = { ...preset.extras };
  const legacyModels = extras.openaiUseChatCompletions
    ? preset.models?.length
      ? preset.models
      : [preset.model]
    : [];
  const chatModels = new Set(
    [...legacyModels, ...(extras.openaiChatCompletionsModels ?? [])]
      .map((model) => model.trim())
      .filter(Boolean),
  );
  if (use) chatModels.add(preset.model);
  else chatModels.delete(preset.model);
  delete extras.openaiUseChatCompletions;
  if (chatModels.size > 0) {
    extras.openaiChatCompletionsModels = [...chatModels];
  } else {
    delete extras.openaiChatCompletionsModels;
  }
  return { ...preset, extras };
}

function withRelayPromptCache(
  preset: ModelPreset,
  enabled: boolean,
): ModelPreset {
  const extras = { ...preset.extras };
  if (enabled) {
    delete extras.enableRelayPromptCache;
  } else {
    extras.enableRelayPromptCache = false;
  }
  return { ...preset, extras };
}

export function presetSignature(preset: ModelPreset): string {
  return JSON.stringify({
    id: preset.id,
    provider: preset.provider,
    label: preset.label,
    apiKey: preset.apiKey,
    baseUrl: preset.baseUrl,
    model: preset.model,
    models: preset.models ?? [],
    maxTokens: preset.maxTokens,
    extras: preset.extras ?? {},
  });
}

export function sanitizedTestError(err: unknown, apiKey: string): string {
  let message = err instanceof Error ? err.message : String(err);
  if (apiKey) message = message.split(apiKey).join("[API_KEY]");
  if (message.toLowerCase().includes("abort")) {
    return "连接超时或已取消";
  }
  return `连接失败：${message}`;
}

export function updateSendControls(mount: HTMLElement, state: PresetState) {
  const preset = selectedChatPreset(state);
  const ready = !!preset?.apiKey && !!preset.model && !state.sending;
  const textarea = mount.querySelector(
    ".input-row textarea",
  ) as HTMLTextAreaElement | null;
  const button = mount.querySelector(
    ".input-row button",
  ) as HTMLButtonElement | null;
  if (textarea) {
    textarea.disabled = !preset;
  }
  if (button && button.textContent === "发送") {
    button.disabled = !ready;
    button.title = preset && !ready ? "请先填写 API Key 和 Model ID" : "";
  }
}

export function makePreset(provider: ProviderKind): ModelPreset {
  return {
    id: makeId(),
    provider,
    label: provider === "anthropic" ? "Claude" : "GPT",
    apiKey: "",
    baseUrl: DEFAULT_BASE_URLS[provider],
    model: DEFAULT_MODELS[provider],
    maxTokens: 8192,
    extras:
      provider === "openai"
        ? {
            reasoningEffort: DEFAULT_REASONING_EFFORT,
            reasoningSummary: DEFAULT_REASONING_SUMMARY,
            agentPermissionMode: "default",
          }
        : {
            agentPermissionMode: "default",
          },
  };
}

function makeId(): string {
  return `preset-${Date.now()}-${Zotero.Utilities.randomString(6)}`;
}
