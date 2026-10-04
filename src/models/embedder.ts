export interface Embedder {
  readonly modelId: string;
  readonly dims: number;
  embedDocuments(texts: readonly string[]): Promise<Float32Array[]>;
  embedQuery(text: string): Promise<Float32Array>;
}

export class EmbedderError extends Error {
  override readonly name: string = "EmbedderError";
}

/** The model itself can't be loaded, so no document can be embedded and retrying is pointless. */
export class EmbedderUnavailableError extends EmbedderError {
  override readonly name = "EmbedderUnavailableError";
}
