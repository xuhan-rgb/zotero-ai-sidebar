import type {
  FullTranslationBlock,
  FullTranslationDocument,
  FullTranslationTable,
} from "./full-document";

export const PDF_TRANSLATION_PREFIX = "pdf:";

export function pdfTranslationDocumentId(itemKey: string): string {
  return `${PDF_TRANSLATION_PREFIX}${itemKey}`;
}

export function isPdfTranslationDocumentId(id: string): boolean {
  return id.startsWith(PDF_TRANSLATION_PREFIX);
}

export function buildMineruTranslationDocument(
  documentId: string,
  markdown: string,
  contentList: unknown | null,
): FullTranslationDocument {
  const fromList = blocksFromContentList(contentList);
  const blocks = fromList.length ? fromList : blocksFromMarkdown(markdown);
  if (blocks.length === 0) {
    throw new Error("MinerU 解析结果没有可翻译的正文");
  }
  return {
    schemaVersion: 1,
    arxivId: documentId,
    sourceHash: stableSourceHash(
      `${markdown}\0${JSON.stringify(contentList ?? null)}`,
    ),
    blocks,
  };
}

function blocksFromContentList(value: unknown): FullTranslationBlock[] {
  const items = flattenContentList(value);
  const blocks: FullTranslationBlock[] = [];
  let sectionID = "front";
  let paragraphIndex = 0;
  for (const item of items) {
    if (item.kind === "heading") {
      paragraphIndex = 0;
      const id =
        blocks.length === 0 && item.level <= 1
          ? "title"
          : `section-${blocks.length + 1}`;
      if (id !== "title") sectionID = id;
      blocks.push({
        id,
        kind: id === "title" ? "title" : "heading",
        source: item.text,
        translatable: true,
        level: item.level,
      });
      continue;
    }
    if (item.kind === "formula") {
      blocks.push({
        id: `formula-${blocks.length + 1}`,
        kind: "formula",
        source: item.text,
        translatable: false,
      });
      continue;
    }
    if (item.kind === "figure") {
      blocks.push({
        id: `figure-${blocks.length + 1}-caption`,
        kind: "figure-caption",
        source: item.text,
        translatable: !!item.text,
      });
      continue;
    }
    if (item.kind === "table") {
      blocks.push({
        id: `table-${blocks.length + 1}-caption`,
        kind: "table-caption",
        source: item.text,
        translatable: !!item.text,
        ...(item.table ? { table: item.table } : {}),
      });
      continue;
    }
    if (!item.text) continue;
    paragraphIndex += 1;
    blocks.push({
      id: `${sectionID}-p${paragraphIndex}`,
      kind: paragraphIndex === 1 && sectionID === "front" && !hasKind(blocks, "abstract")
        ? guessAbstract(item.text)
        : "paragraph",
      source: item.text,
      translatable: true,
    });
  }
  return blocks;
}

function guessAbstract(text: string): FullTranslationBlock["kind"] {
  return /^abstract\b/i.test(text.slice(0, 40)) ? "abstract" : "paragraph";
}

function hasKind(
  blocks: FullTranslationBlock[],
  kind: FullTranslationBlock["kind"],
): boolean {
  return blocks.some((block) => block.kind === kind);
}

interface FlatItem {
  kind: "heading" | "paragraph" | "formula" | "figure" | "table";
  text: string;
  level: number;
  table?: FullTranslationTable;
}

function flattenContentList(value: unknown): FlatItem[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    if (value.every((item) => Array.isArray(item))) {
      return value.flatMap((page) => flattenContentList(page));
    }
    return value.flatMap((item) => flattenItem(item));
  }
  if (isRecord(value) && Array.isArray(value.pages)) {
    return value.pages.flatMap((page) =>
      isRecord(page) ? flattenContentList(page.blocks) : [],
    );
  }
  if (isRecord(value) && Array.isArray(value.blocks)) {
    return flattenContentList(value.blocks);
  }
  return [];
}

