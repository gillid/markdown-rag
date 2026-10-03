export interface Embedder {
  readonly modelId: string;
  readonly dims: number;
  embedDocuments(texts: readonly string[]): Promise<Float32Array[]>;
  embedQuery(text: string): Promise<Float32Array>;
}
