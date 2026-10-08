import { type Filter, matchesFilter } from "../index/filter.ts";
import type { KnowledgeIndex } from "../index/knowledge-index.ts";
import { compareStrings } from "./compare.ts";
import type { OverviewOutput } from "./schemas/overview.ts";

type Counted = OverviewOutput["tags"];

function countDocuments(names: Iterable<string>): Counted {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([name, documents]) => ({ name, documents }));
}

/** What the knowledge base holds within the filter: counts, and the values a caller can build filters from (ADR-035). */
export function overviewOf(
  index: KnowledgeIndex,
  filter: Filter,
): OverviewOutput {
  const matching = [...index.documents.values()].filter(({ summary }) =>
    matchesFilter(summary, filter),
  );
  return {
    index_version: index.version,
    embedding_model: index.model?.modelId ?? null,
    documents: matching.length,
    chunks: matching.reduce((sum, { chunks }) => sum + chunks.length, 0),
    // A tag listed twice in one document still counts that document once.
    tags: countDocuments(
      matching.flatMap(({ summary }) => [...new Set(summary.tags)]),
    ),
  };
}
