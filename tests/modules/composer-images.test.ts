import { describe, expect, it } from "vitest";
import {
  dropDraftImagesMissingMarker,
  renameComposerMarker,
  removeDraftImage,
  type DraftImage,
  type DraftImageState,
} from "../../src/modules/composer-images";

function draftState(images: DraftImage[]): DraftImageState {
  return {
    draftText: "",
    draftSelectionStart: 0,
    draftSelectionEnd: 0,
    draftHadFocus: false,
    draftImages: images,
    nextPasteID: 1,
  };
}

function image(marker: string, id = marker): DraftImage {
  return {
    id,
    marker,
    name: `${id}.png`,
    mediaType: "image/png",
    dataUrl: "data:image/png;base64,AA==",
    size: 1,
  };
}

function textarea(value: string): HTMLTextAreaElement {
  const input = document.createElement("textarea");
  input.value = value;
  input.selectionStart = value.length;
  input.selectionEnd = value.length;
  return input;
}

describe("dropping pictures whose marker left the composer", () => {
  it("drops the picked picture that a new pick replaces and renumbers the rest", () => {
    const kept = image("[Image #1]", "kept");
    const replaced = {
      ...image("[Image #2]", "replaced"),
      figureId: "mineru:images/b.jpg",
    };
    const pasted = image("[Image #3]", "pasted");
    const state = draftState([kept, replaced, pasted]);
    const input = textarea("[Image #1]\n\n[Image #2]\n\n[Image #3]");

    removeDraftImage(state, input, replaced);

    expect(state.draftImages.map((entry) => entry.id)).toEqual([
      "kept",
      "pasted",
    ]);
    expect(input.value).toBe("[Image #1]\n\n[Image #2]");
    expect(pasted.marker).toBe("[Image #2]");
  });

  it("keeps every picture while its marker is in the text", () => {
    const state = draftState([image("[Image #1]")]);
    const input = textarea("看图 [Image #1]");

    expect(dropDraftImagesMissingMarker(state, input)).toBe(false);
    expect(state.draftImages).toHaveLength(1);
    expect(input.value).toBe("看图 [Image #1]");
  });

  it("drops the picture and renumbers the rest when the marker is deleted", () => {
    const state = draftState([
      image("[Image #1]"),
      image("[Image #2]"),
      image("[Image #3]"),
    ]);
    // The user deleted the first marker line, the other two are still there.
    const input = textarea("[Image #2]\n[Image #3]");

    expect(dropDraftImagesMissingMarker(state, input)).toBe(true);
    expect(state.draftImages.map((item) => item.name)).toEqual([
      "[Image #2].png",
      "[Image #3].png",
    ]);
    expect(state.draftImages.map((item) => item.marker)).toEqual([
      "[Image #1]",
      "[Image #2]",
    ]);
    expect(input.value).toBe("[Image #1]\n[Image #2]");
  });

  it("leaves the caret where the user was typing", () => {
    // Renumbering shortens the remaining marker by one character; the caret
    // must not jump to the end of the input while the user is typing.
    const state = draftState([image("[Image #1]"), image("[Image #10]")]);
    const input = textarea("如图 [Image #10]");
    input.selectionStart = 0;
    input.selectionEnd = 0;

    expect(dropDraftImagesMissingMarker(state, input)).toBe(true);
    expect(input.value).toBe("如图 [Image #1]");
    expect(state.draftImages.map((item) => item.marker)).toEqual([
      "[Image #1]",
    ]);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(0);
  });
});

describe("renaming a composer marker", () => {
  it("ignores a marker that is no longer in the text", () => {
    const input = textarea("nothing here");
    expect(renameComposerMarker(input, "[Image #1]", "[Image #2]")).toBe(false);
    expect(input.value).toBe("nothing here");
  });
});
