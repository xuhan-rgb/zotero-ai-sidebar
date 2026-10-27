import { describe, expect, it } from "vitest";
import { adaptiveChatWidth } from "../../src/modules/adaptive-chat-width";

describe("adaptiveChatWidth", () => {
  it("narrows the chat when the PDF grows and widens it when the PDF shrinks", () => {
    const zoomedIn = adaptiveChatWidth({
      windowWidth: 1400,
      readerLeft: 100,
      pdfWidth: 800,
    });
    const zoomedOut = adaptiveChatWidth({
      windowWidth: 1400,
      readerLeft: 100,
      pdfWidth: 500,
    });

    expect(zoomedIn?.chatWidth).toBeLessThan(zoomedOut!.chatWidth);
  });

  it("leaves note width accounted for outside the chat and reader", () => {
    expect(
      adaptiveChatWidth({
        windowWidth: 1400,
        readerLeft: 100,
        pdfWidth: 500,
        noteWidth: 200,
        splitterWidth: 4,
      }),
    ).toEqual({ chatWidth: 596, readerWidth: 500, fits: true });
  });

  it("clamps chat width and reports when the PDF cannot fit", () => {
    const clamped = adaptiveChatWidth({
      windowWidth: 2000,
      readerLeft: 100,
      pdfWidth: 100,
    });
    const noFit = adaptiveChatWidth({
      windowWidth: 600,
      readerLeft: 100,
      pdfWidth: 700,
    });

    expect(clamped?.chatWidth).toBe(760);
    expect(clamped?.readerWidth).toBe(1136);
    expect(noFit).toEqual({ chatWidth: 320, readerWidth: 176, fits: false });
  });

  it("returns null for invalid arguments or an impossible base rectangle", () => {
    expect(
      adaptiveChatWidth({
        windowWidth: Number.NaN,
        readerLeft: 0,
        pdfWidth: 1,
      }),
    ).toBeNull();
    expect(
      adaptiveChatWidth({ windowWidth: 100, readerLeft: -1, pdfWidth: 1 }),
    ).toBeNull();
    expect(
      adaptiveChatWidth({
        windowWidth: 100,
        readerLeft: 0,
        pdfWidth: 1,
        minChatWidth: 500,
        maxChatWidth: 400,
      }),
    ).toBeNull();
    expect(
      adaptiveChatWidth({ windowWidth: 100, readerLeft: 100, pdfWidth: 1 }),
    ).toBeNull();
  });
});
