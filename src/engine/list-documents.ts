import { matchesFilter } from "../index/filter.ts";
import type {
  DocumentSummary,
  KnowledgeIndex,
} from "../index/knowledge-index.ts";
import { compareStrings } from "./compare.ts";
import {
  DEFAULT_LIST_LIMIT,
  type DocumentList,
  type ListRequest,
} from "./schemas/list.ts";
import { toSummaryOutput } from "./summary-output.ts";

function byPath(a: DocumentSummary, b: DocumentSummary): number {
  return compareStrings(a.path, b.path);
}

const comparators = {
  path: byPath,
  updated_at: (a: DocumentSummary, b: DocumentSummary) =>
    b.updatedAt - a.updatedAt || byPath(a, b),
};

/** Unranked listing of the matching documents; the order is total, so offsets are stable for an index version (ADR-035). */
export function listDocumentsOf(
  index: KnowledgeIndex,
  request: ListRequest,
): DocumentList {
  const { filter = {}, sort = "path", offset = 0 } = request;
  const limit = request.limit ?? DEFAULT_LIST_LIMIT;
  const matching = [...index.documents.values()]
    .map(({ summary }) => summary)
    .filter((summary) => matchesFilter(summary, filter))
    .sort(comparators[sort]);
  return {
    total: matching.length,
    offset,
    limit,
    documents: matching
      .slice(offset, offset + limit)
      .map((s) => toSummaryOutput(s)),
    index_version: index.version,
  };
}
