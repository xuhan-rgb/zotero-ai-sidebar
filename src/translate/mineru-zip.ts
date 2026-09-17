const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const EOCD_HEADER = 0x06054b50;

export interface MineruZipTextFile {
  name: string;
  text: string;
}

export interface MineruZipContents {
  markdown: string;
  contentList: unknown | null;
}

export async function extractMineruZip(
  bytes: Uint8Array,
): Promise<MineruZipContents> {
  const files = await unzipTextFiles(bytes);
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
  return {
    markdown: markdownFile?.text ?? "",
    contentList: listFile ? JSON.parse(listFile.text) : null,
  };
}

function pickFile(
  files: MineruZipTextFile[],
  patterns: RegExp[],
): MineruZipTextFile | undefined {
  for (const pattern of patterns) {
    const match = files.find((file) => pattern.test(file.name.replace(/\\/g, "/")));
    if (match) return match;
  }
  return undefined;
}

export async function unzipTextFiles(
  bytes: Uint8Array,
): Promise<MineruZipTextFile[]> {
  const records = centralDirectory(bytes);
  const files: MineruZipTextFile[] = [];
  for (const record of records) {
    const name = record.name.replace(/\\/g, "/");
    if (name.endsWith("/") || !/\.(md|json|txt)$/i.test(name)) continue;
    const data = await readLocalFile(bytes, record);
    files.push({ name, text: new TextDecoder("utf-8").decode(data) });
  }
  return files;
}

interface ZipRecord {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

function centralDirectory(bytes: Uint8Array): ZipRecord[] {
  const eocd = findEocd(bytes);
  const count = u16(bytes, eocd + 10);
  let offset = u32(bytes, eocd + 16);
  const records: ZipRecord[] = [];
  for (let index = 0; index < count; index++) {
    if (u32(bytes, offset) !== CENTRAL_HEADER) {
      throw new Error("MinerU zip 目录损坏");
    }
    const method = u16(bytes, offset + 10);
    const compressedSize = u32(bytes, offset + 20);
    const uncompressedSize = u32(bytes, offset + 24);
    const nameLength = u16(bytes, offset + 28);
    const extraLength = u16(bytes, offset + 30);
    const commentLength = u16(bytes, offset + 32);
    const localOffset = u32(bytes, offset + 42);
    const name = decodeName(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
      u16(bytes, offset + 8),
    );
    records.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return records;
}

function findEocd(bytes: Uint8Array): number {
  const min = Math.max(0, bytes.length - 22 - 65535);
  for (let offset = bytes.length - 22; offset >= min; offset--) {
    if (u32(bytes, offset) === EOCD_HEADER) return offset;
  }
  throw new Error("不是有效的 MinerU zip 结果包");
}

async function readLocalFile(
  bytes: Uint8Array,
  record: ZipRecord,
): Promise<Uint8Array> {
  const offset = record.localOffset;
  if (u32(bytes, offset) !== LOCAL_HEADER) {
    throw new Error(`zip 条目损坏：${record.name}`);
  }
  const nameLength = u16(bytes, offset + 26);
  const extraLength = u16(bytes, offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const compressed = bytes.subarray(start, start + record.compressedSize);
  if (record.method === 0) return compressed.slice();
  if (record.method === 8) return inflateRaw(compressed, record.uncompressedSize);
  throw new Error(`不支持的 zip 压缩方式 ${record.method}`);
}

async function inflateRaw(
  data: Uint8Array,
  uncompressedSize: number,
): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("当前环境无法解压 MinerU zip");
  }
  const stream = new Blob([data]).stream().pipeThrough(
    new DecompressionStream("deflate-raw"),
  );
  const inflated = new Uint8Array(await new Response(stream).arrayBuffer());
  if (uncompressedSize && inflated.length !== uncompressedSize) {
    throw new Error("MinerU zip 解压长度不匹配");
  }
  return inflated;
}

function decodeName(bytes: Uint8Array, flags: number): string {
  return new TextDecoder(flags & 0x800 ? "utf-8" : "latin1").decode(bytes);
}

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}
