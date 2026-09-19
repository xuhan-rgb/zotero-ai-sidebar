import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sidebarSource = readFileSync(
  resolve(process.cwd(), "src/modules/sidebar.ts"),
  "utf8",
);

describe("sidebar selection clear synchronization", () => {
  it("keeps the 素材 and 使用须知 chips when refreshing the switcher row", () => {
    const fn = sidebarSource.slice(
      sidebarSource.indexOf("function updateSelectionIndicators("),
      sidebarSource.indexOf("function isFocusInside("),
    );
    // The row is [素材][联网][原文?][使用须知]; this partial refresh owns only
    // the two mode switchers, so the chips must be carried over.
    expect(fn).toContain(":scope > .composer-material-chip");
    expect(fn).toContain(":scope > .composer-web-notice-chip");
    expect(fn).not.toMatch(
      /switchers\.replaceChildren\(\s*renderWebSearchSwitcher\(/,
    );
  });

  it("captures whether a selection existed before clearing", () => {
    const fn = sidebarSource.slice(
      sidebarSource.indexOf("function refreshActiveReaderSelection("),
      sidebarSource.indexOf("function fullTranslationSidebarForMount("),
    );
    expect(fn).toContain(
      "const hadSelection = !!firstStoredSelectedText(ids);",
    );
    expect(fn).toContain("clearStoredSelectedText(ids);");
  });

  it("clears selection reference marks when a stored selection existed", () => {
    const fn = sidebarSource.slice(
      sidebarSource.indexOf("function refreshActiveReaderSelection("),
      sidebarSource.indexOf("function fullTranslationSidebarForMount("),
    );
    expect(fn).toContain(
      "if (hadSelection) clearSelectionReferenceMarks(reader);",
    );
  });

  it("reads hadSelection before clearing stored text in clearWhenEmpty", () => {
    const fn = sidebarSource.slice(
      sidebarSource.indexOf("function refreshActiveReaderSelection("),
      sidebarSource.indexOf("function fullTranslationSidebarForMount("),
    );
    const hadSelectionPos = fn.indexOf(
      "const hadSelection = !!firstStoredSelectedText(ids);",
    );
    const clearStoredPos = fn.indexOf("clearStoredSelectedText(ids);");
    const clearMarksPos = fn.indexOf(
      "if (hadSelection) clearSelectionReferenceMarks(reader);",
    );

    expect(hadSelectionPos).toBeGreaterThan(-1);
    expect(clearStoredPos).toBeGreaterThan(-1);
    expect(clearMarksPos).toBeGreaterThan(-1);
    expect(hadSelectionPos).toBeLessThan(clearStoredPos);
    expect(clearStoredPos).toBeLessThan(clearMarksPos);
  });
});
  it("ignores reader selections while material picking is active", () => {
    expect(sidebarSource).toContain(
      "const materialPickingMounts = new Set<HTMLElement>();",
    );
    // The composer mirrors the picker's open state onto this registry.
    expect(sidebarSource).toMatch(
      /onVisibilityChange: \(open\) => \{\s*materialPick\?\.classList\.toggle\("is-active", open\);\s*if \(open\) materialPickingMounts\.add\(mount\);\s*else materialPickingMounts\.delete\(mount\);/,
    );

    // Poll + render refresh: neither capture nor clear while picking.
    const refresh = sidebarSource.slice(
      sidebarSource.indexOf("function refreshActiveReaderSelection("),
      sidebarSource.indexOf("function fullTranslationSidebarForMount("),
    );
    expect(refresh).toContain(
      "if (isMaterialPicking()) return firstUsableStoredSelectedText(ids);",
    );

    // Send path: the live selection must not sneak in through the prompt text.
    const prompt = sidebarSource.slice(
      sidebarSource.indexOf("async function getSelectedTextForPrompt("),
      sidebarSource.indexOf("function refreshActiveReaderSelection("),
    );
    expect(prompt).toContain("const picking = isMaterialPicking();");
    expect(prompt).toContain("getActiveReaderSelectionRangeText(reader)");
    expect(prompt).toContain(
      'const liveText = picking ? "" : getActiveReaderSelection(reader);',
    );

    // Reader popup event: the drag that Zotero reports is not our selection.
    const handler = sidebarSource.slice(
      sidebarSource.indexOf("readerSelectionHandler = (event: unknown) => {"),
      sidebarSource.indexOf('"renderTextSelectionPopup",'),
    );
    expect(handler).toContain("if (isMaterialPicking()) return;");
  });
