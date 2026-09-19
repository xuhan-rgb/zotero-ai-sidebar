import { beforeEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { flashMaterialPickHint } from "../../src/modules/pdf-pick-hint";

describe("flashMaterialPickHint", () => {
  let window: Window;
  let document: Document;

  beforeEach(() => {
    window = new Window();
    document = window.document;
    // The bubble cleans itself up on a reader-window timer; stub it so the
    // assertions never race a real 1.8s wait.
    vi.spyOn(window, "setTimeout").mockImplementation((() => 0) as never);
  });

  it("tells the user why the click cannot pick, at the click itself", () => {
    flashMaterialPickHint(document, 320, 240);

    const hint = document.getElementById("zai-material-pick-hint");
    expect(hint?.textContent).toContain("LaTeX 源");
    expect(hint?.textContent).toContain("请在列表里选");
    expect((hint as HTMLElement).style.left).toBe("320px");
    expect((hint as HTMLElement).style.top).toBe("240px");
    expect(hint?.parentElement).toBe(document.body);
  });

  it("keeps one bubble when the user keeps clicking", () => {
    flashMaterialPickHint(document, 10, 10);
    flashMaterialPickHint(document, 20, 20);

    const hints = document.querySelectorAll<HTMLElement>(
      "#zai-material-pick-hint",
    );
    expect(hints).toHaveLength(1);
    expect(hints[0].style.left).toBe("20px");
  });

  it("schedules its own removal", () => {
    const timeout = vi.spyOn(window, "setTimeout");
    timeout.mockImplementation(((run: () => void) => {
      run();
      return 0;
    }) as never);

    flashMaterialPickHint(document, 10, 10);

    expect(timeout).toHaveBeenCalledTimes(1);
    expect(document.getElementById("zai-material-pick-hint")).toBeNull();
  });
});
