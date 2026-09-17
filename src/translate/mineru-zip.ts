import { strFromU8, unzipSync } from "fflate";

export interface MineruZipTextFile {
  name: string;
  text: string;
}

export interface MineruZipContents {
  markdown: string;
  contentList: unknown | null;
  assets: Record<string, Uint8Array>;
}

export async function extractMineruZip(
  bytes: Uint8Array,
): Promise<MineruZipContents> {
  const unzipped = unzipMineruFiles(bytes, true);
  const files = textFiles(unzipped);
  const markdownFile = pickFile(files, [
    /(?:^|\/)full\.md$/i,
    /(?:^|\/)markdown\.md$/i,
    /\.md$/i,
  ]);
  const listFile = pickFile(files, [
    /content_list\.json$/i,
    /structured_content\.json$/i,
  ]);
  if (!markdownFile && !listFile) {
    throw new Error("MinerU 结果包里没有 Markdown 或 content_list");
  }
  const documentPath = markdownFile?.name ?? listFile!.name;
  const prefix = documentPath.slice(0, documentPath.lastIndexOf("/") + 1);
  const assets = Object.fromEntries(
    Object.entries(unzipped).flatMap(([name, data]) => {
      const normalized = name.replace(/\\/g, "/");
      if (!normalized.startsWith(prefix)) return [];
      const path = mineruImagePath(normalized.slice(prefix.length));
      return path ? [[path, data]] : [];
    }),
  );
  return {
    markdown: markdownFile?.text ?? "",
    contentList: listFile ? JSON.parse(listFile.text) : null,
    assets,
  };
}

function pickFile(
  files: MineruZipTextFile[],
  patterns: RegExp[],
): MineruZipTextFile | undefined {
  for (const pattern of patterns) {
    const match = files.find((file) =>
      pattern.test(file.name.replace(/\\/g, "/")),
    );
    if (match) return match;
  }
  return undefined;
}

export async function unzipTextFiles(
  bytes: Uint8Array,
): Promise<MineruZipTextFile[]> {
  return textFiles(unzipMineruFiles(bytes, false));
}

export function mineruImagePath(path: string): string | null {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    normalized.startsWith("/") ||
    /[:\x00]/.test(normalized) ||
    normalized.split("/").some((part) => part === ".." || part === "." || !part) ||
    !/\.(png|jpe?g|gif|webp)$/i.test(normalized)
  ) return null;
  return normalized;
}

function unzipMineruFiles(bytes: Uint8Array, images: boolean): Record<string, Uint8Array> {
  // fflate, not DecompressionStream: the plugin sandbox does not expose that
  // Web API (same constraint as arxiv-archive.ts).
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes, {
      filter: (file) => /\.(md|json|txt)$/i.test(file.name) ||
        (images && /\.(png|jpe?g|gif|webp)$/i.test(file.name)),
    });
  } catch (error) {
    throw new Error(
      `无法解压 MinerU zip：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return unzipped;
}

function textFiles(unzipped: Record<string, Uint8Array>): MineruZipTextFile[] {
  return Object.entries(unzipped).filter(([name]) => /\.(md|json|txt)$/i.test(name)).map(([name, data]) => ({
    name: name.replace(/\\/g, "/"),
    text: strFromU8(data),
  }));
}
