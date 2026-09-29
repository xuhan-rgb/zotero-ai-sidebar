import {
  effectiveReasoningEffort,
  reasoningEffortOptionsForPreset,
  withModelReasoningEffort,
} from "../settings/reasoning";
import type { ModelPreset } from "../settings/types";

export function renderComposerReasoningSelect(
  doc: Document,
  preset: ModelPreset | null,
  disabled: boolean,
  onChange: (preset: ModelPreset) => void,
): HTMLElement {
  const label = doc.createElement("label");
  label.className = "composer-reasoning";
  if (!preset) {
    label.hidden = true;
    return label;
  }
  const select = doc.createElement("select");
  select.setAttribute("aria-label", "推理强度");
  const options = reasoningEffortOptionsForPreset(preset);
  for (const [value, description] of options) {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent =
      value === "none" ? "关闭" : description.split(" - ")[0];
    option.title = description;
    select.append(option);
  }
  if (!options.length) {
    const option = doc.createElement("option");
    option.textContent = "服务商默认";
    option.value = "";
    select.append(option);
  }
  select.value = effectiveReasoningEffort(preset) ?? "";
  select.disabled = disabled || !options.length;
  const updateTitle = () => {
    select.title = options.length
      ? `推理强度：${options.find(([value]) => value === select.value)?.[1] ?? select.value}`
      : "当前模型未识别推理档位，不发送推理参数";
  };
  updateTitle();
  select.addEventListener("change", () => {
    const selected = options.find(([value]) => value === select.value);
    if (select.disabled || !selected) return;
    updateTitle();
    onChange(withModelReasoningEffort(preset, selected[0]));
  });
  label.append(select);
  return label;
}
