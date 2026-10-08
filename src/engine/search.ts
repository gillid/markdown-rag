import type { z } from "zod";
import type { KnowledgeIndex } from "../index/knowledge-index.ts";
import { RetrievalOptionError } from "../retrieval/errors.ts";
import type { createRetriever } from "../retrieval/retrieve.ts";
import { InvalidRequestError } from "./errors.ts";
import type { SearchResponse, searchRequestSchema } from "./schemas/search.ts";
import { toSummaryOutput } from "./summary-output.ts";

type ParsedSearchRequest = z.output<typeof searchRequestSchema>;

/** Runs a validated request through the retrieval pipeline and maps the result to the wire form (ADR-036). */
export async function searchOf(
  index: KnowledgeIndex,
  retrieve: ReturnType<typeof createRetriever>,
  request: ParsedSearchRequest,
): Promise<SearchResponse> {
  const { results, timings } = await retrieve({
    query: request.query,
    filter: request.filter,
    mode: request.mode,
    limit: request.limit,
    minScore: request.min_score,
    weights: request.weights,
    expand: request.expand,
  }).catch((error: unknown) => {
    // Values the schema can't judge, such as a weight for a signal other than recency, are still the caller's mistake.
    if (error instanceof RetrievalOptionError) {
      throw new InvalidRequestError(
        `Invalid search request:\n${error.message}`,
      );
    }
    throw error;
  });
  return {
    results: results.map((result) => ({
      ...toSummaryOutput(result.summary, result.ref),
      breadcrumb: result.breadcrumb,
      text: result.text,
      scores: result.scores,
    })),
    timings: {
      embed_ms: timings.embedMs,
      search_ms: timings.searchMs,
      rerank_ms: timings.rerankMs,
      total_ms: timings.totalMs,
    },
    index_version: index.version,
  };
}
