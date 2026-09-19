import { describe, expect, it } from "vitest";
import { renderSupportQr, SUPPORT_PAY_URL } from "../../src/modules/support-qr";

describe("support QR", () => {
  it("keeps the payment link only, so no image ships with the plugin", () => {
    expect(SUPPORT_PAY_URL).toBe(
      "https://qr.alipay.com/fkx148299uqrtakyknpic91",
    );
  });

  it("draws a QR with a quiet zone instead of storing an image", () => {
    const svg = renderSupportQr(document);

    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.getAttribute("class")).toBe("zai-web-notice-qr");
    expect(svg.getAttribute("role")).toBe("img");
    // 33 modules (version 4) plus a 2-module quiet zone on each side.
    expect(svg.getAttribute("viewBox")).toBe("-2 -2 37 37");
    expect(svg.getAttribute("width")).toBe("132");
    expect(svg.querySelector("title")!.textContent).toBe(SUPPORT_PAY_URL);

    const path = svg.querySelector("path")!;
    const commands = path.getAttribute("d")!.match(/M\d+ \d+h1v1h-1z/g) ?? [];
    // Module 0/0 is a finder pattern corner, so the first command starts there.
    expect(commands[0]).toBe("M0 0h1v1h-1z");
    expect(commands.length).toBeGreaterThan(400);
    expect(commands.length).toBeLessThan(33 * 33);
  });
});
