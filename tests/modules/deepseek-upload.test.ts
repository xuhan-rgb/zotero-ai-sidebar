import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uploadDeepSeekAttachments } from "../../web-agent/deepseek-attachments.mjs";

const diagnosticPath = join(process.cwd(), "web-agent", "upload-diagnostics.jsonl");
let previousLog: Buffer | undefined;

const adapter = {
  attachmentPreviews: [".file"],
  attachmentUploading: [".busy"],
};
let folder: string;
let now: number;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "zai-upload-"));
  await writeFile(join(folder, "paper.pdf"), "pdf");
  now = 0;
  previousLog = existsSync(diagnosticPath) ? readFileSync(diagnosticPath) : undefined;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (previousLog) writeFileSync(diagnosticPath, previousLog);
  else if (existsSync(diagnosticPath)) unlinkSync(diagnosticPath);
  await rm(folder, { recursive: true, force: true });
});
const file = () => ({ path: join(folder, "paper.pdf"), name: "paper.pdf" });
function harness(
  read = () => ({
    cards: [] as { id: string; text: string }[],
    busy: false,
    failed: false,
  }),
) {
  const setInputFiles = vi.fn(async (_path, options) => {
    now += options?.timeout ?? 30_000;
    throw Object.assign(new Error("input timed out after accepting file"), {
      name: "TimeoutError",
    });
  });
  const input = { getAttribute: async () => ".pdf,.txt", setInputFiles };
  const scope = { locator: () => ({ count: async () => 1, nth: () => input }) };
  const page = {
    locator: () => scope,
    waitForTimeout: async (ms: number) => {
      now += ms;
    },
  };
  const composer = { evaluate: async () => ({ rootId: "draft-1", ...read() }) };
  return { page, composer, setInputFiles };
}
const card = { id: "file-1", text: "paper.pdf" };