function flattenItem(value: unknown): FlatItem[] {
  if (!isRecord(value)) return [];
  const type = stringValue(value.type).toLowerCase();
  if (
    type === "header" ||
    type === "footer" ||
    type === "page_number" ||
    type === "page-number" ||
    type === "discarded"
  ) {
    return [];
  }
  const text = blockText(value);
  const level = headingLevel(value, type);
  if (type === "equation" || type === "formula" || type === "display_equation") {
    return text ? [{ kind: "formula", text, level: 0 }] : [];
  }
  if (type === "image" || type === "figure") {
    return [{ kind: "figure", text: captionText(value) || text, level: 0 }];
  }
  if (type === "table") {
    return [
      {
        kind: "table",
        text: captionText(value),
        level: 0,
        table: tableFromHtml(stringValue(value.table_body) || stringValue(value.html)),
      },
    ];
  }
  if (type === "title" || type === "heading" || level > 0) {
    return text ? [{ kind: "heading", text, level: level || 1 }] : [];
  }
  return text ? [{ kind: "paragraph", text, level: 0 }] : [];
}

function headingLevel(value: Record<string, unknown>, type: string): number {
  if (typeof value.text_level === "number" && value.text_level > 0) {
    return value.text_level;
  }
  if (typeof value.level === "number" && value.level > 0) return value.level;
  return type === "title" || type === "heading" ? 1 : 0;
}

function captionText(value: Record<string, unknown>): string {
  const caption = value.image_caption ?? value.table_caption ?? value.caption;
  if (Array.isArray(caption)) {
    return caption.map((item) => stringValue(item)).filter(Boolean).join(" ");
  }
  return stringValue(caption);
}

function blockText(value: Record<string, unknown>): string {
  if (typeof value.text === "string") return value.text.trim();
  if (typeof value.content === "string") return value.content.trim();
  if (Array.isArray(value.content)) {
    return value.content
      .map((part) =>
        typeof part === "string"
          ? part
          : isRecord(part)
            ? stringValue(part.content) || stringValue(part.text)
            : "",
      )
      .join("")
      .trim();
  }
  return "";
}

function tableFromHtml(html: string): FullTranslationTable | undefined {
  if (!html.includes("<")) return undefined;
  const rows: FullTranslationTable["rows"] = [];
  const rowMatches = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rowMatches) {
    const cells = Array.from(
      row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi),
      (match) => stripTags(match[1] ?? ""),
    ).filter((cell) => cell.length > 0);
    if (cells.length) rows.push(cells);
  }
  return rows.length ? { rows } : undefined;
}

function stripTags(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function blocksFromMarkdown(markdown: string): FullTranslationBlock[] {
  const blocks: FullTranslationBlock[] = [];
  let sectionID = "front";
  let paragraphIndex = 0;
  const chunks = markdown.replace(/\r\n/g, "\n").split(/\n{2,}/);
  for (const raw of chunks) {
    const chunk = raw.trim();
    if (!chunk) continue;
    const heading = chunk.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      paragraphIndex = 0;
      const level = heading[1]!.length;
      const source = heading[2]!.trim();
      const id =
        blocks.length === 0 && level === 1
          ? "title"
          : `section-${blocks.length + 1}`;
      if (id !== "title") sectionID = id;
      blocks.push({
        id,
        kind: id === "title" ? "title" : "heading",
        source,
        translatable: true,
        level,
      });
      continue;
    }
    if (/^\$\$[\s\S]*\$\$$/.test(chunk)) {
      blocks.push({
        id: `formula-${blocks.length + 1}`,
        kind: "formula",
        source: chunk.replace(/^\$\$|\$\$$/g, "").trim(),
        translatable: false,
      });
      continue;
    }
    paragraphIndex += 1;
    blocks.push({
      id: `${sectionID}-p${paragraphIndex}`,
      kind: "paragraph",
      source: chunk,
      translatable: true,
    });
  }
  return blocks;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stableSourceHash(source: string): string {
  let high = 0xcbf29ce4 >>> 0;
  let low = 0x84222325 >>> 0;
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    high = Math.imul(high ^ code, 0x01000193) >>> 0;
    low = Math.imul(low ^ (code + 0x9e37), 0x01000193) >>> 0;
  }
  return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
}
