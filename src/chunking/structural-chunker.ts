import { type Block, type HeadingRef, toBlocks } from "./blocks.ts";
import { buildBreadcrumb } from "./breadcrumb.ts";
import type { Chunker, ChunkSpan } from "./chunker.ts";
import { splitOversized } from "./split-oversized.ts";

export const DEFAULT_TARGET_CHARS = 1000;
const MAX_TO_TARGET_RATIO = 2;
const BREADCRUMB_SHARE = 0.25;

export interface StructuralChunkerOptions {
  targetChars?: number;
  /** Paragraphs and lists longer than this are split; defaults to twice the target. */
  maxChars?: number;
}

const isHeading = (block: Block) => block.type === "heading";

/** Structure-aware splitter (ADR-011); the packing rules are in docs/implementation.md step 8. */
export function createStructuralChunker(
  options: StructuralChunkerOptions = {},
): Chunker {
  const targetChars = options.targetChars ?? DEFAULT_TARGET_CHARS;
  const maxChars = options.maxChars ?? targetChars * MAX_TO_TARGET_RATIO;
  const maxBreadcrumb = Math.floor(targetChars * BREADCRUMB_SHARE);

  return {
    id: "structural@1",
    async chunk({ title, body, tree }) {
      const blocks = splitOversized(toBlocks(tree), body, maxChars);
      const groups = packBlocks(blocks, targetChars);

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

function packBlocks(blocks: Block[], targetChars: number): Block[][] {
  const groups: Block[][] = [];
  let current: Block[] = [];
  let onlyHeadings = true;

  const flush = () => {
    if (current.length > 0) groups.push(current);
    current = [];
    onlyHeadings = true;
  };

  for (const block of blocks) {
    const oversized = block.end - block.start > targetChars;
    const first = current[0];

    if (
      !onlyHeadings &&
      (isHeading(block) ||
        oversized ||
        (first && block.end - first.start > targetChars))
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
