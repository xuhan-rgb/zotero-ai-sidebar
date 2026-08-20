import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sidebarSource = readFileSync(
  resolve(process.cwd(), "src/modules/sidebar.ts"),
  "utf8",
);

describe("assistant note write", () => {
  it("locks and restores the chat scroll while Zotero refreshes the note", () => {
    const writeSource = sidebarSource.slice(
      sidebarSource.indexOf("async function writeAssistantMessageToNote("),
      sidebarSource.indexOf("async function appendAssistantContentToItemNote("),
    );

    expect(writeSource).toContain("lockMessagesScroll(mount)");
    expect(writeSource).toContain(
      "scheduleMessagesScrollRestore(mount, chatScroll)",
    );
  });
});
