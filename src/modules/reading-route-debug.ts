// Diagnostic serializers for reading-route note HTML generation (debug logging
// of nodes/strings/href encoding). Pure helpers; no shared sidebar state.

import {
  debugZai,
  errorMessage,
  htmlStringDebugInfo,
  textDebugInfo,
} from "./debug-utils";

export function readingRouteElementDebugInfo(
  root: HTMLElement,
): Record<string, unknown> {
  let html = "";
  let htmlInfo: unknown = null;
  try {
    html = String(root.innerHTML);
    htmlInfo = htmlStringDebugInfo(html);
  } catch (err) {
    htmlInfo = { error: readingRouteErrorDebugInfo(err) };
  }
  return {
    childNodes: root.childNodes.length,
    children: root.children.length,
    headings: root.querySelectorAll("h1,h2,h3,h4,h5,h6").length,
    lists: root.querySelectorAll("ul,ol").length,
    listItems: root.querySelectorAll("li").length,
    blockquotes: root.querySelectorAll("blockquote").length,
    links: root.querySelectorAll("a").length,
    quoteLinks: root.querySelectorAll(
      "[data-zai-pdf-quote],.zai-pdf-quote-jump",
    ).length,
    referenceLinks: root.querySelectorAll("[data-zai-pdf-reference-label]")
      .length,
    math: root.querySelectorAll(".math,[data-latex]").length,
    html: htmlInfo,
    chars: html ? readingRouteStringDiagnostics(html) : null,
  };
}

export function readingRouteNodesDebugInfo(nodes: Node[]): Record<string, unknown> {
  let html = "";
  let htmlInfo: unknown = null;
  try {
    const doc = nodes[0]?.ownerDocument;
    const root = doc?.createElement("div");
    if (root) {
      for (const node of nodes) root.appendChild(node.cloneNode(true));
      html = String(root.innerHTML);
      htmlInfo = htmlStringDebugInfo(html);
    }
  } catch (err) {
    htmlInfo = { error: readingRouteErrorDebugInfo(err) };
  }

  const elementNodes = nodes.filter((node) => node.nodeType === 1) as Element[];
  return {
    nodes: nodes.length,
    elements: elementNodes.length,
    topTags: elementNodes.slice(0, 8).map((node) => node.tagName),
    text: textDebugInfo(nodes.map((node) => node.textContent || "").join(" ")),
    html: htmlInfo,
    chars: html ? readingRouteStringDiagnostics(html) : null,
  };
}

export function readingRouteErrorDebugInfo(err: unknown): Record<string, unknown> {
  const anyErr = err as
    | (Error & { code?: unknown; result?: unknown; name?: string })
    | null
    | undefined;
  return {
    name: anyErr?.name ?? (err == null ? String(err) : typeof err),
    message: errorMessage(err),
    code: anyErr?.code,
    result: anyErr?.result,
    stack:
      typeof anyErr?.stack === "string"
        ? textDebugInfo(anyErr.stack, 800)
        : undefined,
  };
}

export function readingRouteStringDiagnostics(value: string): Record<string, unknown> {
  const invalidControlSamples: Array<Record<string, unknown>> = [];
  const surrogateSamples: Array<Record<string, unknown>> = [];
  let invalidControls = 0;
  let c1Controls = 0;
  let loneSurrogates = 0;
  let replacementChars = 0;
  let lineSeparators = 0;

  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if ((code >= 0x00 && code < 0x09) || (code > 0x0d && code < 0x20)) {
      invalidControls++;
      if (invalidControlSamples.length < 8) {
        invalidControlSamples.push(readingRouteCodeUnitDebug(value, index));
      }
    } else if (code >= 0x7f && code <= 0x9f) {
      c1Controls++;
      if (invalidControlSamples.length < 8) {
        invalidControlSamples.push(readingRouteCodeUnitDebug(value, index));
      }
    }

    if (code === 0xfffd) replacementChars++;
    if (code === 0x2028 || code === 0x2029) lineSeparators++;

    const isHigh = code >= 0xd800 && code <= 0xdbff;
    const isLow = code >= 0xdc00 && code <= 0xdfff;
    const next = value.charCodeAt(index + 1);
    const prev = value.charCodeAt(index - 1);
    const pairedHigh = isHigh && next >= 0xdc00 && next <= 0xdfff;
    const pairedLow = isLow && prev >= 0xd800 && prev <= 0xdbff;
    if ((isHigh && !pairedHigh) || (isLow && !pairedLow)) {
      loneSurrogates++;
      if (surrogateSamples.length < 8) {
        surrogateSamples.push(readingRouteCodeUnitDebug(value, index));
      }
    }
  }

  return {
    length: value.length,
    codePoints: Array.from(value).length,
    invalidControls,
    c1Controls,
    loneSurrogates,
    replacementChars,
    lineSeparators,
    invalidControlSamples,
    surrogateSamples,
  };
}

export function readingRouteCodeUnitDebug(
  value: string,
  index: number,
): Record<string, unknown> {
  const code = value.charCodeAt(index);
  return {
    index,
    codeUnit: `0x${code.toString(16).padStart(4, "0")}`,
    before: value.slice(Math.max(0, index - 12), index).replace(/\s+/g, " "),
    after: value.slice(index + 1, index + 13).replace(/\s+/g, " "),
  };
}

export function encodeURIComponentWithDebug(
  value: string,
  label: string,
  detail: Record<string, unknown>,
): string {
  try {
    return encodeURIComponent(value);
  } catch (err) {
    debugZai("reading-route.link:encode-failed", {
      label,
      ...detail,
      value: textDebugInfo(value, 200),
      chars: readingRouteStringDiagnostics(value),
      error: readingRouteErrorDebugInfo(err),
    });
    throw err;
  }
}

export function assignHrefWithDebug(
  link: HTMLAnchorElement,
  href: string,
  label: string,
  detail: Record<string, unknown>,
): void {
  try {
    link.href = href;
  } catch (err) {
    debugZai("reading-route.link:href-failed", {
      label,
      ...detail,
      href: textDebugInfo(href, 200),
      chars: readingRouteStringDiagnostics(href),
      error: readingRouteErrorDebugInfo(err),
    });
    throw err;
  }
}

export function setAttributeWithDebug(
  element: Element,
  name: string,
  value: string,
  label: string,
  detail: Record<string, unknown>,
): void {
  try {
    element.setAttribute(name, value);
  } catch (err) {
    debugZai("reading-route.link:attribute-failed", {
      label,
      name,
      ...detail,
      value: textDebugInfo(value, 200),
      chars: readingRouteStringDiagnostics(value),
      error: readingRouteErrorDebugInfo(err),
    });
    throw err;
  }
}
