import { buttonEl, el } from "./dom-utils";

const NOTICE_TITLE = "WEB 模式使用须知";

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
    "输入框里打 @ 挑图片、表格和公式；已解析的 PDF 会先列出你正在看的那一页，也可以按「图片 / 表格 / 公式」切换。图片随消息上传，表格和公式以 LaTeX 文字插入。",
  ],
];

const API_PATHS: Array<[string, string]> = [
  [
    "图片随消息发送",
    "输入框 ＋ → 截图 / 图片，或直接 Ctrl+V 粘贴，图片与消息一起发给模型。",
  ],
  [
    "图表与公式",
    "输入框里打 @：图片、表格、公式都能选；表格和公式直接插入 LaTeX 源码。",
  ],
  [
    "论文上下文",
    "由输入行的「原文」控制：附带 LaTeX 源码、MinerU 解析稿或 PDF 原件。",
  ],
];

/**
 * Explains what WEB mode sends and, above all, that the automatic paper
 * material is text-only: the downloaded Markdown carries figure captions but
 * no image data, so the web model never sees the figures.
 */
export function renderWebUsageNotice(
  doc: Document,
  onClose: () => void,
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
  body.append(callout, renderModeTable(doc));
  body.append(renderNoticeSection(doc, "API 模式", API_PATHS));
  body.append(
    renderNoticeSection(doc, "WEB 模式：想让网页模型看图", IMAGE_PATHS),
  );
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

  layer = renderWebUsageNotice(doc, close);
  layer.addEventListener("click", (event) => {
    if (event.target === layer) close();
  });
  doc.addEventListener("keydown", onKeydown, true);
  mount.before(layer);
  (
    layer.querySelector(".zai-web-notice-confirm") as HTMLElement | null
  )?.focus();
}
