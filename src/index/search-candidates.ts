import { count, type HybridWeights, search } from "@orama/orama";
import { type Filter, toWhere } from "./filter.ts";
import type { KnowledgeIndex } from "./knowledge-index.ts";
import {
  requirePositive,
  validateHybridWeights,
  validateVectorSize,
  validateVectorValues,
} from "./validate-query.ts";

export type SearchMode = "hybrid" | "keyword" | "semantic";

export const DEFAULT_HYBRID_WEIGHTS: HybridWeights = { text: 0.5, vector: 0.5 };
export const DEFAULT_TITLE_BOOST = 1.1;

const TEXT_PROPERTIES: ("title" | "breadcrumb" | "text")[] = [
  "title",
  "breadcrumb",
  "text",
];

// Cosine similarity is at least -1; this keeps every filtered chunk in the ranking.
const SEMANTIC_SIMILARITY = -1;
// Hybrid divides vector scores by their maximum, so a chunk at 0 similarity must stay out: if all are 0 the ranking turns to NaN.
const HYBRID_SIMILARITY = Number.EPSILON;

interface CandidateQueryBase {
  /** How many chunks to return. */
  k: number;
  filter?: Filter;
  /** Applies to the text modes only. */
  titleBoost?: number;
}

/** Each mode takes exactly the inputs it searches with, so `keyword` never needs a query embedding. */
export type CandidateQuery = CandidateQueryBase &
  (
    | { mode: "keyword"; text: string }
    | { mode: "semantic"; vector: Float32Array }
    | {
        mode: "hybrid";
        text: string;
        vector: Float32Array;
        hybridWeights?: HybridWeights;
      }
  );

export interface Candidate {
  path: string;
  /** The chunk's position within its document. */
  ordinal: number;
  /** The retrieval score; comparable only within one search (ADR-036). */
  score: number;
}

/** First-stage retrieval over the chunk index, best first (ADR-008, ADR-013). */
export async function searchCandidates(
  index: KnowledgeIndex,
  query: CandidateQuery,
): Promise<Candidate[]> {
  if (!Number.isInteger(query.k) || query.k < 1) {
    throw new RangeError(`k must be a positive integer, got ${query.k}`);
  }
  if (query.mode === "hybrid") validateHybridWeights(query.hybridWeights);
  if (query.mode !== "semantic" && query.titleBoost !== undefined) {
    requirePositive("titleBoost", query.titleBoost);
  }
  if (query.mode !== "keyword") validateVectorValues(query.vector);
  // An index over no documents has no model, so it holds nothing to find.
  if (index.model === undefined) return [];
  if (query.mode !== "keyword") {
    validateVectorSize(query.vector, index.model.dims);
  }

  // Orama allocates `limit` slots in vector search, so a huge k must not reach it.
  const bounded = { ...query, k: Math.min(query.k, count(index.orama)) };
  const effective = withoutEmptyText(index, bounded);
  if (effective === undefined) return [];
  const result = await runSearch(index, effective);
  return (
    result.hits
      .map(({ document, score }) => ({
        path: String(document.path),
        ordinal: document.ordinal,
        // Hybrid normalisation yields NaN when a chunk's best score is 0.
        score: Number.isFinite(score) ? score : 0,
      }))
      // Orama sorted before the NaN was replaced, and a NaN breaks its comparator.
      .sort((a, b) => b.score - a.score)
  );
}

// A term with no tokens left after the stopwords (blank, "the", "???") would prefix-match every chunk.
function withoutEmptyText(
  index: KnowledgeIndex,
  query: CandidateQuery,
): CandidateQuery | undefined {
  if (query.mode === "semantic") return query;
  if (
    index.orama.tokenizer.tokenize(query.text, undefined, undefined, false)
      .length > 0
  )
    return query;
  if (query.mode === "keyword") return undefined;
  const { k, filter, vector } = query;
  return { mode: "semantic", k, filter, vector };
}

function runSearch(index: KnowledgeIndex, query: CandidateQuery) {
  const common = { limit: query.k, where: toWhere(query.filter) };
  const fulltext = {
    properties: TEXT_PROPERTIES,
    boost: { title: query.titleBoost ?? DEFAULT_TITLE_BOOST },
  };
  switch (query.mode) {
    case "keyword":
      return search(index.orama, {
        ...common,
        ...fulltext,
        mode: "fulltext",
        term: query.text,
      });
    case "semantic":
      return search(index.orama, {
        ...common,
        mode: "vector",
        vector: { value: query.vector, property: "embedding" },
        similarity: SEMANTIC_SIMILARITY,
      });
    case "hybrid":
      return search(index.orama, {
        ...common,
        ...fulltext,
        mode: "hybrid",
        term: query.text,
        vector: { value: query.vector, property: "embedding" },
        similarity: HYBRID_SIMILARITY,
        hybridWeights: query.hybridWeights ?? DEFAULT_HYBRID_WEIGHTS,
      });
  }
}
