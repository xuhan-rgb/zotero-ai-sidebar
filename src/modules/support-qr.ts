import qrcode from "qrcode-generator";

/** Project home, and where a problem should be reported. */
export const PROJECT_URL = "https://github.com/xuhan-rgb/zotero-ai-sidebar";
export const PROJECT_ISSUES_URL = `${PROJECT_URL}/issues/new`;

/**
 * Alipay collection code decoded from the author's support QR image. Only this
 * link is stored: the QR is drawn from it at runtime, so no image asset ships
 * with the plugin. Opening the link outside Alipay only reaches Alipay's
 * "open in app" page — the code is meant to be scanned.
 */
export const SUPPORT_PAY_URL = "https://qr.alipay.com/fkx148299uqrtakyknpic91";

const SVG_NS = "http://www.w3.org/2000/svg";
const QUIET_ZONE = 2;

/**
 * Draws the support QR as inline SVG: one path with a subpath per dark module.
 * Everything is built in the SVG namespace because the notice lives inside
 * Zotero's XUL document, where markup parsing would not create SVG nodes.
 */
// Gecko's DOM types have no SVG-specific overload, so SVG nodes are typed as
// plain elements here.
export function renderSupportQr(doc: Document, pixels = 132): Element {
  const code = qrcode(0, "M");
  code.addData(SUPPORT_PAY_URL);
  code.make();
  const modules = code.getModuleCount();
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "zai-web-notice-qr");
  svg.setAttribute(
    "viewBox",
    `${-QUIET_ZONE} ${-QUIET_ZONE} ${modules + QUIET_ZONE * 2} ${
      modules + QUIET_ZONE * 2
    }`,
  );
  svg.setAttribute("width", String(pixels));
  svg.setAttribute("height", String(pixels));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "支付宝赞赏码");
  svg.setAttribute("shape-rendering", "crispEdges");
  let path = "";
  for (let row = 0; row < modules; row += 1) {
    for (let col = 0; col < modules; col += 1) {
      if (code.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`;
    }
  }
  const modulesPath = doc.createElementNS(SVG_NS, "path");
  modulesPath.setAttribute("d", path);
  modulesPath.setAttribute("fill", "#12100d");
  const title = doc.createElementNS(SVG_NS, "title");
  title.textContent = SUPPORT_PAY_URL;
  svg.append(title, modulesPath);
  return svg;
}
