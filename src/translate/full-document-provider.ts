import { loadPresets, type PrefsStore } from "../settings/storage";
import type { ModelPreset, TranslateThinking } from "../settings/types";
import { getProvider } from "../providers/factory";
import type { Message } from "../providers/types";
import { loadTranslateSettings } from "./settings";
import {
  buildTranslatePreset,
  cleanTranslationOutput,
  translationNeedsRetry,
} from "./translator";
import type { FullDocumentTranslationChunk } from "./full-document-runner";
import { mergeUsage } from "./full-document-usage";

const FULL_DOCUMENT_TRANSLATION_PREFIX = "英译中：";
const FULL_DOCUMENT_TRANSLATION_PROMPT =
  "仅输出简中译文；ZAILATEXTOKEN0X不变。";
const FULL_DOCUMENT_STRICT_TRANSLATION_PROMPT =
  "只译不问；ZAILATEXTOKEN0X不变。";
const FULL_DOCUMENT_MODEL_SELECTION_KEY =
  "extensions.zotero-ai-sidebar.fullTranslationModelSelection";

const FULL_DOCUMENT_THINKING_OPTIONS: Array<[TranslateThinking, string]> = [
  ["off", "关闭 - 不思考，最快最省 token"],
  ["low", "Low - 省 token，推荐翻译使用"],
  ["medium", "Medium - 平衡"],
  ["high", "High - 更强推理"],
  ["xhigh", "Extra high - 最强推理"],
];

const FULL_DOCUMENT_THINKING_OPTIONS_DEEPSEEK: Array<
  [TranslateThinking, string]
> = [
  ["off", "关闭 - 不思考"],
  ["high", "High - 标准思考（DeepSeek 默认）"],
  ["xhigh", "Max - 强思考（复杂任务）"],
];

export interface FullDocumentTranslationConfig {
  preset: ModelPreset;
  model: string;
  thinking: TranslateThinking;
}

export interface FullDocumentModelSelection {
  presetId: string;
  model: string;
  thinking: TranslateThinking;
}

export interface ResolvedFullDocumentModelSelection {
  selection: FullDocumentModelSelection;
  preset: ModelPreset;
  inherited: boolean;
}

export interface FullDocumentTranslator extends FullDocumentTranslationConfig {
  translate(source: string): Promise<FullDocumentTranslationChunk>;
}

export function resolveFullDocumentTranslationConfig(
  prefs: PrefsStore,
): FullDocumentTranslationConfig {
  const resolved = resolveFullDocumentModelSelection(prefs);
  return {
    preset: resolved.preset,
    model: resolved.selection.model,
    thinking: resolved.selection.thinking,
  };
}

