// Prompt-cache / reasoning debug fingerprints for the "复制(调试)" export and
// the per-message context panel. Pure functions over a ModelPreset — no Zotero
// runtime, no shared sidebar state — so they live here, isolated from sidebar.ts.
// Only buildPromptCacheDebug and shortHash are used outside; the rest are
// internal helpers.

import type { Message } from "../providers/types";
import {
  DEFAULT_REASONING_EFFORT,
  DEFAULT_REASONING_SUMMARY,
  type ModelPreset,
  type ReasoningEffort,
  type ReasoningSummary,
} from "../settings/types";

export function buildPromptCacheDebug(args: {
  preset: ModelPreset;
  promptCacheKey: string;
  systemPrompt: string;
  pinnedFullText?: string;
  tools: Array<{ name: string; parameters: { [key: string]: unknown } }>;
}): NonNullable<NonNullable<Message["context"]>["promptCacheDebug"]> {
  const { preset, promptCacheKey, systemPrompt, pinnedFullText, tools } = args;
  const officialOpenAI =
    preset.provider === "openai" && isOfficialOpenAIEndpointForDebug(preset);
  const relayPromptCache =
    preset.provider === "openai" && shouldSendRelayPromptCacheForDebug(preset);
  const requestPath =
    preset.provider === "openai"
      ? preset.extras?.openaiUseChatCompletions
        ? "openai.chat_completions"
        : "openai.responses"
      : "anthropic.messages";
  const toolsShape = tools.map((tool) => ({
    name: tool.name,
    parameters: tool.parameters,
  }));
  const frontBlockText = pinnedFullText
    ? `[Paper full text]\n${pinnedFullText}`
    : "";
  const reasoning = reasoningDebugForPreset(preset, requestPath);
  const promptCacheKeySent =
    preset.provider === "openai" && (officialOpenAI || relayPromptCache);
  const promptCacheRetention =
    officialOpenAI && supportsExtendedPromptCacheForDebug(preset.model)
      ? "24h"
      : undefined;
  return {
    provider: preset.provider,
    requestPath,
    endpoint: endpointForDebug(preset),
    model: preset.model || "(empty)",
    presetID: preset.id || "(empty)",
    promptCacheKey,
    promptCacheKeySent,
    ...(promptCacheRetention ? { promptCacheRetention } : {}),
    promptCacheMechanism:
      preset.provider === "anthropic"
        ? "Anthropic cache_control on system/front-block text"
        : promptCacheKeySent
          ? relayPromptCache
            ? "Relay prompt_cache_key + session_id header"
            : `OpenAI prompt_cache_key${promptCacheRetention ? " + 24h retention" : ""}`
          : "prompt_cache_key not sent: non-official OpenAI-compatible endpoint; relay caching depends on model/request shape",
    reasoningSent: reasoning.sent,
    reasoningDetail: reasoning.detail,
    toolsSent: tools.map((tool) => tool.name),
    toolsHash: shortHash(JSON.stringify(toolsShape)),
    systemPromptHash: shortHash(systemPrompt),
    ...(frontBlockText
      ? {
          frontBlockHash: shortHash(frontBlockText),
          frontBlockChars: pinnedFullText?.length ?? 0,
        }
      : {}),
    stablePrefixHash: shortHash(
      JSON.stringify({
        provider: preset.provider,
        requestPath,
        model: preset.model || "",
        systemPrompt,
        frontBlockText,
        toolsShape,
        reasoningShape: reasoning.shape,
      }),
    ),
  };
}

function reasoningDebugForPreset(
  preset: ModelPreset,
  requestPath: string,
): { sent: boolean; detail: string; shape: unknown } {
  if (preset.provider !== "openai") {
    return {
      sent: false,
      detail: "provider is not OpenAI Responses",
      shape: null,
    };
  }
  if (requestPath === "openai.chat_completions") {
    const effort = preset.extras?.reasoningEffort;
    if (!effort || effort === "none") {
      return {
        sent: false,
        detail: "chat completions reasoning_effort omitted",
        shape: null,
      };
    }
    const sentEffort = effort === "xhigh" ? "high" : effort;
    return {
      sent: true,
      detail: `chat completions reasoning_effort=${sentEffort}`,
      shape: { reasoning_effort: sentEffort },
    };
  }
  if (isOfficialOpenAIEndpointForDebug(preset)) {
    const shape = responsesReasoningShapeForDebug(preset);
    return {
      sent: true,
      detail: responsesReasoningDetail(shape),
      shape,
    };
  }
  if (preset.extras?.omitResponsesReasoningForCache === true) {
    return {
      sent: false,
      detail:
        "explicit relay cache-priority option enabled; Responses reasoning omitted",
      shape: null,
    };
  }
  const shape = responsesReasoningShapeForDebug(preset);
  return {
    sent: true,
    detail: `${responsesReasoningDetail(shape)}; non-official endpoint still respects selected reasoning`,
    shape,
  };
}

function responsesReasoningShapeForDebug(preset: ModelPreset): {
  effort: ReasoningEffort;
  summary?: Exclude<ReasoningSummary, "none">;
} {
  const summary = preset.extras?.reasoningSummary ?? DEFAULT_REASONING_SUMMARY;
  return {
    effort: preset.extras?.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
    ...(summary === "none" ? {} : { summary }),
  };
}

function responsesReasoningDetail(
  shape: ReturnType<typeof responsesReasoningShapeForDebug>,
): string {
  return [
    `responses reasoning.effort=${shape.effort}`,
    shape.summary ? `summary=${shape.summary}` : "summary omitted",
  ].join(", ");
}

function endpointForDebug(preset: ModelPreset): string {
  const baseUrl = preset.baseUrl.trim();
  if (baseUrl) return baseUrl;
  if (preset.provider === "openai")
    return "https://api.openai.com/v1 (default)";
  return "(provider default)";
}

function isOfficialOpenAIEndpointForDebug(preset: ModelPreset): boolean {
  const baseUrl = preset.baseUrl.trim();
  if (!baseUrl) return true;
  try {
    return new URL(baseUrl).hostname === "api.openai.com";
  } catch {
    return false;
  }
}

function shouldSendRelayPromptCacheForDebug(preset: ModelPreset): boolean {
  return (
    !isOfficialOpenAIEndpointForDebug(preset) &&
    preset.extras?.enableRelayPromptCache !== false
  );
}

function supportsExtendedPromptCacheForDebug(model: string): boolean {
  return /^(gpt-5|gpt-4\.1)(?:[.-]|$)/i.test(model.trim());
}

export function shortHash(value: string): string {
  // FNV-1a over UTF-16 code units is enough for human debug fingerprints.
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
