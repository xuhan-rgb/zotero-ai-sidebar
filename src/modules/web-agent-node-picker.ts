import { uiText } from "../utils/ui-locale";
import { selectWebAgentNode } from "./web-agent-installer";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

export function renderWebAgentNodePicker(
  doc: Document,
  chooseExecutable: () => Promise<string | null>,
  onSaved: () => Promise<void>,
): HTMLDetailsElement {
  const root = doc.createElementNS(XHTML_NS, "details") as HTMLDetailsElement;
  root.className = "zai-web-account-node-settings";
  root.open = true;
  const summary = doc.createElementNS(XHTML_NS, "summary") as HTMLElement;
  summary.textContent = uiText("Node.js 路径设置", "Node.js path settings");
  const fields = doc.createElementNS(XHTML_NS, "div") as HTMLDivElement;
  fields.className = "zai-web-account-node-picker";
  const input = doc.createElementNS(XHTML_NS, "input") as HTMLInputElement;
  input.type = "text";
  input.setAttribute(
    "aria-label",
    uiText("Node 程序或目录", "Node executable or directory"),
  );
  input.placeholder = uiText(
    "粘贴 node 程序或其所在目录的完整路径",
    "Paste the full path to Node or its directory",
  );
  const actions = doc.createElementNS(XHTML_NS, "div") as HTMLDivElement;
  actions.className = "zai-web-account-node-actions";
  const choose = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
  choose.type = "button";
  choose.textContent = uiText("选择 Node 程序…", "Choose Node executable…");
  const save = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
  save.type = "button";
  save.textContent = uiText("验证并使用", "Validate and use");
  const status = doc.createElementNS(XHTML_NS, "small") as HTMLElement;
  status.setAttribute("role", "status");
  actions.append(choose, save);
  fields.append(input, actions, status);
  root.append(summary, fields);
  let busy = false;
  const setBusy = (value: boolean) => {
    busy = value;
    choose.disabled = save.disabled = input.disabled = value;
  };
  choose.addEventListener("click", () => {
    if (busy) return;
    setBusy(true);
    void chooseExecutable()
      .then((path) => {
        if (path) input.value = path;
      })
      .catch((error) => {
        status.textContent = String(error?.message || error);
      })
      .finally(() => setBusy(false));
  });
  const validate = () => {
    if (busy) return;
    setBusy(true);
    status.textContent = uiText("正在验证 Node.js…", "Validating Node.js…");
    void selectWebAgentNode(input.value)
      .then(async (node) => {
        status.textContent = uiText(
          `已确认 Node.js ${node.version}`,
          `Node.js ${node.version} verified`,
        );
        await onSaved();
      })
      .catch((error) => {
        status.textContent = String(error?.message || error);
      })
      .finally(() => setBusy(false));
  };
  save.addEventListener("click", validate);
  input.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Enter") {
      event.preventDefault();
      validate();
    }
  });
  return root;
}
