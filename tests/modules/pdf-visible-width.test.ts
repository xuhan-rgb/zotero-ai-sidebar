import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { visiblePdfWidth } from "../../src/modules/pdf-visible-width";

function size(view: Window, width: number) {
  Object.defineProperty(view, "innerWidth", {
    configurable: true,
    value: width,
  });
}

describe("visiblePdfWidth", () => {
  it("maps nested scaled frames and clips to the host reading edge", () => {
    const host = new Window({ width: 1000, height: 800 });
    const outer = host.document.createElement("iframe");
    host.document.body.append(outer);
    Object.defineProperties(outer, {
      offsetWidth: { value: 500 },
      offsetHeight: { value: 400 },
    });
    outer.getBoundingClientRect = () => new host.DOMRect(100, 50, 1000, 800);
    const inner = outer.contentWindow!.document.createElement("iframe");
    outer.contentWindow!.document.body.append(inner);
    Object.defineProperties(inner, {
      offsetWidth: { value: 500 },
      offsetHeight: { value: 400 },
    });
    inner.getBoundingClientRect = () =>
      new outer.contentWindow!.DOMRect(10, 0, 500, 400);
    const view = inner.contentWindow!;
    size(view, 500);
    const container = view.document.createElement("div");
    container.getBoundingClientRect = () => new view.DOMRect(20, 0, 300, 200);
    expect(
      visiblePdfWidth(
        view as unknown as Window,
        container,
        [outer.contentWindow as unknown as Window],
        {
          hostWindow: host as unknown as Window,
          right: 600,
        },
      ),
    ).toBe(220);
  });

  it("uses uncapped native width so the cutoff can later grow", () => {
    const host = new Window({ width: 1000, height: 800 });
    const container = host.document.createElement("div");
    size(host, 900);
    container.getBoundingClientRect = () => new host.DOMRect(100, 0, 200, 200);
    const viewport = { hostWindow: host as unknown as Window, right: 400 };
    expect(
      visiblePdfWidth(host as unknown as Window, container, [], viewport),
    ).toBe(300);
    viewport.right = 700;
    expect(
      visiblePdfWidth(host as unknown as Window, container, [], viewport),
    ).toBe(600);
  });

  it("returns null for no visible width or invalid frame mapping", () => {
    const host = new Window({ width: 500, height: 500 });
    const container = host.document.createElement("div");
    container.getBoundingClientRect = () => new host.DOMRect(600, 0, 100, 100);
    expect(
      visiblePdfWidth(host as unknown as Window, container, [], {
        hostWindow: host as unknown as Window,
        right: 400,
      }),
    ).toBeNull();

    const child = new Window();
    size(child, 500);
    const childContainer = child.document.createElement("div");
    childContainer.getBoundingClientRect = () =>
      new child.DOMRect(0, 0, 100, 100);
    expect(
      visiblePdfWidth(child as unknown as Window, childContainer, [], {
        hostWindow: host as unknown as Window,
        right: 400,
      }),
    ).toBeNull();
  });
  it("recognizes a host Window wrapper instead of failing at the top frame", () => {
    const host = new Window({ width: 1000, height: 800 });
    const frame = host.document.createElement("iframe");
    host.document.body.append(frame);
    Object.defineProperties(frame, {
      offsetWidth: { value: 800 },
      offsetHeight: { value: 600 },
    });
    frame.getBoundingClientRect = () => new host.DOMRect(100, 0, 800, 600);
    const view = frame.contentWindow!;
    size(view, 800);
    const container = view.document.createElement("div");
    container.getBoundingClientRect = () => new view.DOMRect(0, 0, 800, 600);
    const wrappedHost = {
      document: host.document,
      innerWidth: 1000,
      wrappedJSObject: host,
    } as unknown as Window;
    expect(
      visiblePdfWidth(view as unknown as Window, container, [], {
        hostWindow: wrappedHost,
        right: 700,
      }),
    ).toBe(600);
  });
});
