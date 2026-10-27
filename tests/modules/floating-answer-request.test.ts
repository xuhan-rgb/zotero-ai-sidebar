import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFloatingWorkspace,
  type FloatingWorkspace,
} from "../../src/modules/floating-workspace";
import { DEFAULT_FLOATING_PANEL_LAYOUT } from "../../src/settings/local-ui-settings";

const source = readFileSync("src/modules/sidebar.ts", "utf8");
const js = ts.transpileModule(
  source.slice(
    source.indexOf("function revealFloatingAnswerForRequest("),
    source.indexOf("async function cancelPendingWebPromptTask("),
  ),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
let workspace: FloatingWorkspace;
afterEach(() => {
  workspace?.destroy();
  document.body.replaceChildren();
});
function setup(mode: "api" | "web", display = "floating") {
  const mount = document.createElement("div");
  mount.innerHTML =
    '<div class="zai-app"><div class="messages"></div><div class="composer"><textarea></textarea></div></div>';
  document.body.append(mount);
  workspace = createFloatingWorkspace(window, mount, {
    layout: DEFAULT_FLOATING_PANEL_LAYOUT,
    onLayoutChange: vi.fn(),
    onVisibilityChange: vi.fn(),
  });
  mount
    .querySelector<HTMLButtonElement>(
      '[data-zai-float-action="hide"]',
    )!
    .click();
  const answer = mount.querySelector<HTMLElement>(
    '[data-zai-floating-panel="answer"]',
  )!;
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const api = vi.fn(() => pending),
    web = vi.fn(() => pending),
    reset = vi.fn();
  const sidebar = { mount };
  const deps = {
    findSidebarStateByMount: () => sidebar,
    floatingSidebarLayouts: new Map([[sidebar, workspace]]),
    resetMessagesScrollForConversation: reset,
    sendMessage: api,
    sendWebPromptMessage: web,
  };
  const send = new Function(
    ...Object.keys(deps),
    `${js}; return sendComposerMessage;`,
  )(...Object.values(deps));
  const state = {
    localUiSettings: {
      sidebarDisplayMode: display,
      chatSendMode: mode,
      webPromptProvider: "deepseek",
    },
  };
  return {
    answer,
    api,
    web,
    reset,
    finish,
    send: (text: string) => send(mount, state, text),
  };
}
describe("show floating answers from the composer", () => {
  it.each(["api", "web"] as const)(
    "shows answers before %s preparation finishes",
    async (mode) => {
      const state = setup(mode);
      expect(state.answer.hidden).toBe(true);
      const pending = state.send("question");
      expect(state.answer.hidden).toBe(false);
      expect(state.reset).toHaveBeenCalledOnce();
      expect(mode === "api" ? state.api : state.web).toHaveBeenCalledOnce();
      expect(mode === "api" ? state.web : state.api).not.toHaveBeenCalled();
      state.finish();
      await pending;
    },
  );
  it.each(["embedded", "docked"])(
    "keeps %s mode behavior unchanged",
    async (display) => {
      const state = setup("api", display);
      const pending = state.send("question");
      expect(state.answer.hidden).toBe(true);
      expect(state.reset).not.toHaveBeenCalled();
      state.finish();
      await pending;
    },
  );
  it("does not open an answer for a blank submission", async () => {
    const state = setup("web");
    const pending = state.send("   ");
    expect(state.answer.hidden).toBe(true);
    state.finish();
    await pending;
  });
});
