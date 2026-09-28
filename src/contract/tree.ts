import type { Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { frontmatter } from "micromark-extension-frontmatter";
import { parse as parseYaml } from "yaml";

export class FrontmatterError extends Error {
  override readonly name = "FrontmatterError";
}

export interface ParsedDocument {
  frontmatter: unknown;
  body: string;
  tree: Root;
}

/**
 * Parses the document once. The frontmatter is the tree's leading `yaml`
 * node; the returned `tree` and `body` drop it and have offsets shifted so
 * they are relative to the body, which is what chunk offsets are recorded
 * against (docs/implementation.md step 7).
 */
export function parseDocument(normalized: string): ParsedDocument {
  const tree = fromMarkdown(normalized, {
    extensions: [frontmatter(["yaml"])],
    mdastExtensions: [frontmatterFromMarkdown(["yaml"])],
  });

  const [head, ...rest] = tree.children;
  if (head?.type !== "yaml" || head.position?.end.offset === undefined) {
    throw new FrontmatterError("missing frontmatter");
  }

  let value: unknown;
  try {
    value = parseYaml(head.value);
  } catch (cause) {
    throw new FrontmatterError(
      `invalid YAML frontmatter: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const bodyStart = head.position.end.offset;
  for (const node of rest) {
    shiftOffsets(node, bodyStart);
  }

  return {
    frontmatter: value,
    body: normalized.slice(bodyStart),
    tree: { ...tree, children: rest, position: undefined },
  };
}

interface PositionedNode {
  position?: {
    start: { line: number; column: number; offset?: number };
    end: { line: number; column: number; offset?: number };
  };
  children?: PositionedNode[];
}

function shiftOffsets(node: PositionedNode, delta: number): void {
  if (node.position) {
    if (node.position.start.offset !== undefined) {
      node.position.start.offset -= delta;
    }
    if (node.position.end.offset !== undefined) {
      node.position.end.offset -= delta;
    }
  }
  if (node.children) {
    for (const child of node.children) {
      shiftOffsets(child, delta);
    }
  }
}
