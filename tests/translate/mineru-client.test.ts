import { describe, expect, it } from "vitest";
import { parsePdfWithMineru, probeMineruToken } from "../../src/translate/mineru-client";
import { unzipTextFiles } from "../../src/translate/mineru-zip";

function storeZip(files: Array<{ name: string; text: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.text);
    const local = new Uint8Array(30 + name.length + data.length);
    writeU32(local, 0, 0x04034b50);
    writeU16(local, 26, name.length);
    writeU32(local, 22, data.length);
    writeU32(local, 18, data.length);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);
    const central = new Uint8Array(46 + name.length);
    writeU32(central, 0, 0x02014b50);
    writeU16(central, 28, name.length);
    writeU32(central, 20, data.length);
    writeU32(central, 24, data.length);
    writeU32(central, 42, offset);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  writeU32(eocd, 0, 0x06054b50);
  writeU16(eocd, 8, files.length);
  writeU16(eocd, 10, files.length);
  writeU32(eocd, 12, centralSize);
  writeU32(eocd, 16, offset);
  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of locals) {
    out.set(part, cursor);
    cursor += part.length;
  }
  for (const part of centrals) {
    out.set(part, cursor);
    cursor += part.length;
  }
  out.set(eocd, cursor);
  return out;
}

function writeU16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
  bytes[offset + 3] = (value >> 24) & 0xff;
}

describe("MinerU zip extract", () => {
  it("reads full.md and content_list.json from a stored zip", async () => {
    const bytes = storeZip([
      { name: "demo/full.md", text: "# Hello" },
      { name: "demo/demo_content_list.json", text: '[{"type":"text","text":"Hi"}]' },
    ]);
    const files = await unzipTextFiles(bytes);
    expect(files.map((file) => file.name)).toEqual([
      "demo/full.md",
      "demo/demo_content_list.json",
    ]);
  });
});

describe("MinerU client", () => {
  it("rejects an invalid token", async () => {
    await expect(
      probeMineruToken({
        token: "bad",
        fetch: async () =>
          new Response(JSON.stringify({ code: -1, msg: "A0202", data: {} }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      }),
    ).rejects.toThrow(/Token 无效/);
  });

  it("uploads a PDF, polls, and extracts the result zip", async () => {
    const zip = storeZip([
      { name: "full.md", text: "# Paper\n\nHello." },
      { name: "paper_content_list.json", text: "[]" },
    ]);
    const calls: string[] = [];
    const result = await parsePdfWithMineru(
      { name: "paper.pdf", bytes: new Uint8Array([1, 2, 3]), dataId: "KEY1" },
      {
        token: "tok",
        pollIntervalMs: 1,
        timeoutMs: 1000,
        sleep: async () => undefined,
        fetch: async (input, init) => {
          const url = String(input);
          calls.push(`${init?.method ?? "GET"} ${url}`);
          if (url.endsWith("/file-urls/batch")) {
            return json({
              code: 0,
              data: {
                batch_id: "batch-1",
                file_urls: ["https://oss.example/upload"],
              },
            });
          }
          if (url === "https://oss.example/upload") {
            return new Response(null, { status: 200 });
          }
          if (url.includes("/extract-results/batch/batch-1")) {
            return json({
              code: 0,
              data: {
                batch_id: "batch-1",
                extract_result: [
                  {
                    file_name: "paper.pdf",
                    state: "done",
                    full_zip_url: "https://cdn.example/result.zip",
                  },
                ],
              },
            });
          }
          if (url === "https://cdn.example/result.zip") {
            return new Response(zip, { status: 200 });
          }
          throw new Error(`unexpected ${url}`);
        },
      },
    );
    expect(result.markdown).toContain("# Paper");
    expect(result.batchId).toBe("batch-1");
    expect(calls[0]).toContain("POST");
    expect(calls[1]).toContain("PUT");
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
