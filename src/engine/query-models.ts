import type { Config } from "../config/config.ts";
import type { KnowledgeIndex } from "../index/knowledge-index.ts";
import type { Embedder } from "../models/embedder.ts";
import {
  DEFAULT_EMBEDDING_PRESET,
  findEmbeddingPreset,
} from "../models/presets.ts";
import type { Reranker } from "../models/reranker.ts";
import { createTransformersEmbedder } from "../models/transformers-embedder.ts";
import { createTransformersReranker } from "../models/transformers-reranker.ts";

/** The embedder is the one the sidecars were built with, never a configured one (ADR-032). */
export function embedderFor(config: Config, index: KnowledgeIndex): Embedder {
  // With no documents there are no sidecars to name a model, and nothing to match.
  if (index.model === undefined) {
    return createTransformersEmbedder(config, DEFAULT_EMBEDDING_PRESET);
  }
  const preset = findEmbeddingPreset(index.model.modelId);
  if (preset === undefined) {
    throw new Error(
      `the sidecars were built with the unknown embedding model "${index.model.modelId}"; run md-rag embed with this version`,
    );
  }
  return createTransformersEmbedder(config, preset);
}

const WARM_UP_TEXT = "warm-up";

/** One throwaway query through each model: it loads them and runs the first, slow inference before any caller waits on it. */
export async function warmUp(
  embedder: Embedder,
  reranker: Reranker | undefined,
): Promise<void> {
  // Both settle before a failure is reported, so no inference is left running unobserved after startup has failed.
  const outcomes = await Promise.allSettled([
    embedder.embedQuery(WARM_UP_TEXT),
    reranker?.rerank(WARM_UP_TEXT, [WARM_UP_TEXT]),
  ]);
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") throw outcome.reason;
  }
}

export function rerankerFor(
  config: Config,
  rerank: boolean,
): Reranker | undefined {
  return rerank ? createTransformersReranker(config) : undefined;
}
