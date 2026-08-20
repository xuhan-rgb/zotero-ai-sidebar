import type { Message } from "../providers/types";

// The Web Agent marks each chart it synced and leaves `[[zai-web-chart:N]]`
// where the chart sits in the answer, so a figure can be painted in place
// instead of being dropped into the thumbnail tray under the message.
const PLACEHOLDER = /\[\[zai-web-chart:(\d+)\]\]/g;

export function webChartPlaceholderOrdinal(text: string): number | null {
  const match = /^\s*\[\[zai-web-chart:(\d+)\]\]\s*$/.exec(text);
  if (!match) return null;
  const ordinal = Number(match[1]);
  return Number.isInteger(ordinal) && ordinal > 0 ? ordinal : null;
}

// A placeholder whose image never arrived would otherwise be shown to the user
// as raw text. Strip those before rendering.
export function stripWebChartPlaceholders(text: string): string {
  if (!text.includes("[[zai-web-chart:")) return text;
  return text.replace(PLACEHOLDER, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function hasWebChartPlaceholder(text: string): boolean {
  return /\[\[zai-web-chart:\d+\]\]/.test(text);
}

// Ordinals are 1-based and assigned in the same DOM order the agent pushes
// images, so ordinal N is images[N - 1].
export function webChartImage(
  images: Message["images"] | undefined,
  ordinal: number,
): NonNullable<Message["images"]>[number] | undefined {
  return images?.[ordinal - 1];
}