export function loadFullDocumentModelSelection(
  prefs: PrefsStore,
): FullDocumentModelSelection | null {
  const raw = prefs.get(FULL_DOCUMENT_MODEL_SELECTION_KEY);
  if (!raw) return null;
  try {
    return normalizeFullDocumentModelSelection(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveFullDocumentModelSelection(
  prefs: PrefsStore,
  selection: FullDocumentModelSelection,
): void {
  const normalized = normalizeFullDocumentModelSelection(selection);
  if (!normalized) throw new Error("全文翻译模型配置无效。");
  prefs.set(FULL_DOCUMENT_MODEL_SELECTION_KEY, JSON.stringify(normalized));
}

export function resolveFullDocumentModelSelection(
  prefs: PrefsStore,
): ResolvedFullDocumentModelSelection {
  const presets = loadPresets(prefs);
  if (presets.length === 0) throw new Error("请先在设置中配置一个账号。");

  const stored = loadFullDocumentModelSelection(prefs);
  const storedResolved = stored
    ? resolveExactFullDocumentSelection(presets, stored)
    : null;
  if (storedResolved) {
    return { ...storedResolved, inherited: false };
  }

  const settings = loadTranslateSettings(prefs);
  const preset =
    presets.find((candidate) => candidate.id === settings.presetId) ??
    presets[0]!;
  const models = fullDocumentModelsForPreset(preset);
  const model = models.includes(settings.model) ? settings.model : models[0];
  if (!model) throw new Error("请先为账号选择模型。");
  return {
    preset,
    selection: {
      presetId: preset.id,
      model,
      thinking: collapseFullDocumentThinking(preset, settings.thinking),
    },
    inherited: true,
  };
}

export function fullDocumentModelsForPreset(preset: ModelPreset): string[] {
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

export function fullDocumentThinkingOptions(
  preset: ModelPreset,
): Array<[TranslateThinking, string]> {
  return preset.provider === "anthropic" && preset.extras?.vendor === "deepseek"
    ? FULL_DOCUMENT_THINKING_OPTIONS_DEEPSEEK
    : FULL_DOCUMENT_THINKING_OPTIONS;
}

export function collapseFullDocumentThinking(
  preset: ModelPreset,
  thinking: TranslateThinking,
): TranslateThinking {
  if (
    preset.provider === "anthropic" &&
    preset.extras?.vendor === "deepseek" &&
    (thinking === "low" || thinking === "medium")
  ) {
    return "high";
  }
  return thinking;
}

function resolveExactFullDocumentSelection(
  presets: ModelPreset[],
  selection: FullDocumentModelSelection,
): Omit<ResolvedFullDocumentModelSelection, "inherited"> | null {
  const preset = presets.find(
    (candidate) => candidate.id === selection.presetId,
  );
  if (
    !preset ||
    !fullDocumentModelsForPreset(preset).includes(selection.model)
  ) {
    return null;
  }
  return {
    preset,
    selection: {
      ...selection,
      thinking: collapseFullDocumentThinking(preset, selection.thinking),
    },
  };
}

function normalizeFullDocumentModelSelection(
  value: unknown,
): FullDocumentModelSelection | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const presetId =
    typeof input.presetId === "string" ? input.presetId.trim() : "";
  const model = typeof input.model === "string" ? input.model.trim() : "";
  if (!presetId || !model || !isTranslateThinking(input.thinking)) return null;
  return { presetId, model, thinking: input.thinking };
}

function isTranslateThinking(value: unknown): value is TranslateThinking {
  return (
    value === "off" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  );
}

export function createFullDocumentTranslator(
  prefs: PrefsStore,
  signal: AbortSignal,
): FullDocumentTranslator {
  const config = resolveFullDocumentTranslationConfig(prefs);
  return {
    ...config,
    translate: (source) => translateChunk(source, config, signal),
  };
}

async function translateChunk(
  source: string,
  config: FullDocumentTranslationConfig,
  signal: AbortSignal,
): Promise<FullDocumentTranslationChunk> {
  const preset = buildTranslatePreset({
    sentence: source,
    preset: config.preset,
    model: config.model,
    thinking: config.thinking,
    signal,
  });
  const messages: Message[] = [
    { role: "user", content: `${FULL_DOCUMENT_TRANSLATION_PREFIX}${source}` },
  ];
  const first = await requestTranslation(messages, preset, signal);
  const retried = translationNeedsRetry(source, first.text);
  const result = retried
    ? await requestTranslation(
        messages,
        preset,
        signal,
        FULL_DOCUMENT_STRICT_TRANSLATION_PROMPT,
      )
    : first;
  const usage = retried ? mergeUsage(first.usage, result.usage) : first.usage;
  const text = cleanTranslationOutput(result.text);
  if (!text) throw new Error("模型未返回译文。");
  return {
    text,
    ...(usage
      ? {
          usage: {
            ...usage,
            cacheReadIncludedInInput: config.preset.provider === "openai",
          },
        }
      : {}),
  };
}

async function requestTranslation(
  messages: Message[],
  preset: ModelPreset,
  signal: AbortSignal,
  prompt = FULL_DOCUMENT_TRANSLATION_PROMPT,
): Promise<FullDocumentTranslationChunk> {
  const provider = getProvider(preset);
  let text = "";
  let usage: FullDocumentTranslationChunk["usage"];
  for await (const chunk of provider.stream(messages, prompt, preset, signal)) {
    if (chunk.type === "text_delta") text += chunk.text;
    if (chunk.type === "usage") {
      usage = mergeUsage(usage, {
        input: chunk.input,
        output: chunk.output,
        cacheRead: chunk.cacheRead,
      });
    }
    if (chunk.type === "error") {
      throw new Error(chunk.message || "全文翻译失败。");
    }
  }
  return { text, usage };
}
