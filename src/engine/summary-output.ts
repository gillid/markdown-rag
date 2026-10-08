import type { DocumentSummary } from "../index/knowledge-index.ts";
import type { DocumentSummaryOutput } from "./schemas/document.ts";

/** The wire form of a summary; `ref` is overridden where the result names a chunk or section rather than the document. */
export function toSummaryOutput(
  summary: DocumentSummary,
  ref: string = summary.ref,
): DocumentSummaryOutput {
  return {
    ref,
    path: summary.path,
    title: summary.title,
    tags: summary.tags,
    updated_at: summary.updatedAt,
    meta: summary.meta,
  };
}
