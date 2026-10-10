import {
  collapseReasoningForPreset,
  effectiveReasoningEffort,
  reasoningEffortOptionsForPreset,
} from "../settings/reasoning";
import type { ModelPreset, ReasoningEffort } from "../settings/types";
import { uiText } from "../utils/ui-locale";

export interface ReasoningControls {
  element: HTMLElement;
  refresh(preset: ModelPreset, models: string[]): void;
  values(): Record<string, ReasoningEffort>;
}

export function mergeReasoningEffortByModel(
  previous: Record<string, ReasoningEffort> | undefined,
  changes: Record<string, ReasoningEffort>,
): Record<string, ReasoningEffort> | undefined {
  if (!previous && Object.keys(changes).length === 0) return undefined;
  return Object.fromEntries(
    Object.entries(previous ?? {}).concat(Object.entries(changes)),
  );
}

export function createReasoningControls(
  doc: Document,
  preset: ModelPreset,
  models: string[],
): ReasoningControls {
  const element = doc.createElement("div");
  element.className = "zai-reasoning-controls";
  const selectors = new Map<string, HTMLSelectElement>();
  const explicitModels = new Set<string>();

  const refresh = (nextPreset: ModelPreset, nextModels: string[]) => {
    const priorValues = values();
    selectors.clear();
    element.replaceChildren();
    for (const model of nextModels) {
      const modelPreset: ModelPreset = { ...nextPreset, model };
      const options = reasoningEffortOptionsForPreset(modelPreset);
      const select = doc.createElement("select");
      select.dataset.model = model;
      select.setAttribute(
        "aria-label",
        uiText(`推理强度：${model}`, `Reasoning effort: ${model}`),
      );
      if (options.length === 0) {
        const option = doc.createElement("option");
        option.value = "";
        option.textContent = uiText(
          "服务商默认（不发送推理参数）",
          "Provider default (no reasoning parameter sent)",
        );
        select.append(option);
        select.disabled = true;
      } else {
        for (const [value, label] of options) {
          const option = doc.createElement("option");
          option.value = value;
          option.textContent = label;
          select.append(option);
        }
        const prior = priorValues[model];
        const preferred =
          (prior && options.some(([value]) => value === prior)
            ? prior
            : prior
              ? collapseReasoningForPreset(modelPreset, prior)
              : undefined) ??
          effectiveReasoningEffort(modelPreset) ??
          (nextPreset.extras?.reasoningEffort
            ? collapseReasoningForPreset(
                modelPreset,
                nextPreset.extras.reasoningEffort,
              )
            : undefined);
        if (preferred && options.some(([value]) => value === preferred)) {
          select.value = preferred;
        } else {
          select.value = options[0][0];
        }
      }
      selectors.set(model, select);
      if (explicitModels.has(model)) select.dataset.explicit = "true";
      select.addEventListener("input", () => {
        explicitModels.add(model);
        select.dataset.explicit = "true";
      });
      select.addEventListener("change", () => {
        explicitModels.add(model);
        select.dataset.explicit = "true";
      });
      const row = doc.createElement("label");
      row.className = "zai-reasoning-model-row";
      const name = doc.createElement("span");
      name.textContent = model;
      row.append(name, select);
      element.append(row);
    }
  };

  const values = (): Record<string, ReasoningEffort> =>
    Object.fromEntries(
      Array.from(selectors.entries())
        .filter(([, select]) => !select.disabled && select.value)
        .map(([model, select]) => [model, select.value as ReasoningEffort]),
    );

  refresh(preset, models);
  return { element, refresh, values };
}
