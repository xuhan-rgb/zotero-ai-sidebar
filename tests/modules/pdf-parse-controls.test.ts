import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderPdfParseControls } from "../../src/modules/pdf-parse-controls";
import { ensureMineruParse, resetMineruParseCache } from "../../src/translate/mineru-parse";

vi.mock("../../src/translate/mineru-parse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/translate/mineru-parse")>();
  return {
    ...actual,
    ensureMineruParse: vi.fn(),
  };
});
vi.mock("../../src/translate/mineru-session", () => ({
  resolveItemPdfForMineru: vi.fn(async () => ({
    itemKey: "ABCD1234",
    pdfPath: "/tmp/paper.pdf",
    fileName: "paper.pdf",
  })),
}));

const ensure = vi.mocked(ensureMineruParse);
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  vi.clearAllMocks();
  resetMineruParseCache();
});
afterEach(() => {
  document.body.replaceChildren();
});

describe("PDF parse controls", () => {
  it("hides full translation until MinerU parse is ready", async () => {
    let resolveParse: ((value: { status: "ready" }) => void) | undefined;
    ensure.mockReturnValue(
      new Promise((resolve) => {
        resolveParse = resolve;
      }),
    );
    const translate = vi.fn();
    const root = renderPdfParseControls(document, 12, translate);
    document.body.append(root);
    await flush();
    expect(root.querySelector(".arxiv-source-badge")?.textContent).toBe(
      "正在解析 PDF…",
    );
    expect(
      Array.from(root.querySelectorAll("button")).some(
        (button) => button.textContent === "全文翻译" && !button.hidden,
      ),
    ).toBe(false);
    resolveParse?.({ status: "ready" });
    await flush();
    const translateButton = Array.from(root.querySelectorAll("button")).find(
      (button) => button.textContent === "全文翻译",
    )!;
    expect(translateButton.hidden).toBe(false);
    translateButton.click();
    expect(translate).toHaveBeenCalledOnce();
  });

  it("opens token settings when no MinerU token is configured", async () => {
    ensure.mockResolvedValue({ status: "no-token" });
    const onConfigureToken = vi.fn();
    const root = renderPdfParseControls(document, 12, vi.fn(), {
      onConfigureToken,
    });
    document.body.append(root);
    await flush();
    expect(root.querySelector(".arxiv-source-badge")?.textContent).toBe(
      "未配置 MinerU Token",
    );
    expect(root.querySelector(".pdf-parse-help")).toBeNull();
    expect(root.textContent).not.toContain("请到");
    const configure = Array.from(root.querySelectorAll("button")).find(
      (button) => button.textContent === "配置 Token",
    )!;
    expect(configure.hidden).toBe(false);
    expect(configure.title).toBe("");
    expect(root.querySelector<HTMLElement>(".arxiv-source-badge")?.title).toBe(
      configure.title,
    );
    configure.click();
    expect(onConfigureToken).toHaveBeenCalledOnce();
    onConfigureToken.mockClear();
    root.querySelector(".arxiv-source-badge")!.dispatchEvent(new MouseEvent("click"));
    expect(onConfigureToken).toHaveBeenCalledOnce();
  });
});
