import type { Overview } from "../../engine/index.ts";

function countedList(heading: string, entries: Overview["tags"]): string {
  const lines =
    entries.length === 0
      ? ["(none)"]
      : entries.map((entry) => `- ${entry.name} (${entry.documents})`);
  return `## ${heading}\n\n${lines.join("\n")}\n`;
}

export function renderOverview(overview: Overview): string {
  const header = [
    "# Overview",
    "",
    `- documents: ${overview.documents}`,
    `- chunks: ${overview.chunks}`,
    `- embedding model: ${overview.embedding_model ?? "(none)"}`,
    `- index_version: ${overview.index_version}`,
    "",
  ].join("\n");
  return [header, countedList("Tags", overview.tags)].join("\n");
}
