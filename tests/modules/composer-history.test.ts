import { describe, expect, it } from "vitest";
import {
  navigateComposerPromptHistory,
  resetComposerPromptHistory,
  type ComposerPromptHistoryState,
} from "../../src/modules/composer-history";

function state(): ComposerPromptHistoryState {
  return {
    messages: [
      { role: "user", content: "first question" },
      { role: "assistant", content: "answer" },
      { role: "user", content: "second question" },
    ],
  };
}

describe("composer prompt history", () => {
  it("recalls the latest user prompt when the composer is empty", () => {
    const s = state();

    expect(navigateComposerPromptHistory(s, "", "previous")).toEqual({
      handled: true,
      value: "second question",
    });
  });

  it("clears any recalled prompt and leaves history on ArrowDown", () => {
    const s = state();
    const latest = navigateComposerPromptHistory(s, "", "previous");
    const older = navigateComposerPromptHistory(s, latest.value, "previous");
    const empty = navigateComposerPromptHistory(s, older.value, "next");
    expect(older.value).toBe("first question");
    expect(empty).toEqual({ handled: true, value: "" });
    expect(s.promptHistoryCursor).toBeUndefined();
    expect(navigateComposerPromptHistory(s, "", "previous").value).toBe(
      "second question",
    );
  });

  it("does not clear manually typed text when ArrowDown is pressed", () => {
    const s = state();
    expect(navigateComposerPromptHistory(s, "draft", "next")).toEqual({
      handled: false,
      value: "draft",
    });
  });

  it("does not hijack arrow keys for a manually typed draft", () => {
    const s = state();

    expect(navigateComposerPromptHistory(s, "draft", "previous")).toEqual({
      handled: false,
      value: "draft",
    });
  });

  it("resets an active history session when the draft changes", () => {
    const s = state();
    navigateComposerPromptHistory(s, "", "previous");

    resetComposerPromptHistory(s);

    expect(s.promptHistoryCursor).toBeUndefined();
  });
});
