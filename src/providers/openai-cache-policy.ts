import type { ModelPreset } from "../settings/types";

export function isOfficialOpenAIEndpoint(preset: ModelPreset): boolean {
  const baseUrl = preset.baseUrl.trim();
  if (!baseUrl) return true;
  try {
    return new URL(baseUrl).hostname === "api.openai.com";
  } catch {
    return false;
  }
}

export function supportsExtendedPromptCache(model: string): boolean {
  return /^(gpt-5|gpt-4\.1)(?:[.-]|$)/i.test(model.trim());
}

export function stablePromptCacheKey(value: string | undefined): string {
  const cleaned = (value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9:_-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 64);
  return cleaned || "zai:openai";
}