describe("DeepSeek draft uploads", () => {
  it("observes a delayed preview after input timeout and waits until ready without re-upload", async () => {
    const h = harness(() => ({
      cards: now >= 35_000 ? [card] : [],
      busy: now < 40_000,
      failed: false,
    }));
    await uploadDeepSeekAttachments(
      h.page,
      h.composer,
      adapter,
      [file()],
      "paper-1",
    );
    expect(h.setInputFiles).toHaveBeenCalledTimes(1);
    expect(now).toBe(41_000);
  });

  it("stops at the shared deadline when no evidence arrives, and does not retry the input", async () => {
    const h = harness();
    await expect(
      uploadDeepSeekAttachments(
        h.page,
        h.composer,
        adapter,
        [file()],
        "paper-1",
      ),
    ).rejects.toThrow("无法确认");
    expect(now).toBe(120_000);
    expect(h.setInputFiles).toHaveBeenCalledTimes(1);
    const logs = vi.mocked(console.info).mock.calls.map((call) => JSON.parse(String(call[1])));
    expect(logs.filter((entry) => entry.event === "state")).toHaveLength(1);
    expect(logs.map((entry) => entry.event)).toEqual([
      "start", "state", "input_start", "input_timeout_observing", "failed",
    ]);
    const persisted = readFileSync(diagnosticPath).subarray(previousLog?.length ?? 0)
      .toString().trim().split("\n").map((line) => JSON.parse(line));
    expect(persisted).toEqual(logs);
    expect(logs.at(-1)).toMatchObject({ elapsedMs: 120_000, draftKey: "paper-1" });
  });

  it("reuses its own pending attachment on retry, including a preview arriving after failure", async () => {
    let visible = false;
    const h = harness(() => ({
      cards: visible ? [card] : [],
      busy: false,
      failed: false,
    }));
    await expect(
      uploadDeepSeekAttachments(
        h.page,
        h.composer,
        adapter,
        [file()],
        "paper-1",
      ),
    ).rejects.toThrow();
    visible = true;
    await uploadDeepSeekAttachments(
      h.page,
      h.composer,
      adapter,
      [file()],
      "paper-1",
    );
    expect(h.setInputFiles).toHaveBeenCalledTimes(1);
  });

  it("does not send unknown attachments already in the composer", async () => {
    const h = harness(() => ({
      cards: [],
      otherCards: [{ id: "user-file", text: "other.pdf" }],
      busy: false,
      failed: false,
    }));
    await expect(
      uploadDeepSeekAttachments(
        h.page,
        h.composer,
        adapter,
        [file()],
        "paper-1",
      ),
    ).rejects.toThrow("未确认归属");
    expect(h.setInputFiles).not.toHaveBeenCalled();
  });

  it("does not trust an existing same-name file without an owned upload record", async () => {
    const h = harness(() => ({ cards: [card], busy: false, failed: false }));
    await expect(
      uploadDeepSeekAttachments(
        h.page,
        h.composer,
        adapter,
        [file()],
        "paper-1",
      ),
    ).rejects.toThrow("归属");
    expect(h.setInputFiles).not.toHaveBeenCalled();
  });

  it("reports explicit rejection instead of retrying or waiting out the deadline", async () => {
    const h = harness(() => ({
      cards: now ? [card] : [],
      busy: false,
      failed: now > 0,
    }));
    await expect(
      uploadDeepSeekAttachments(
        h.page,
        h.composer,
        adapter,
        [file()],
        "paper-1",
      ),
    ).rejects.toThrow("拒绝");
    expect(h.setInputFiles).toHaveBeenCalledTimes(1);
    expect(now).toBe(30_000);
  });

  it("shares one deadline across files, including the input operation", async () => {
    const h = harness();
    await writeFile(join(folder, "context.txt"), "context");
    h.composer.evaluate = async (_fn, args) => ({
      rootId: "draft-1",
      cards: args.name === "paper.pdf" && now >= 30_000 ? [card] : [],
      busy: args.name === "paper.pdf" && now < 110_000,
      failed: false,
    });
    await expect(
      uploadDeepSeekAttachments(
        h.page,
        h.composer,
        adapter,
        [file(), { path: join(folder, "context.txt"), name: "context.txt" }],
        "paper-1",
      ),
    ).rejects.toThrow("无法确认");
    expect(now).toBe(120_000);
    expect(h.setInputFiles).toHaveBeenLastCalledWith(
      join(folder, "context.txt"),
      { timeout: 9_000 },
    );
  });

  it("reuses the same marked attachment and refuses a replacement card", async () => {
    let id = card.id;
    const h = harness(() => ({
      cards: now ? [{ ...card, id }] : [],
      busy: false,
      failed: false,
    }));
    await uploadDeepSeekAttachments(
      h.page,
      h.composer,
      adapter,
      [file()],
      "paper-1",
    );
    await uploadDeepSeekAttachments(
      h.page,
      h.composer,
      adapter,
      [file()],
      "paper-1",
    );
    expect(h.setInputFiles).toHaveBeenCalledTimes(1);
    id = "replacement";
    await expect(
      uploadDeepSeekAttachments(
        h.page,
        h.composer,
        adapter,
        [file()],
        "paper-1",
      ),
    ).rejects.toThrow("归属");
    expect(h.setInputFiles).toHaveBeenCalledTimes(1);
  });

  it("does not send a changed task with leftover owned draft attachments", async () => {
    const h = harness(() => ({
      cards: now ? [card] : [],
      busy: false,
      failed: false,
    }));
    await uploadDeepSeekAttachments(
      h.page,
      h.composer,
      adapter,
      [file()],
      "paper-1",
    );
    await writeFile(join(folder, "context.txt"), "context");
    await expect(
      uploadDeepSeekAttachments(
        h.page,
        h.composer,
        adapter,
        [{ path: join(folder, "context.txt"), name: "context.txt" }],
        "paper-1",
      ),
    ).rejects.toThrow("其他附件");
    expect(h.setInputFiles).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a file after its local contents change", async () => {
    const h = harness(() => ({
      cards: now ? [card] : [],
      busy: false,
      failed: false,
    }));
    await uploadDeepSeekAttachments(
      h.page,
      h.composer,
      adapter,
      [file()],
      "paper-1",
    );
    await writeFile(file().path, "changed pdf");
    await expect(
      uploadDeepSeekAttachments(
        h.page,
        h.composer,
        adapter,
        [file()],
        "paper-1",
      ),
    ).rejects.toThrow("归属");
    expect(h.setInputFiles).toHaveBeenCalledTimes(1);
  });
});
