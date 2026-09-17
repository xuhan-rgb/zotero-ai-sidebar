import { readSystemProxyPort } from "../context/latex-download";
import { arxivSourceError } from "../context/arxiv-source";
import {
  DEFAULT_LATEX_PROXY,
  loadLatexProxy,
  saveLatexProxy,
} from "../settings/latex-proxy";
import { zoteroPrefs } from "../settings/storage";
import {
  checkLatexSourceAvailability,
  resetLatexSourceAvailability,
} from "./latex-source-availability";

export function renderLatexSourceControls(
  doc: Document,
  arxivId: string,
  onTranslate: () => void,
): HTMLElement {
  const root = doc.createElement("span");
  root.className = "latex-source-controls";
  const badge = doc.createElement("span");
  badge.className = "arxiv-source-badge";
  const button = (label: string) => {
    const element = doc.createElement("button");
    element.type = "button";
    element.className = "arxiv-full-translation-button";
    element.textContent = label;
    return element;
  };
  const retry = button("重试");
  const configure = button("代理设置");
  const translate = button("全文翻译");
  translate.addEventListener("click", onTranslate);
  translate.hidden = true;
  const toolbar = doc.createElement("span");
  toolbar.className = "latex-source-toolbar";
  toolbar.append(badge, retry, configure, translate);
  root.append(toolbar);
  let generation = 0;
  const check = async () => {
    const current = ++generation;
    retry.hidden = true;
    translate.hidden = true;
    badge.textContent = "正在获取 LaTeX…";
    badge.title = "检查本地缓存；缺少有效缓存时自动下载并处理源码";
    const result = await checkLatexSourceAvailability(arxivId);
    if (current !== generation) return;
    if (result === "available") {
      badge.textContent = "LaTeX 源";
      badge.title = "LaTeX 源码已就绪";
      translate.hidden = false;
    } else if (result === "no-source") {
      badge.textContent = "无 LaTeX 源";
      badge.title =
        "当前 arXiv 条目没有 LaTeX 源码；可点全文翻译，用 MinerU 解析 PDF";
      translate.hidden = false;
    } else {
      const reason = arxivSourceError(arxivId) || "无法检查源码，请重试";
      badge.textContent = reason.startsWith("下载超时")
        ? "LaTeX 下载超时"
        : "LaTeX 获取失败";
      badge.title = reason;
      retry.hidden = false;
    }
  };
  retry.addEventListener("click", () => {
    void check();
  });
  configure.addEventListener("click", () => {
    const existing = root.querySelector(".latex-proxy-settings");
    if (existing) {
      existing.remove();
      return;
    }
    const prefs = zoteroPrefs();
    let settings;
    try {
      settings = loadLatexProxy(prefs);
    } catch {
      settings = { ...DEFAULT_LATEX_PROXY };
    }
    const panel = doc.createElement("span");
    panel.className = "latex-proxy-settings";
    const description = doc.createElement("span");
    description.textContent =
      "仅用于 LaTeX 源码下载；本机所有论文共用。系统代理读取操作系统的代理配置。";
    const mode = doc.createElement("select");
    mode.setAttribute("aria-label", "LaTeX 下载连接方式");
    for (const [value, label] of [
      ["system", "系统代理"],
      ["direct", "不使用代理"],
    ]) {
      const option = doc.createElement("option");
      option.value = value;
      option.textContent = label;
      mode.append(option);
    }
    mode.value = settings.mode;
    const error = doc.createElement("span");
    error.className = "latex-proxy-error";
    error.setAttribute("role", "alert");
    const portRow = doc.createElement("label");
    portRow.className = "latex-proxy-port";
    portRow.append("代理端口（Port）");
    const port = doc.createElement("input");
    port.type = "number";
    port.min = "1";
    port.max = "65535";
    port.setAttribute("aria-label", "代理端口");
    portRow.append(port);
    let manualPort = settings.portOverride !== undefined;
    let systemPort: number | null = null;
    const portStatus = doc.createElement("span");
    const restore = button("恢复跟随系统");
    const updatePortStatus = () => {
      portStatus.textContent = manualPort
        ? "自定义端口，仅用于 LaTeX 下载；代理地址仍跟随系统。"
        : systemPort === null
          ? "系统未为此下载地址提供代理端口。"
          : "端口跟随系统，修改后可保存为 LaTeX 下载专用端口。";
    };
    const readPort = () => {
      try {
        systemPort = readSystemProxyPort(
          `https://arxiv.org/e-print/${arxivId}`,
        );
      } catch (reason) {
        error.textContent =
          reason instanceof Error ? reason.message : String(reason);
      }
      port.value = String(
        manualPort ? settings.portOverride : (systemPort ?? ""),
      );
      port.disabled = systemPort === null;
      updatePortStatus();
    };
    const updatePortVisibility = () => {
      portRow.hidden =
        portStatus.hidden =
        restore.hidden =
          mode.value !== "system";
    };
    port.addEventListener("input", () => {
      manualPort = true;
      updatePortStatus();
    });
    restore.addEventListener("click", () => {
      manualPort = false;
      readPort();
    });
    mode.addEventListener("change", updatePortVisibility);
    readPort();
    updatePortVisibility();
    const save = button("保存并重试");
    save.classList.add("latex-proxy-save");
    save.addEventListener("click", () => {
      try {
        saveLatexProxy(prefs, {
          mode: mode.value === "direct" ? "direct" : "system",
          ...(mode.value === "system" && manualPort
            ? { portOverride: Number(port.value) }
            : {}),
        });
        resetLatexSourceAvailability(arxivId);
        panel.remove();
        void check();
      } catch (reason) {
        error.textContent =
          reason instanceof Error ? reason.message : String(reason);
      }
    });
    const cancel = button("取消");
    cancel.addEventListener("click", () => panel.remove());
    const actions = doc.createElement("span");
    actions.className = "latex-proxy-actions";
    const submitActions = doc.createElement("span");
    submitActions.className = "latex-proxy-submit-actions";
    submitActions.append(save, cancel);
    actions.append(restore, submitActions);
    panel.append(description, mode, portRow, portStatus, error, actions);
    root.append(panel);
  });
  void check();
  return root;
}
