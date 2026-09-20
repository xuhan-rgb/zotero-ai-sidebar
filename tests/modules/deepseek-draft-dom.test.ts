// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { providerDefinition } from "../../web-agent/adapters.mjs";
import { readDeepSeekDraft } from "../../web-agent/deepseek-attachments.mjs";

const previews = ".file-card, .file-name";
const uploading = ".uploading, .processing";
const fileName = "Terra-Explorable.pdf";

function createDraft() {
  const root = document.createElement("section");
  const composer = document.createElement("div");
  const input = document.createElement("input");
  input.type = "file";
  composer.append(input);
  root.append(composer);
  document.body.append(root);
  return { root, composer };
}

function addCard(root: HTMLElement, text = fileName, hidden = false) {
  const card = document.createElement("div");
  card.className = "file-card";
  if (hidden) card.style.display = "none";
  const name = document.createElement("span");
  name.className = "file-name";
  name.textContent = text;
  card.append(name);
  root.append(card);
  return card;
}

function read(composer: HTMLElement) {
  return readDeepSeekDraft(composer, {
    name: fileName,
    previews,
    uploading,
  });
}

describe("DeepSeek draft DOM inspection", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it.each(["PDF 43.29MB", "Uploading..."])("reads the observed DeepSeek sibling attachment structure: %s", (status) => {
    document.body.innerHTML = `
      <div class="ds-message"><div class="e70accd6">${fileName}</div></div>
      <div class="_77cefa5 _9996a53">
        <div class="b40079d7 _2113217"><div class="_25c7358 dafb6286" tabindex="0">
          <div class="cd314545"><div class="_1c3b90b"></div><div class="_158cea4">
            <div class="_967f3f9"><div class="e70accd6">${fileName}</div><div class="d0fee470"></div></div>
            <div class="_7103a25 _078ccb5">${status}</div>
          </div></div>
        </div></div>
        <div class="_020ab5b"><div class="_24fad49"><textarea></textarea></div>
          <div class="ec4f5d61"><input type="file" multiple></div>
        </div>
      </div>`;
    const adapter = providerDefinition("deepseek");
    const state = readDeepSeekDraft(document.querySelector("textarea"), {
      name: fileName,
      previews: adapter.attachmentPreviews.join(","),
      uploading: adapter.attachmentUploading.join(","),
      rootSelector: adapter.attachmentRoot,
    });
    expect(state.cards).toHaveLength(1);
    expect(state.cards[0].text).toBe(fileName);
    expect(state.busy).toBe(status === "Uploading...");
    expect(state.failed).toBe(false);
  });

  it.each([true, false])("recognizes an image by alt and waits for its upload spinner: %s", (loading) => {
    const imageName = "1789916502423-图-1-teaser.png";
    document.body.innerHTML = `
      <div class="ds-message"><div class="d5fa3d1b"><img alt="${imageName}"></div></div>
      <div class="_77cefa5">
        <div class="d5fa3d1b _183e647" role="button">
          <div class="cc804671 _2571442"><img alt="${imageName}" class="_9f130b7"></div>
          <div class="fb3b3771" style="${loading ? "opacity:1" : "opacity:0"}">
            <div class="b2a4d1af _04c868b"><div class="f8553f18"><div class="ds-loading"></div></div></div>
          </div>
        </div>
        <div class="_020ab5b"><textarea></textarea><input type="file"></div>
      </div>`;
    const adapter = providerDefinition("deepseek");
    const inspect = (name: string) => readDeepSeekDraft(document.querySelector("textarea"), {
      name,
      previews: adapter.attachmentPreviews.join(","),
      uploading: adapter.attachmentUploading.join(","),
      rootSelector: adapter.attachmentRoot,
    });
    const state = inspect(imageName);
    expect(state.cards).toHaveLength(1);
    expect(state.cards[0].text).toBe(imageName);
    expect(state.busy).toBe(loading);
    expect(state.failed).toBe(false);
    const other = inspect("different.png");
    expect(other.cards).toHaveLength(0);
    expect(other.otherCards).toHaveLength(1);
    expect(other.otherCards[0].id).toBe(state.cards[0].id);
    document.querySelector("._77cefa5 .d5fa3d1b")!.append("上传失败");
    expect(inspect(imageName).failed).toBe(true);
  });

  it("ignores a same-named attachment in a historical message", () => {
    const history = document.createElement("div");
    history.className = "ds-message";
    addCard(history);
    document.body.append(history);

    const { root, composer } = createDraft();
    addCard(root);

    expect(read(composer).cards).toHaveLength(1);
  });

  it("counts nested file-card and file-name nodes as one current attachment", () => {
    const { root, composer } = createDraft();
    addCard(root);

    const draft = read(composer);
    expect(draft.cards).toHaveLength(1);
    expect(draft.cards[0].text).toContain(fileName);
  });

  it("does not match a different file just because its name contains the target stem", () => {
    const { root, composer } = createDraft();
    addCard(root, "Terra-Explorable-supplement.pdf");
    expect(read(composer).cards).toHaveLength(0);
  });

  it("reports an unknown differently named draft attachment separately", () => {
    const { root, composer } = createDraft();
    addCard(root, "other.pdf");
    const draft = read(composer);
    expect(draft.cards).toHaveLength(0);
    expect(draft.otherCards).toHaveLength(1);
  });

  it("reports the exact busy selector and preview text without copying the prompt", () => {
    const { root, composer } = createDraft();
    composer.append(document.createTextNode("PRIVATE-PROMPT-CONTENT"));
    const card = addCard(root);
    const spinner = document.createElement("span");
    spinner.className = "uploading";
    card.append(spinner);
    const state = read(composer);
    expect(state.diagnostics.busyNodeCount).toBe(1);
    expect(state.diagnostics.busyNodes[0]).toMatchObject({ class: "uploading", selectors: [".uploading"] });
    expect(state.diagnostics.previews.some((node) => node.text.includes(fileName))).toBe(true);
    expect(JSON.stringify(state)).not.toContain("PRIVATE-PROMPT-CONTENT");
  });

  it("counts two same-named attachment cards separately", () => {
    const { root, composer } = createDraft();
    addCard(root);
    addCard(root);

    expect(read(composer).cards).toHaveLength(2);
  });

  it("ignores hidden attachment cards", () => {
    const { root, composer } = createDraft();
    addCard(root, fileName, true);

    expect(read(composer).cards).toHaveLength(0);
  });

  it("rejects a scope that can only be established at body", () => {
    const composer = document.createElement("div");
    const input = document.createElement("input");
    input.type = "file";
    document.body.append(composer, input);

    expect(() => read(composer)).toThrow(
      "无法确认 DeepSeek 当前输入框的附件区域",
    );
  });

  it("reports uploading and failed draft states", () => {
    const { root, composer } = createDraft();
    const card = addCard(root);
    const status = document.createElement("div");
    status.className = "uploading";
    status.textContent = "上传中";
    card.append(status);

    expect(read(composer)).toMatchObject({ busy: true, failed: false });

    const failedDraft = createDraft();
    const failedCard = addCard(failedDraft.root);
    const failedStatus = document.createElement("div");
    failedStatus.className = "status";
    failedStatus.textContent = "上传失败";
    failedCard.append(failedStatus);
    expect(read(failedDraft.composer)).toMatchObject({
      busy: false,
      failed: true,
    });
  });

  it("does not infer upload state from composer prompt text", () => {
    const { root, composer } = createDraft();
    addCard(root);
    composer.append("用户问题中提到上传中和上传失败");

    expect(read(composer)).toMatchObject({ busy: false, failed: false });
  });
});
