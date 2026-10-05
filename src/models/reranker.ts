export interface Reranker {
  readonly modelId: string;
  /** Raw relevance logits, one per passage and in the same order; higher is more relevant. A passage with no token the model can score gets null rather than failing the rest. */
  rerank(
    query: string,
    passages: readonly string[],
  ): Promise<(number | null)[]>;
}

export class RerankerError extends Error {
  override readonly name: string = "RerankerError";
}

/** The model itself can't be loaded, so nothing can be reranked. */
export class RerankerUnavailableError extends RerankerError {
  override readonly name = "RerankerUnavailableError";
}
