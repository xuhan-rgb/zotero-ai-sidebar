import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sidebarSource = readFileSync(
  resolve(process.cwd(), "src/modules/sidebar.ts"),
  "utf8",
);
const toolbarSource = sidebarSource.slice(
  sidebarSource.indexOf("function renderToolbar("),
  sidebarSource.indexOf("function renderConversationSwitcher("),
);

describe("AI dialog toolbar", () => {
  it("keeps copy and clear visible while disabling them for an empty chat", () => {
    expect(toolbarSource).toContain(
      "copyAll.disabled = state.messages.length === 0",
    );
    expect(toolbarSource).toContain(
      "clear.disabled = state.sending || state.messages.length === 0",
    );
    expect(toolbarSource).toContain("topRow.append(copyAll)");
    expect(toolbarSource).toContain("topRow.append(clear)");
    expect(toolbarSource).not.toContain("if (state.messages.length > 0)");
  });
});
