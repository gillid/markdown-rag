import type { Document } from "../../engine/index.ts";
import { formatDate } from "./format.ts";

function header(document: Document): string[] {
  const meta = Object.entries(document.meta).map(
    ([key, value]) => `- meta.${key}: ${JSON.stringify(value)}`,
  );
  return [
    `# ${document.title}`,
    "",
    `- ref: ${document.ref}`,
    `- updated: ${formatDate(document.updated_at)}`,
    ...(document.tags.length === 0
      ? []
      : [`- tags: ${document.tags.join(", ")}`]),
    ...meta,
  ];
}

function outline(document: Document): string[] {
  if (document.outline.length === 0) return ["(no headings)"];
  // A loop, not `Math.min(...depths)`: a heading-dense 1 MB document would overflow the argument limit.
  let shallowest = Number.POSITIVE_INFINITY;
  for (const entry of document.outline) {
    shallowest = Math.min(shallowest, entry.depth);
  }
  return document.outline.map(
    (entry) =>
      `${"  ".repeat(entry.depth - shallowest)}- ${entry.text} (#${entry.anchor})`,
  );
}

export function renderGet(document: Document): string {
  const lines = [
    ...header(document),
    "",
    "## Outline",
    "",
    ...outline(document),
  ];
  if (document.body !== undefined) {
    lines.push("", "---", "", document.body === "" ? "(empty)" : document.body);
  }
  return `${lines.join("\n")}\n`;
}
