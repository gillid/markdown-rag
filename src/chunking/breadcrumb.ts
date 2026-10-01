import type { HeadingRef } from "./blocks.ts";
import { normalizeWhitespace } from "./text.ts";

const SEPARATOR = " › ";
const ELLIPSIS = "…";

/** `title › H2 › H3`; a top-level heading that repeats the title is left out. */
export function buildBreadcrumb(
  title: string,
  headings: HeadingRef[],
  maxLength: number,
): string {
  const cleanTitle = normalizeWhitespace(title);
  const parts = [
    cleanTitle,
    ...headings
      .filter(
        (heading) => !(heading.depth === 1 && heading.text === cleanTitle),
      )
      .map((heading) => heading.text),
  ];
  return truncateMiddle(parts.join(SEPARATOR), maxLength);
}

function truncateMiddle(text: string, maxLength: number): string {
  // Code points, so a surrogate pair is never cut in half.
  const chars = Array.from(text);
  if (chars.length <= maxLength) return text;
  const keep = Math.max(maxLength - ELLIPSIS.length, 0);
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  const end = tail > 0 ? chars.slice(-tail) : [];
  return `${chars.slice(0, head).join("")}${ELLIPSIS}${end.join("")}`;
}
