export interface Reranker {
  readonly modelId: string;
  /** Raw relevance logits, one per passage and in the same order; higher is more relevant. */
  rerank(query: string, passages: readonly string[]): Promise<number[]>;
}

export class RerankerError extends Error {
  override readonly name: string = "RerankerError";
}

/** The model itself can't be loaded, so nothing can be reranked. */
export class RerankerUnavailableError extends RerankerError {
  override readonly name = "RerankerUnavailableError";
}
