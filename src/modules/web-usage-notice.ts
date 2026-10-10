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
import { uiText } from "../utils/ui-locale";

type NoticeText = string | (() => string);
const noticeText = (zh: string, en: string): (() => string) => () => uiText(zh, en);
const NOTICE_TITLE = () => uiText("使用须知", "Usage guide");

/** Read/write access to the 素材 shortcut, injected where prefs are usable. */
export interface MaterialShortcutControl {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Where the material list comes from: it decides what `@` can offer and
 * whether an item can be picked on the PDF itself.
 */
const SOURCE_ROWS: Array<[NoticeText, NoticeText]> = [
  [
    noticeText("LaTeX 源", "LaTeX source"),
    noticeText("标题带「LaTeX 源」徽章：公式和表格取源码最准；素材在 PDF 上没有位置，点「素材」直接开列表，在 PDF 上点一下会提示不可点击。页码按 Figure N / 公式编号反查。", "Items marked LaTeX source have the most accurate equations and tables. Materials have no position on the PDF, so click Materials to open the list; clicking the PDF will show that picking is unavailable. Pages are inferred from figure numbers or equation numbers."),
  ],
  [
    noticeText("MinerU 解析稿", "MinerU parse"),
    noticeText("普通 PDF 解析完显示「PDF 已解析」：素材带页内坐标，可在左侧 PDF 上点选、悬停高亮。", "After a regular PDF is parsed, it shows PDF parsed. Materials have page coordinates and can be selected or highlighted on the PDF."),
  ],
  [
    noticeText("都没就绪", "Neither is ready"),
    noticeText("列表为空：先等 LaTeX 源下载或 MinerU 解析，或自己用 ＋ → 截图 / 图片 附图。", "If the list is empty, wait for the LaTeX source download or MinerU parsing, or attach an image with + → Screenshot / Image."),
  ],
];

const MATERIAL_ROWS: Array<[NoticeText, NoticeText]> = [
  [
    noticeText("@ 打开列表", "@ opens the list"),
    noticeText("顶部 本页 / 全部 / 图片 / 表格 / 公式，默认只列当前页；取点期间左侧不选文字，不会误进对话。", "The top filters are This page / All / Images / Tables / Equations; only this page is shown by default. Picking on the left PDF does not select text or enter it into the conversation."),
  ],
  [
    noticeText("「素材」按钮", "Materials button"),
    noticeText("点亮后在左侧 PDF 点图 / 表 / 公式框，空白处不响应；LaTeX 源论文自动改为打开列表。", "When enabled, click a figure, table, or equation box on the left PDF; blank areas do nothing. LaTeX source papers open the list instead."),
  ],
  [
    noticeText("发出去", "Sending"),
    noticeText("图片随消息发送；表格和公式只插 [表 #1] 短标签，发送时展开成 LaTeX。", "Images are sent with the message. Tables and equations use short markers such as [表 #1], expanded to LaTeX when sent."),
  ],
  [
    noticeText("页码", "Page numbers"),
    noticeText("「本页」「第 N 页」是准的；「第 N–M 页·推测」只能确定在相邻素材之间。", "This page and Page N are exact. An estimated range such as Pages N–M only places the item between neighboring materials."),
  ],
];

const MODE_ROWS: Array<[NoticeText, NoticeText, NoticeText]> = [
  [
    noticeText("发送目标", "Destination"),
    noticeText("Zotero 里配置的模型预设", "Model preset configured in Zotero"),
    noticeText("ChatGPT / DeepSeek / ChatGLM / Z.ai / Kimi 或自定义网页", "ChatGPT / DeepSeek / ChatGLM / Z.ai / Kimi or a custom website"),
  ],
  [noticeText("认证方式", "Authentication"), noticeText("Zotero 设置里的 API Key", "API key in Zotero settings"), noticeText("在专用浏览器里自己登录网页", "Sign in to the website in the dedicated browser")],
  [
    noticeText("工具能力", "Tools"),
    noticeText("可以使用 Zotero 与模型工具循环", "Can use Zotero and model tool calls"),
    noticeText("只同步网页回答，不运行工具循环", "Syncs website replies only; no tool calls"),
  ],
  [noticeText("论文上下文", "Paper context"), noticeText("由输入行的「原文」控制", "Controlled by Original in the input row"), noticeText("由网页上传流程自动附带论文材料", "Paper materials are attached automatically during web upload")],
  [
    noticeText("联网", "Web search"),
    noticeText("「联网」使用 API Web Search", "Web uses API Web Search"),
    noticeText("「联网」不可用，请用网页自己的搜索开关", "Web search is unavailable here; use the website's own search toggle"),
  ],
  [
    noticeText("图片 / 图表", "Images / figures"),
    noticeText("可以直接附图，随消息一起发送", "Images can be attached and sent with the message"),
    noticeText("默认不发送论文插图，只带图注文字", "Paper figures are not sent by default; captions only are included"),
  ],
  [
    noticeText("附件 / 下载", "Attachments / downloads"),
    noticeText("附件走本地文件，生成的文件直接存回 Zotero", "Attachments use local files; generated files are saved directly to Zotero"),
    noticeText("只上传论文材料；网页给出下载链接才能存回 Zotero", "Only paper materials are uploaded; files can be saved to Zotero when the website provides a download link"),
  ],
];

const IMAGE_PATHS: Array<[NoticeText, NoticeText]> = [
  [noticeText("截图 / 本机图片", "Screenshot / local image"), noticeText("输入框 ＋ → 截图 / 图片，图片会随消息一起上传给网页。", "Use + → Screenshot / Image in the input; the image is uploaded with the message to the website.")],
  [
    noticeText("@ 选论文素材", "@ pick paper materials"),
    noticeText("输入框里打 @ 挑图片、表格和公式；已解析的 PDF 会先列出你正在看的那一页，也可以按「图片 / 表格 / 公式」切换。图片随消息上传；表格和公式先插入短标签，发送时才展开成 LaTeX 文字。", "Type @ in the input to pick images, tables, and equations. Parsed PDFs first show the page you are viewing; switch among Images / Tables / Equations as needed. Images upload with the message. Tables and equations use short markers that expand to LaTeX when sent."),
  ],
];

const API_PATHS: Array<[NoticeText, NoticeText]> = [
  [
    noticeText("图片随消息发送", "Send images with a message"),
    noticeText("输入框 ＋ → 截图 / 图片，或直接 Ctrl+V 粘贴，图片与消息一起发给模型。", "Use + → Screenshot / Image in the input, or paste with Ctrl+V; the image is sent to the model with the message."),
  ],
  [
    noticeText("图表与公式", "Figures and equations"),
    noticeText("输入框里打 @：图片、表格、公式都能选；表格和公式先插入短标签，发送时才展开成 LaTeX 源码。", "Type @ in the input to pick images, tables, and equations. Tables and equations use short markers that expand to LaTeX source when sent."),
  ],
  [
    noticeText("论文上下文", "Paper context"),
    noticeText("由输入行的「原文」控制：附带 LaTeX 源码、MinerU 解析稿或 PDF 原件。", "Controlled by Original in the input row: attach LaTeX source, MinerU-parsed text, or the original PDF."),
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
  dialog.setAttribute("aria-label", NOTICE_TITLE());

  const header = el(doc, "header", "zai-web-notice-header");
  const close = buttonEl(doc, "×");
  close.className = "zai-web-notice-close";
  close.setAttribute("aria-label", uiText("关闭", "Close"));
  close.title = uiText("关闭", "Close");
  close.addEventListener("click", onClose);
  header.append(el(doc, "strong", "zai-web-notice-title", NOTICE_TITLE()), close);

  const body = el(doc, "div", "zai-web-notice-body");
  const callout = el(doc, "div", "zai-web-notice-callout");
  callout.append(
    el(doc, "strong", "zai-web-notice-callout-title", uiText("WEB 默认不发送图片", "WEB does not send images by default")),
    el(
      doc,
      "span",
      "zai-web-notice-callout-text",
      uiText("插件附带给网页的是论文的文字材料——LaTeX 源码，或 MinerU 解析出的 Markdown。解析稿里的插图、表格只有图注文字，图本身不会上传，网页模型看不到版式和图表。论文还没解析时会改发 PDF 原件。", "The add-on sends paper text to the website as LaTeX source or MinerU-parsed Markdown. Parsed figures and tables include captions only; image data is not uploaded, so the web model cannot see their layout. If the paper has not been parsed, the original PDF is sent instead."),
    ),
  );
  body.append(
    renderNoticeSection(doc, uiText("论文材料从哪来", "Paper material sources"), SOURCE_ROWS),
    renderNoticeSection(doc, uiText("素材怎么用", "Using materials"), MATERIAL_ROWS),
    ...(materialShortcut
      ? [renderMaterialShortcutSection(doc, materialShortcut)]
      : []),
    callout,
    renderModeTable(doc),
  );
  body.append(renderNoticeSection(doc, uiText("API 模式", "API mode"), API_PATHS));
  body.append(
    renderNoticeSection(doc, uiText("WEB 模式：想让网页模型看图", "WEB mode: let the website model see images"), IMAGE_PATHS),
  );
  body.append(renderProjectRow(doc), renderSupportSection(doc));
  dialog.append(header, body);

  const footer = el(doc, "footer", "zai-web-notice-actions");
  const confirm = buttonEl(doc, uiText("知道了", "Got it"));
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
  section.append(el(doc, "strong", "", uiText("素材快捷键", "Material shortcut")));
  const row = el(doc, "div", "zai-web-notice-shortcut");
  const field = doc.createElement("input");
  field.type = "text";
  field.readOnly = true;
  field.className = "zai-web-notice-shortcut-field";
  field.value = shortcut.value;
  field.setAttribute("aria-label", uiText("素材快捷键", "Material shortcut"));
  field.title = uiText("点一下输入框，再按下组合键即可改键", "Click the field, then press a key combination to change the shortcut");
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
      uiText(`点一下输入框再按组合键即可改键；默认 ${DEFAULT_MATERIAL_PICK_SHORTCUT}，组合里要有 Ctrl / Alt / Meta。`, `Click the field and press a key combination to change it; default: ${DEFAULT_MATERIAL_PICK_SHORTCUT}. Include Ctrl / Alt / Meta.`),
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
    el(doc, "span", "", uiText("项目", "Project")),
    externalLink(doc, PROJECT_URL, "github.com/xuhan-rgb/zotero-ai-sidebar"),
    el(doc, "span", "zai-web-notice-project-sep", "·"),
    el(doc, "span", "", uiText("有问题请", "Questions or issues: ")),
    externalLink(doc, PROJECT_ISSUES_URL, uiText("提 Issue", "open an issue")),
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
  const button = buttonEl(doc, uiText("复制环境信息", "Copy environment details"));
  button.className = "zai-web-notice-copy-env";
  button.title = uiText("复制插件版本、Zotero 版本与系统到剪贴板，提 Issue 时粘进「环境信息」", "Copy the add-on version, Zotero version, and OS to the clipboard for the Environment details field in an issue");
  button.addEventListener("click", () => {
    flashButton(button, uiText("已复制", "Copied"));
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
    `Zotero ${zoteroGlobals()?.version ?? uiText("未知", "unknown")}`,
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
  toggle.title = uiText("支付宝扫码请我喝杯咖啡；再点一次收起", "Scan with Alipay to buy me a coffee; click again to collapse");
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
  for (const label of [uiText("项目", "Item"), uiText("API 模式", "API mode"), uiText("WEB 模式", "WEB mode")]) {
    const cell = el(doc, "th", "", label);
    if (label === uiText("WEB 模式", "WEB mode")) cell.className = "is-web";
    headRow.append(cell);
  }
  head.append(headRow);
  const body = doc.createElement("tbody");
  for (const [item, api, web] of MODE_ROWS) {
    const row = doc.createElement("tr");
    row.append(
      el(doc, "td", "zai-web-notice-item", resolveNoticeText(item)),
      el(doc, "td", "", resolveNoticeText(api)),
      el(doc, "td", "is-web", resolveNoticeText(web)),
    );
    body.append(row);
  }
  table.append(head, body);
  return table;
}

function resolveNoticeText(value: NoticeText): string {
  return typeof value === "function" ? value() : value;
}

function renderNoticeSection(
  doc: Document,
  title: string,
  rows: Array<[NoticeText, NoticeText]>,
): HTMLElement {
  const section = el(doc, "div", "zai-web-notice-section");
  section.append(el(doc, "strong", "", title));
  const list = el(doc, "ul", "zai-web-notice-list");
  for (const [name, detail] of rows) {
    const item = doc.createElement("li");
    item.append(el(doc, "b", "", resolveNoticeText(name)), el(doc, "span", "", resolveNoticeText(detail)));
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
