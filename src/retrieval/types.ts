import type { HybridWeights } from "@orama/orama";
import type { Filter } from "../index/filter.ts";
import type {
  DocumentSummary,
  KnowledgeIndex,
} from "../index/knowledge-index.ts";
import { DEFAULT_HYBRID_WEIGHTS } from "../index/search-candidates.ts";
import type { SearchMode } from "../index/search-mode.ts";
import type { Embedder } from "../models/embedder.ts";
import type { Reranker } from "../models/reranker.ts";
import {
  DEFAULT_RECENCY_WEIGHT,
  RECENCY,
  type SignalWeights,
} from "./signals.ts";

export const MIN_LIMIT = 1;
export const MAX_LIMIT = 10;
export const MIN_EXPAND = 0;
export const MAX_EXPAND = 2;
export const MAX_CHUNKS_PER_DOCUMENT = 2;

export interface RetrievalDefaults {
  mode: SearchMode;
  /** K: how many first-stage candidates are taken. */
  candidates: number;
  limit: number;
  minScore: number;
  expand: number;
  weights: SignalWeights;
  halfLifeDays: number;
  hybridWeights: HybridWeights;
  rerank: boolean;
}

export const DEFAULT_RETRIEVAL: RetrievalDefaults = {
  mode: "hybrid",
  candidates: 30,
  limit: 3,
  minScore: 0,
  expand: 0,
  weights: { [RECENCY]: DEFAULT_RECENCY_WEIGHT },
  halfLifeDays: 90,
  hybridWeights: DEFAULT_HYBRID_WEIGHTS,
  rerank: true,
};

export interface RetrieveRequest {
  query: string;
  filter?: Filter;
  mode?: SearchMode;
  limit?: number;
  /** A cutoff on `relevance`, never on `final`; without a reranker that is relative to the best candidate, so the top hit always has 1. */
  minScore?: number;
  /** Merged over the configured weights, key by key. */
  weights?: SignalWeights;
  expand?: number;
}

/** How a result was scored, stage by stage (ADR-036). */
export interface ResultScores {
  retrieval: number;
  /** The raw cross-encoder logit; null when reranking is off or the chunk could not be reranked. */
  rerank: number | null;
  relevance: number;
  signals: Record<string, number>;
  final: number;
}

export interface RetrievalResult {
  summary: DocumentSummary;
  /** `<path>#<anchor>` of the best chunk, or the path alone when that chunk has no anchor. */
  ref: string;
  breadcrumb: string;
  anchor: string;
  /** The covered chunks, joined. */
  text: string;
  /** First and last chunk ordinal covered, expansion included. */
  chunks: { from: number; to: number };
  scores: ResultScores;
}

export interface RetrievalTimings {
  embedMs: number;
  searchMs: number;
  rerankMs: number;
  totalMs: number;
}

export interface RetrievalResponse {
  results: RetrievalResult[];
  timings: RetrievalTimings;
}

export interface RetrieverDeps {
  index: KnowledgeIndex;
  embedder: Embedder;
  /** Required unless `defaults.rerank` is off. */
  reranker?: Reranker;
  defaults?: Partial<RetrievalDefaults>;
  /** Epoch milliseconds; injectable so recency is testable. */
  now?: () => number;
}
