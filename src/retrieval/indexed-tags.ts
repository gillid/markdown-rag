import type { KnowledgeIndex } from "../index/knowledge-index.ts";

/** Every tag some indexed document carries; the vocabulary a tag weight can name (ADR-045). */
export function indexedTags(index: KnowledgeIndex): Set<string> {
  return new Set(
    [...index.documents.values()].flatMap(({ summary }) => summary.tags),
  );
}
