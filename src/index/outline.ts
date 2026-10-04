import type { Root } from "mdast";
import { type HeadingRef, toBlocks } from "../chunking/blocks.ts";

/** Headings in document order with their anchors, resolved the same way as chunk breadcrumbs (ADR-035). */
export function buildOutline(tree: Root): HeadingRef[] {
  const seen = new Set<HeadingRef>();
  const outline: HeadingRef[] = [];
  for (const block of toBlocks(tree)) {
    const heading = block.headings.at(-1);
    // An HTML-only heading adds no path entry, so its block ends in an earlier heading.
    if (block.type === "heading" && heading && !seen.has(heading)) {
      seen.add(heading);
      outline.push(heading);
    }
  }
  return outline;
}
