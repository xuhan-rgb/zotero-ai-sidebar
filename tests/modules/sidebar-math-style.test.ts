import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(process.cwd(), "addon/content/sidebar.css"),
  "utf8",
);

describe("chat inline math typography", () => {
  it("uses the original bounded inline math container", () => {
    const inlineRule = css.match(/\.math-inline\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(inlineRule).toContain("display: inline-block");
    expect(inlineRule).toContain("max-width: 100%");
    expect(inlineRule).toContain("overflow-x: auto");
    expect(css).not.toContain("vertical-align: -0.08em");
  });
});
