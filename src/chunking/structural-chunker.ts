import { type Block, type HeadingRef, toBlocks } from "./blocks.ts";
import { buildBreadcrumb } from "./breadcrumb.ts";
import type { Chunker, ChunkSpan } from "./chunker.ts";
import { splitOversized } from "./split-oversized.ts";

// About 330 tokens for path-dense text, so a splittable chunk stays inside a 512-token window.
export const DEFAULT_MAX_CHARS = 1000;
// Bump when the splitting rules change.
const ALGORITHM_VERSION = 2;
const BREADCRUMB_SHARE = 0.25;

export interface StructuralChunkerOptions {
  /** Code blocks, tables and carried headings can exceed it (ADR-048). */
  maxChars?: number;
}

const isHeading = (block: Block) => block.type === "heading";

/** Structure-aware splitter (ADR-011); the packing rules are in docs/implementation.md step 8. */
export function createStructuralChunker(
  options: StructuralChunkerOptions = {},
): Chunker {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  if (!Number.isInteger(maxChars) || maxChars < 1) {
    throw new RangeError(
      `maxChars must be a positive integer, got ${maxChars}`,
    );
  }
  const maxBreadcrumb = Math.floor(maxChars * BREADCRUMB_SHARE);

  return {
    // Everything that shapes the output is in the id, so a change invalidates recorded chunks.
    id: `structural@${ALGORITHM_VERSION};max=${maxChars}`,
    async chunk({ title, body, tree }) {
      const blocks = splitOversized(toBlocks(tree), body, maxChars);
      const groups = packBlocks(blocks, maxChars);

      if (groups.length === 0) {
        // Blocks were all skipped (e.g. an empty heading), but the body still has text.
        return body.trim() === ""
          ? []
          : [
              {
                start: 0,
                end: body.length,
                breadcrumb: buildBreadcrumb(title, [], maxBreadcrumb),
                anchor: "",
              },
            ];
      }

      return groups.map((group, i): ChunkSpan => {
        const headings = pathOf(group);
        return {
          // Chunks tile the body: the first absorbs leading blank lines, each the gap after it.
          start: i === 0 ? 0 : (group[0]?.start ?? 0),
          end: groups[i + 1]?.[0]?.start ?? body.length,
          breadcrumb: buildBreadcrumb(title, headings, maxBreadcrumb),
          anchor: headings.at(-1)?.anchor ?? "",
        };
      });
    },
  };
}

// The content blocks of a group share one path; a group of headings alone takes the last heading's.
function pathOf(group: Block[]): HeadingRef[] {
  const content = group.findLast((block) => !isHeading(block));
  return (content ?? group.at(-1))?.headings ?? [];
}

function packBlocks(blocks: Block[], maxChars: number): Block[][] {
  const groups: Block[][] = [];
  let current: Block[] = [];
  let onlyHeadings = true;

  const flush = () => {
    if (current.length > 0) groups.push(current);
    current = [];
    onlyHeadings = true;
  };

  for (const block of blocks) {
    const oversized = block.end - block.start > maxChars;
    const first = current[0];

    if (
      !onlyHeadings &&
      (isHeading(block) ||
        oversized ||
        (first && block.end - first.start > maxChars))
    ) {
      flush();
    }

    current.push(block);
    onlyHeadings &&= isHeading(block);
    if (oversized && !isHeading(block)) flush();
  }

  // A trailing run of headings joins the chunk before it rather than standing alone.
  const previous = groups.at(-1);
  if (previous && onlyHeadings) {
    previous.push(...current);
  } else {
    flush();
  }

  return groups;
}
