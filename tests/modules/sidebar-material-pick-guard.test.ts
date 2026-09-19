import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sidebarSource = readFileSync(
  resolve(process.cwd(), "src/modules/sidebar.ts"),
  "utf8",
);

function renderPanelBody(): string {
  return sidebarSource.slice(
    sidebarSource.indexOf("function renderPanel("),
    sidebarSource.indexOf("function renderPanelRecovery("),
  );
}

function pickWatchBody(): string {
  return sidebarSource.slice(
    sidebarSource.indexOf("const watchFigurePdfPick = ("),
    sidebarSource.indexOf("const updateStatus = (captureFocus"),
  );
}

describe("material pick page guard", () => {
  // A re-render replaces the composer, menu included. The old picker's page
  // listeners outlive that menu unless the swap stops them, which would leave
  // clicks (and the pick hint) taken over while the 素材 chip is dark.
  it("stops the previous picker before swapping the panel", () => {
    const body = renderPanelBody();
    const dispose = body.indexOf("disposeComposerPicker(mount);");

    expect(dispose).toBeGreaterThan(-1);
    expect(dispose).toBeLessThan(body.indexOf("mount.replaceChildren();"));
  });

  it("registers the picker of the current render for that stop", () => {
    const body = sidebarSource.slice(
      sidebarSource.indexOf("const watchFigurePdfPick = ("),
      sidebarSource.indexOf("const composerSwitchers = el("),
    );

    expect(body).toContain(
      "composerPickerDisposers.set(mount, () => figurePicker.disarm());",
    );
  });

  it("only takes page clicks and selections while picking is on", () => {
    const body = pickWatchBody();
    const guards = body.split("if (!materialPickingMounts.has(mount)) return;");

    // One guard on pointerdown (the pick hint rides on it) and one on
    // selectstart, so both the click and the text lock follow the same state.
    expect(guards).toHaveLength(3);
    expect(body).toContain("event.preventDefault();");
  });
});
