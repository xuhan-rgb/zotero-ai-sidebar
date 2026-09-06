export function el(
  doc: Document,
  tag: string,
  className = "",
  text?: string,
): HTMLElement {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function buttonEl(doc: Document, text: string): HTMLButtonElement {
  const button = doc.createElement("button");
  button.textContent = text;
  return button;
}

export function inputEl(
  doc: Document,
  value: string,
  type = "text",
): HTMLInputElement {
  const input = doc.createElement("input");
  input.type = type;
  input.value = value;
  return input;
}

export function selectEl(
  doc: Document,
  options: Array<[string, string]>,
): HTMLSelectElement {
  const select = doc.createElement("select");
  for (const [value, label] of options) {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  return select;
}

// Replace a <select>'s <option> children in place. Used when the option
// set depends on dynamic state (e.g. preset vendor) and the dropdown was
// already built. Setting `.value` after replaceChildren picks the closest
// surviving entry; if `value` isn't in the new options, the browser falls
// back to the first one.
export function repopulateSelect(
  select: HTMLSelectElement,
  options: Array<[string, string]>,
  value: string,
): void {
  // ownerDocument is typed nullable but is always set for nodes that have
  // been appended to a tree; `select` here is one we just created in the
  // editor. The non-null assertion keeps the helper free of a defensive
  // branch that can never trigger in practice.
  const doc = select.ownerDocument!;
  select.replaceChildren();
  for (const [optionValue, label] of options) {
    const option = doc.createElement("option");
    option.value = optionValue;
    option.textContent = label;
    select.append(option);
  }
  select.value = value;
}

export function field(
  doc: Document,
  label: string,
  control: HTMLElement,
): HTMLElement {
  const wrapper = el(doc, "label", "prefs-field");
  wrapper.append(el(doc, "span", "", label), control);
  return wrapper;
}

export function closestElement(node: Node | null, selector: string): Element | null {
  const start =
    node && node.nodeType === 1
      ? (node as Element)
      : ((node as { parentElement?: Element | null } | null)?.parentElement ??
        null);
  return typeof start?.closest === "function" ? start.closest(selector) : null;
}
