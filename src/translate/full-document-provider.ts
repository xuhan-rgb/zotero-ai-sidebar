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

const FULL_DOCUMENT_TRANSLATION_PREFIX = "英译中：";
const FULL_DOCUMENT_TRANSLATION_PROMPT =
  "仅输出简中译文；ZAILATEXTOKEN0X不变。";
const FULL_DOCUMENT_STRICT_TRANSLATION_PROMPT =
  "只译不问；ZAILATEXTOKEN0X不变。";

export interface FullDocumentTranslationConfig {
  preset: ModelPreset;
  model: string;
  thinking: TranslateThinking;
}

export interface FullDocumentTranslator extends FullDocumentTranslationConfig {
  translate(source: string): Promise<FullDocumentTranslationChunk>;
}

export function resolveFullDocumentTranslationConfig(
  prefs: PrefsStore,
): FullDocumentTranslationConfig {
  const settings = loadTranslateSettings(prefs);
  const presets = loadPresets(prefs);
  const preset =
    presets.find((candidate) => candidate.id === settings.presetId) ??
    presets[0] ??
    null;
  if (!preset) throw new Error("请先在设置中配置一个账号。");
  const model = settings.model || preset.model;
  if (!model) throw new Error("请先为账号选择模型。");
  return { preset, model, thinking: settings.thinking };
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

function mergeUsage(
  first: FullDocumentTranslationChunk["usage"],
  second: FullDocumentTranslationChunk["usage"],
): FullDocumentTranslationChunk["usage"] {
  if (!first) return second;
  if (!second) return first;
  return {
    input: first.input + second.input,
    output: first.output + second.output,
    ...((first.cacheRead != null || second.cacheRead != null) && {
      cacheRead: (first.cacheRead ?? 0) + (second.cacheRead ?? 0),
    }),
    ...(first.cacheReadIncludedInInput === second.cacheReadIncludedInInput &&
      first.cacheReadIncludedInInput != null && {
        cacheReadIncludedInInput: first.cacheReadIncludedInInput,
      }),
  };
}
