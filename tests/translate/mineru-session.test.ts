import { describe, expect, it, vi } from "vitest";
import { createFullTranslationState, loadFullTranslationState } from "../../src/settings/full-translation-store";
import { buildMineruTranslationDocument } from "../../src/translate/mineru-document";
import { loadMineruFullTranslationSession } from "../../src/translate/mineru-session";

vi.mock("../../src/settings/full-translation-store", async (original) => ({
  ...(await original<typeof import("../../src/settings/full-translation-store")>()),
  loadFullTranslationState: vi.fn(),
}));
vi.mock("../../src/translate/mineru-store", () => ({
  readPdfFingerprint: async () => ({ size: 1, mtime: 1 }),
  loadMineruCache: async () => ({ markdown, contentList: null }),
}));

const markdown = "# Paper\n\nBody prose.\n\n## References\n\n[1] Author. First paper.\n\n[2] Author. Second paper.";

describe("MinerU bibliography state migration", () => {
  it.each([false, true])("skips saved references and preserves body errors: %s", async (bodyError) => {
    const document = buildMineruTranslationDocument("pdf:TEST", markdown, null);
    const state = createFullTranslationState(document, "preset", "model");
    const [title, body, , first, second] = document.blocks;
    state.blocks[title!.id] = { status: "done", translation: "论文" };
    state.blocks[body!.id] = bodyError
      ? { status: "error", error: "Body failure" }
      : { status: "done", translation: "正文" };
    state.blocks[first!.id] = { status: "error", error: "Not Chinese" };
    state.blocks[second!.id] = { status: "pending" };
    state.lastError = { message: "Not Chinese", rawResponse: "original response" };
    vi.mocked(loadFullTranslationState).mockResolvedValue(state);

    const session = await loadMineruFullTranslationSession({ itemKey: "TEST", pdfPath: "/paper.pdf" });

    expect(session.state.blocks[first!.id]).toEqual({ status: "skipped" });
    expect(session.state.blocks[second!.id]).toEqual({ status: "skipped" });
    expect(session.state.blocks[title!.id]).toEqual(state.blocks[title!.id]);
    expect(session.state.blocks[body!.id]).toEqual(state.blocks[body!.id]);
    expect(session.state.sourceHash).toBe(state.sourceHash);
    expect(session.state.lastError).toEqual(bodyError ? state.lastError : undefined);
  });
});
