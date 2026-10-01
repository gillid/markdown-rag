import type { List, Root } from "mdast";
import { toString as nodeText } from "mdast-util-to-string";
import { createSlugger } from "./slug.ts";
import { normalizeWhitespace } from "./text.ts";

export interface HeadingRef {
  depth: number;
  text: string;
  anchor: string;
}

export interface Range {
  start: number;
  end: number;
}

export interface Block extends Range {
  type: string;
  /** Heading path in force at this block; a heading block's path ends with itself. */
  headings: HeadingRef[];
  /** A list's items, the finer boundary for splitting an oversized list. */
  items?: Range[];
}

/** Splits the body tree into its top-level structural blocks (heading, paragraph, list, code, table, …). */
export function toBlocks(tree: Root): Block[] {
  const slugify = createSlugger();
  const path: HeadingRef[] = [];
  const blocks: Block[] = [];

  for (const node of tree.children) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;

    if (node.type === "heading") {
      // A heading with no content at all is neither a boundary nor part of the path.
      if (node.children.length === 0) continue;
      const text = normalizeWhitespace(
        node.children
          .filter((child) => child.type !== "html")
          .map((child) => nodeText(child))
          .join(""),
      );
      while (path.length > 0 && (path.at(-1)?.depth ?? 0) >= node.depth) {
        path.pop();
      }
      // An HTML-only heading is still a boundary, but has no text to name.
      if (text !== "") {
        path.push({ depth: node.depth, text, anchor: slugify(text) });
      }
    }

    const block: Block = { type: node.type, start, end, headings: [...path] };
    if (node.type === "list") block.items = itemRanges(node);
    blocks.push(block);
  }

  return blocks;
}

function itemRanges(list: List): Range[] {
  return list.children.flatMap((item) => {
    const start = item.position?.start.offset;
    const end = item.position?.end.offset;
    return start === undefined || end === undefined ? [] : [{ start, end }];
  });
}
