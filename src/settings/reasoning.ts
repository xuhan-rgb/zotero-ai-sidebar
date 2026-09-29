import {
  DEFAULT_REASONING_EFFORT,
  REASONING_EFFORT_OPTIONS,
  findClaudeDescriptor,
  type ModelPreset,
  type ReasoningEffort,
} from "./types";

// Model IDs, not the UI's suggestion group, determine wire capabilities.
// Unknown aliases deliberately use the service default (no effort parameter).
export function isDeepSeekReasoningModel(preset: ModelPreset): boolean {
  if (preset.provider === "anthropic" && preset.extras?.vendor !== "deepseek")
    return false;
  return /^deepseek-(?:v4(?:[.-]\d+)?-(?:pro|flash)|flash|pro)(?:$|[-/])/i.test(
    preset.model,
  );
}

function supportedEfforts(preset: ModelPreset): ReasoningEffort[] {
  const model = preset.model.toLowerCase();
  if (preset.provider === "anthropic" && preset.extras?.vendor === "compat")
    return [];
  if (isDeepSeekReasoningModel(preset)) return ["none", "low", "high", "max"];
  if (preset.provider === "anthropic") {
    if (preset.extras?.vendor !== "claude") return [];
    if (/^claude-opus-4-[78](?:$|-)/.test(model)) {
      return ["none", "low", "medium", "high", "xhigh", "max"];
    }
    if (/^claude-(?:opus|sonnet)-4-6(?:$|-)/.test(model)) {
      return ["none", "low", "medium", "high", "max"];
    }
    if (
      /^claude-(?:(?:opus|sonnet)-4(?:-5)?|haiku-4-5|3-7-sonnet)(?:$|-\d{8}$)/.test(
        model,
      )
    ) {
      return ["none", "low", "medium", "high", "xhigh"];
    }
    return [];
  }
  if (/^gpt-6-astra(?:$|-)/.test(model))
    return ["low", "medium", "high", "xhigh", "max"];
  if (
    /^gpt-(?:5\.6(?:-(?:sol|terra|luna))?|6-(?:sol|luna))(?:$|-)/.test(model)
  ) {
    return ["none", "low", "medium", "high", "xhigh", "max"];
  }
  if (/^gpt-5\.[23]-codex(?:$|-)/.test(model))
    return ["low", "medium", "high", "xhigh"];
  // Pro variants have different ranges; do not infer from the base model.
  if (/^gpt-5\.[245](?:-(?:mini|nano))?(?:$|-\d{4}-\d{2}-\d{2}$)/.test(model)) {
    return ["none", "low", "medium", "high", "xhigh"];
  }
  if (/^gpt-5\.1(?:$|-\d{4}-\d{2}-\d{2}$)/.test(model))
    return ["none", "low", "medium", "high"];
  if (/^gpt-5(?:-(?:mini|nano))?(?:$|-\d{4}-\d{2}-\d{2}$)/.test(model))
    return ["minimal", "low", "medium", "high"];
  if (/^(?:o3|o3-mini|o4-mini)(?:$|-\d{4}-\d{2}-\d{2}$)/.test(model))
    return ["low", "medium", "high"];
  return [];
}

export function reasoningEffortOptionsForPreset(
  preset: ModelPreset,
): Array<[ReasoningEffort, string]> {
  const budget =
    preset.provider === "anthropic" &&
    preset.extras?.vendor === "claude" &&
    findClaudeDescriptor(preset.model).thinkingDialect === "enabled";
  const budgets: Partial<Record<ReasoningEffort, number>> = {
    low: 1024,
    medium: 2048,
    high: 4096,
    xhigh: 8192,
  };
  return supportedEfforts(preset).map((effort) => [
    effort,
    budget && budgets[effort]
      ? `${effort} - 思考预算 ${budgets[effort]} tokens`
      : REASONING_EFFORT_OPTIONS.find(([value]) => value === effort)![1],
  ]);
}

export function collapseReasoningForPreset(
  preset: ModelPreset,
  effort: ReasoningEffort,
): ReasoningEffort | undefined {
  const supported = supportedEfforts(preset);
  if (!supported.length) return undefined;
  if (supported.includes(effort)) return effort;
  if (isDeepSeekReasoningModel(preset)) {
    if (effort === "minimal") return "low";
    // Legacy Anthropic configurations used xhigh as a stored alias for max.
    if (effort === "xhigh" && preset.provider === "anthropic") return "max";
    return "high";
  }
  if (effort === "xhigh" && supported.includes("max")) return "max";
  if (effort === "max" || effort === "xhigh")
    return supported[supported.length - 1];
  if (effort === "none" || effort === "minimal")
    return supported.includes("none") ? "none" : supported[0];
  return supported.includes("medium") ? "medium" : "high";
}

export function effectiveReasoningEffort(
  preset: ModelPreset,
): ReasoningEffort | undefined {
  const choices = preset.extras?.reasoningEffortByModel;
  const perModel =
    choices && Object.prototype.hasOwnProperty.call(choices, preset.model)
      ? choices[preset.model]
      : undefined;
  return collapseReasoningForPreset(
    preset,
    perModel ??
      preset.extras?.reasoningEffort ??
      DEFAULT_REASONING_EFFORT,
  );
}

export function withModelReasoningEffort(
  preset: ModelPreset,
  effort: ReasoningEffort,
): ModelPreset {
  return {
    ...preset,
    extras: {
      ...preset.extras,
      reasoningEffortByModel: {
        ...preset.extras?.reasoningEffortByModel,
        [preset.model]: effort,
      },
    },
  };
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return REASONING_EFFORT_OPTIONS.some(([effort]) => value === effort);
}
