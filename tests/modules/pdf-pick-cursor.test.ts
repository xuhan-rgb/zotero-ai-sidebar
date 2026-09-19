import { beforeEach, describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { setMaterialPickCursor } from "../../src/modules/pdf-pick-cursor";

describe("setMaterialPickCursor", () => {
  let window: Window;
  let document: Document;

  beforeEach(() => {
    window = new Window();
    document = window.document;
  });

  it("adds one style element for the armed document", () => {
    setMaterialPickCursor(document, true);

    const style = document.getElementById("zai-material-pick-cursor");
    expect(style).toBeTruthy();
    expect(style?.tagName).toBe("STYLE");
    expect(style?.textContent).toBe(
      ".page, .page * { cursor: crosshair !important; user-select: none !important; -webkit-user-select: none !important; }",
    );
    expect(style?.parentElement).toBe(document.head);

    const allStyles = document.querySelectorAll("#zai-material-pick-cursor");
    expect(allStyles.length).toBe(1);
  });

  it("keeps a single element when armed twice", () => {
    setMaterialPickCursor(document, true);
    setMaterialPickCursor(document, true);

    const allStyles = document.querySelectorAll("#zai-material-pick-cursor");
    expect(allStyles.length).toBe(1);
  });

  it("removes the element when disarmed", () => {
    setMaterialPickCursor(document, true);
    expect(document.getElementById("zai-material-pick-cursor")).toBeTruthy();

    setMaterialPickCursor(document, false);
    expect(document.getElementById("zai-material-pick-cursor")).toBeNull();
  });

  it("disarming a document that was never armed is a no-op", () => {
    expect(() => setMaterialPickCursor(document, false)).not.toThrow();
    expect(document.getElementById("zai-material-pick-cursor")).toBeNull();
  });

  it("keeps two documents independent", () => {
    const window2 = new Window();
    const document2 = window2.document;

    setMaterialPickCursor(document, true);
    expect(document.getElementById("zai-material-pick-cursor")).toBeTruthy();
    expect(document2.getElementById("zai-material-pick-cursor")).toBeNull();

    setMaterialPickCursor(document2, true);
    expect(document.getElementById("zai-material-pick-cursor")).toBeTruthy();
    expect(document2.getElementById("zai-material-pick-cursor")).toBeTruthy();

    setMaterialPickCursor(document, false);
    expect(document.getElementById("zai-material-pick-cursor")).toBeNull();
    expect(document2.getElementById("zai-material-pick-cursor")).toBeTruthy();
  });
});
