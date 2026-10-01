import type { Block, Range } from "./blocks.ts";

const SENTENCE_END = /([.!?]["')\]]*)\s+/g;

// Only paragraphs and lists have usable boundaries; code, tables and the rest stay whole (ADR-011).
export function splitOversized(
  blocks: Block[],
  body: string,
  maxChars: number,
): Block[] {
  return blocks.flatMap((block) => {
    if (block.end - block.start <= maxChars) return [block];
    const parts = partsOf(block, body);
    if (parts.length < 2) return [block];
    return parts.map((part) => ({
      type: block.type,
      headings: block.headings,
      ...part,
    }));
  });
}

function partsOf(block: Block, body: string): Range[] {
  if (block.type === "list") return block.items ?? [];
  if (block.type === "paragraph") return sentences(block, body);
  return [];
}

function sentences({ start, end }: Range, body: string): Range[] {
  const text = body.slice(start, end);
  const parts: Range[] = [];
  let from = 0;
  for (const match of text.matchAll(SENTENCE_END)) {
    parts.push({
      start: start + from,
      end: start + match.index + match[1].length,
    });
    from = match.index + match[0].length;
  }
  if (from < text.length) parts.push({ start: start + from, end });
  return parts;
}
