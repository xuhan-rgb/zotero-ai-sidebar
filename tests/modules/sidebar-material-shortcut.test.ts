import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sidebarSource = readFileSync(
  resolve(process.cwd(), "src/modules/sidebar.ts"),
  "utf8",
);

describe("sidebar material pick shortcut", () => {
  it("joins the reader keydown chain", () => {
    const fn = sidebarSource.slice(
      sidebarSource.indexOf("function installReaderPromptShortcutHandler("),
      sidebarSource.indexOf("function handleImmersiveModeShortcut("),
    );

    expect(fn).toContain("handleMaterialPickShortcut(sidebar, event)");
  });

  // The chip owns "arm, disarm, or open the list when there is no PDF box", so
  // the keyboard must not re-implement that branch.
  it("presses the 素材 chip instead of duplicating the toggle", () => {
    const fn = sidebarSource.slice(
      sidebarSource.indexOf("function handleMaterialPickShortcut("),
      sidebarSource.indexOf("async function handleReaderPromptShortcut("),
    );

    expect(fn).toContain('".composer-material-chip"');
    expect(fn).toContain("chip.click();");
    expect(fn).toContain("isEditableEventTarget(event.target)");
    expect(fn).toContain(
      "isMaterialPickShortcut(event, getMaterialPickShortcut(zoteroPrefs()))",
    );
  });
});
