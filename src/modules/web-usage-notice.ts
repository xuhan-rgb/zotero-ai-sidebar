import { version as ADDON_VERSION } from "../../package.json";
import { buttonEl, el } from "./dom-utils";
import { copyToClipboard, flashButton } from "./clipboard-utils";
import {
  DEFAULT_MATERIAL_PICK_SHORTCUT,
  getMaterialPickShortcut,
  materialShortcutFromEvent,
  setMaterialPickShortcut,
} from "./material-shortcut";
import { PROJECT_ISSUES_URL, PROJECT_URL, renderSupportQr } from "./support-qr";
import { zoteroPrefs } from "../settings/storage";

const NOTICE_TITLE = "使用须知";

/** Read/write access to the 素材 shortcut, injected where prefs are usable. */
export interface MaterialShortcutControl {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Where the material list comes from: it decides what `@` can offer and
 * whether an item can be picked on the PDF itself.
 */
const SOURCE_ROWS: Array<[string, string]> = [
  [
    "LaTeX 源",
    "标题带「LaTeX 源」徽章：公式和表格取源码最准；素材在 PDF 上没有位置，点「素材」直接开列表，在 PDF 上点一下会提示不可点击。页码按 Figure N / 公式编号反查。",
  ],
  [
    "MinerU 解析稿",
    "普通 PDF 解析完显示「PDF 已解析」：素材带页内坐标，可在左侧 PDF 上点选、悬停高亮。",
  ],
  [
    "都没就绪",
    "列表为空：先等 LaTeX 源下载或 MinerU 解析，或自己用 ＋ → 截图 / 图片 附图。",
  ],
];

const MATERIAL_ROWS: Array<[string, string]> = [
  [
    "@ 打开列表",
    "顶部 本页 / 全部 / 图片 / 表格 / 公式，默认只列当前页；取点期间左侧不选文字，不会误进对话。",
  ],
  [
    "「素材」按钮",
    "点亮后在左侧 PDF 点图 / 表 / 公式框，空白处不响应；LaTeX 源论文自动改为打开列表。",
  ],
  [
    "发出去",
    "图片随消息发送；表格和公式只插 [表 #1] 短标签，发送时展开成 LaTeX。",
  ],
  [
    "页码",
    "「本页」「第 N 页」是准的；「第 N–M 页·推测」只能确定在相邻素材之间。",
  ],
];

const MODE_ROWS: Array<[string, string, string]> = [
  [
    "发送目标",
    "Zotero 里配置的模型预设",
    "ChatGPT / DeepSeek / ChatGLM / Z.ai / Kimi 或自定义网页",
  ],
  ["认证方式", "Zotero 设置里的 API Key", "在专用浏览器里自己登录网页"],
  [
    "工具能力",
    "可以使用 Zotero 与模型工具循环",
    "只同步网页回答，不运行工具循环",
  ],
  ["论文上下文", "由输入行的「原文」控制", "由网页上传流程自动附带论文材料"],
  [
    "联网",
    "「联网」使用 API Web Search",
    "「联网」不可用，请用网页自己的搜索开关",
  ],
  [
    "图片 / 图表",
    "可以直接附图，随消息一起发送",
    "默认不发送论文插图，只带图注文字",
  ],
  [
    "附件 / 下载",
    "附件走本地文件，生成的文件直接存回 Zotero",
    "只上传论文材料；网页给出下载链接才能存回 Zotero",
  ],
];

const IMAGE_PATHS: Array<[string, string]> = [
  ["截图 / 本机图片", "输入框 ＋ → 截图 / 图片，图片会随消息一起上传给网页。"],
  [
    "@ 选论文素材",
    "输入框里打 @ 挑图片、表格和公式；已解析的 PDF 会先列出你正在看的那一页，也可以按「图片 / 表格 / 公式」切换。图片随消息上传；表格和公式先插入短标签，发送时才展开成 LaTeX 文字。",
  ],
];

const API_PATHS: Array<[string, string]> = [
  [
    "图片随消息发送",
    "输入框 ＋ → 截图 / 图片，或直接 Ctrl+V 粘贴，图片与消息一起发给模型。",
  ],
  [
    "图表与公式",
    "输入框里打 @：图片、表格、公式都能选；表格和公式先插入短标签，发送时才展开成 LaTeX 源码。",
  ],
  [
    "论文上下文",
    "由输入行的「原文」控制：附带 LaTeX 源码、MinerU 解析稿或 PDF 原件。",
  ],
];

/**
 * Opens with how the paper's material is produced (LaTeX source, MinerU parse,
 * or neither), then how `@` material is picked and sent — including the pick
 * mode's lock on the left PDF, where a page is a pick surface rather than
 * selectable prose. Then compares API and WEB mode — above all that WEB's
 * automatic paper material is text-only: the
 * downloaded Markdown carries figure captions but no image data, so the web
 * model never sees the figures.
 * The material section is followed by the 素材 shortcut recorder.
 */
export function renderWebUsageNotice(
  doc: Document,
  onClose: () => void,
  materialShortcut?: MaterialShortcutControl,
): HTMLElement {
  const layer = el(doc, "div", "zai-web-notice-layer");
  const dialog = el(doc, "section", "zai-web-notice");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", NOTICE_TITLE);

  const header = el(doc, "header", "zai-web-notice-header");
  const close = buttonEl(doc, "×");
  close.className = "zai-web-notice-close";
  close.setAttribute("aria-label", "关闭");
  close.title = "关闭";
  close.addEventListener("click", onClose);
  header.append(el(doc, "strong", "zai-web-notice-title", NOTICE_TITLE), close);

  const body = el(doc, "div", "zai-web-notice-body");
  const callout = el(doc, "div", "zai-web-notice-callout");
  callout.append(
    el(doc, "strong", "zai-web-notice-callout-title", "WEB 默认不发送图片"),
    el(
      doc,
      "span",
      "zai-web-notice-callout-text",
      "插件附带给网页的是论文的文字材料——LaTeX 源码，或 MinerU 解析出的 Markdown。解析稿里的插图、表格只有图注文字，图本身不会上传，网页模型看不到版式和图表。论文还没解析时会改发 PDF 原件。",
    ),
  );
  body.append(
    renderNoticeSection(doc, "论文材料从哪来", SOURCE_ROWS),
    renderNoticeSection(doc, "素材怎么用", MATERIAL_ROWS),
    ...(materialShortcut
      ? [renderMaterialShortcutSection(doc, materialShortcut)]
      : []),
    callout,
    renderModeTable(doc),
  );
  body.append(renderNoticeSection(doc, "API 模式", API_PATHS));
  body.append(
    renderNoticeSection(doc, "WEB 模式：想让网页模型看图", IMAGE_PATHS),
  );
  body.append(renderProjectRow(doc), renderSupportSection(doc));
  dialog.append(header, body);

  const footer = el(doc, "footer", "zai-web-notice-actions");
  const confirm = buttonEl(doc, "知道了");
  confirm.className = "zai-web-notice-confirm";
  confirm.addEventListener("click", onClose);
  footer.append(confirm);
  dialog.append(footer);

  layer.append(dialog);
  return layer;
}

/**
 * The 素材 shortcut is recorded here instead of the preferences 显示设置 page:
 * it belongs next to the pick-mode description it toggles.
 */
function renderMaterialShortcutSection(
  doc: Document,
  shortcut: MaterialShortcutControl,
): HTMLElement {
  const section = el(doc, "div", "zai-web-notice-section");
  section.append(el(doc, "strong", "", "素材快捷键"));
  const row = el(doc, "div", "zai-web-notice-shortcut");
  const field = doc.createElement("input");
  field.type = "text";
  field.readOnly = true;
  field.className = "zai-web-notice-shortcut-field";
  field.value = shortcut.value;
  field.setAttribute("aria-label", "素材快捷键");
  field.title = "点一下输入框，再按下组合键即可改键";
  field.addEventListener("keydown", (event) => {
    const binding = materialShortcutFromEvent(event as KeyboardEvent);
    if (!binding) return;
    event.preventDefault();
    event.stopPropagation();
    field.value = binding;
    shortcut.onChange(binding);
  });
  row.append(
    field,
    el(
      doc,
      "span",
      "zai-web-notice-shortcut-hint",
      `点一下输入框再按组合键即可改键；默认 ${DEFAULT_MATERIAL_PICK_SHORTCUT}，组合里要有 Ctrl / Alt / Meta。`,
    ),
  );
  section.append(row);
  return section;
}

/**
 * Zotero chrome documents do not follow anchor navigation, so every external
 * link has to be handed to Zotero, which opens the system browser.
 */
function openExternalUrl(url: string): void {
  (
    globalThis as unknown as { Zotero?: { launchURL?: (url: string) => void } }
  ).Zotero?.launchURL?.(url);
}

/** External links need `target=_blank` + `rel=noreferrer` in a XUL window. */
function externalLink(doc: Document, href: string, label: string): Element {
  const anchor = doc.createElement("a");
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  anchor.textContent = label;
  anchor.addEventListener("click", (event) => {
    event.preventDefault();
    openExternalUrl(href);
  });
  return anchor;
}

function renderProjectRow(doc: Document): HTMLElement {
  const row = el(doc, "div", "zai-web-notice-project");
  row.append(
    el(doc, "span", "", "项目"),
    externalLink(doc, PROJECT_URL, "github.com/xuhan-rgb/zotero-ai-sidebar"),
    el(doc, "span", "zai-web-notice-project-sep", "·"),
    el(doc, "span", "", "有问题请"),
    externalLink(doc, PROJECT_ISSUES_URL, "提 Issue"),
    el(doc, "span", "zai-web-notice-project-sep", "·"),
    environmentCopyButton(doc),
  );
  return row;
}

interface ZoteroGlobals {
  version?: string;
  isWin?: boolean;
  isMac?: boolean;
  isLinux?: boolean;
  getOSVersion?: () => Promise<string>;
}

function zoteroGlobals(): ZoteroGlobals | undefined {
  return (
    globalThis as unknown as {
      Zotero?: ZoteroGlobals;
    }
  ).Zotero;
}

function osLabel(): string {
  const zotero = zoteroGlobals();
  return zotero?.isWin
    ? "Windows"
    : zotero?.isMac
      ? "macOS"
      : zotero?.isLinux
        ? "Linux"
        : "";
}

function environmentCopyButton(doc: Document): HTMLButtonElement {
  const button = buttonEl(doc, "复制环境信息");
  button.className = "zai-web-notice-copy-env";
  button.title = "复制插件版本、Zotero 版本与系统到剪贴板，提 Issue 时粘进「环境信息」";
  button.addEventListener("click", () => {
    flashButton(button, "已复制");
    void copyEnvironmentSummary(doc);
  });
  return button;
}

/**
 * GitHub cannot prefill an issue form with the reporter's own versions, so the
 * running app copies them out ready to paste into the form's 环境信息 field.
 * `Zotero.getOSVersion()` is newer than the supported range, so it is optional.
 */
async function copyEnvironmentSummary(doc: Document): Promise<void> {
  let os = osLabel();
  try {
    const detail = await zoteroGlobals()?.getOSVersion?.();
    if (detail) os = trimOsDetail(detail);
  } catch {
    // Keep the plain Windows / macOS / Linux label.
  }
  const summary = [
    `XPI ${ADDON_VERSION}`,
    `Zotero ${zoteroGlobals()?.version ?? "未知"}`,
    os,
  ]
    .filter(Boolean)
    .join(" · ");
  await copyToClipboard(doc, summary, "usage-notice-env");
}

/**
 * `getOSVersion()` appends the kernel build stamp, e.g.
 * `Linux 5.15.0-191-generic #201-Ubuntu SMP Fri Aug 7 18:39:04 UTC 2026`.
 * The build time is noise in a bug report, so only the OS name and version stay.
 */
function trimOsDetail(detail: string): string {
  return detail.split("#")[0].replace(/\s+/g, " ").trim();
}

/**
 * The support QR stays collapsed and is drawn only once it is opened: the
 * plugin ships the Alipay link, never the image. Clicking the same chip again
 * collapses the code, because Alipay's page owns both the amount and any note.
 */
function renderSupportSection(doc: Document): HTMLElement {
  const section = el(doc, "div", "zai-web-notice-support");
  const toggle = buttonEl(doc, "Buy me a coffee");
  toggle.className = "zai-web-notice-support-toggle";
  toggle.title = "支付宝扫码请我喝杯咖啡；再点一次收起";
  toggle.setAttribute("aria-expanded", "false");
  toggle.append(el(doc, "span", "zai-web-notice-support-brand", "支付宝"));
  const panel = el(doc, "div", "zai-web-notice-support-panel");
  panel.hidden = true;
  toggle.addEventListener("click", () => {
    const opening = Boolean(panel.hidden);
    if (opening && !panel.hasChildNodes()) {
      const frame = el(doc, "div", "zai-web-notice-qr-frame");
      frame.append(renderSupportQr(doc));
      panel.append(frame);
    }
    panel.hidden = !opening;
    toggle.setAttribute("aria-expanded", String(opening));
    toggle.classList.toggle("is-open", opening);
  });
  section.append(toggle, panel);
  return section;
}

function renderModeTable(doc: Document): HTMLElement {
  const table = el(doc, "table", "zai-web-notice-table");
  const head = doc.createElement("thead");
  const headRow = doc.createElement("tr");
  for (const label of ["项目", "API 模式", "WEB 模式"]) {
    const cell = el(doc, "th", "", label);
    if (label === "WEB 模式") cell.className = "is-web";
    headRow.append(cell);
  }
  head.append(headRow);
  const body = doc.createElement("tbody");
  for (const [item, api, web] of MODE_ROWS) {
    const row = doc.createElement("tr");
    row.append(
      el(doc, "td", "zai-web-notice-item", item),
      el(doc, "td", "", api),
      el(doc, "td", "is-web", web),
    );
    body.append(row);
  }
  table.append(head, body);
  return table;
}

function renderNoticeSection(
  doc: Document,
  title: string,
  rows: Array<[string, string]>,
): HTMLElement {
  const section = el(doc, "div", "zai-web-notice-section");
  section.append(el(doc, "strong", "", title));
  const list = el(doc, "ul", "zai-web-notice-list");
  for (const [name, detail] of rows) {
    const item = doc.createElement("li");
    item.append(el(doc, "b", "", name), el(doc, "span", "", detail));
    list.append(item);
  }
  section.append(list);
  return section;
}

/** Prefs are touched lazily: the notice also renders where Zotero is absent. */
function materialShortcutControl(): MaterialShortcutControl | undefined {
  try {
    const prefs = zoteroPrefs();
    return {
      value: getMaterialPickShortcut(prefs),
      onChange: (value) => setMaterialPickShortcut(prefs, value),
    };
  } catch {
    return undefined;
  }
}

/** Opens the notice above the sidebar; only one copy can be open at a time. */
export function openWebUsageNotice(mount: HTMLElement): void {
  const doc = mount.ownerDocument;
  if (!doc) return;
  doc.querySelector(".zai-web-notice-layer")?.remove();

  let layer: HTMLElement | null = null;
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  const close = () => {
    doc.removeEventListener("keydown", onKeydown, true);
    layer?.remove();
    layer = null;
  };

  layer = renderWebUsageNotice(doc, close, materialShortcutControl());
  layer.addEventListener("click", (event) => {
    if (event.target === layer) close();
  });
  doc.addEventListener("keydown", onKeydown, true);
  mount.before(layer);
  (
    layer.querySelector(".zai-web-notice-confirm") as HTMLElement | null
  )?.focus();
}
