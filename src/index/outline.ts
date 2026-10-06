import type { Root } from "mdast";
import {
  type Block,
  type HeadingRef,
  type Range,
  toBlocks,
} from "../chunking/blocks.ts";

interface OutlineEntry {
  heading: HeadingRef;
  /** Offset of the heading block in the body. */
  start: number;
}

function outlineEntries(blocks: readonly Block[]): OutlineEntry[] {
  const seen = new Set<HeadingRef>();
  const entries: OutlineEntry[] = [];
  for (const block of blocks) {
    const heading = block.headings.at(-1);
    // An HTML-only heading adds no path entry, so its block ends in an earlier heading.
    if (block.type === "heading" && heading && !seen.has(heading)) {
      seen.add(heading);
      entries.push({ heading, start: block.start });
    }
  }
  return entries;
}

export interface Headings {
  /** Headings in document order with their anchors, resolved the same way as chunk breadcrumbs (ADR-035). */
  outline: HeadingRef[];
  /** Each heading's section by anchor: from the heading to the next heading of the same or a shallower depth, or the end of the body. */
  sections: Map<string, Range>;
}

/** One pass over the tree, so the outline and the sections can't disagree about an anchor. */
export function buildHeadings(tree: Root, bodyLength: number): Headings {
  const entries = outlineEntries(toBlocks(tree));
  // A heading closes every open section of the same or a deeper level.
  const ends = entries.map(() => bodyLength);
  const open: number[] = [];
  entries.forEach(({ heading, start }, i) => {
    for (
      let top = open.at(-1);
      top !== undefined && (entries[top]?.heading.depth ?? 0) >= heading.depth;
      top = open.at(-1)
    ) {
      ends[top] = start;
      open.pop();
    }
    open.push(i);
  });
  const sections = new Map<string, Range>();
  entries.forEach(({ heading, start }, i) => {
    sections.set(heading.anchor, { start, end: ends[i] ?? bodyLength });
  });
  return { outline: entries.map(({ heading }) => heading), sections };
}
