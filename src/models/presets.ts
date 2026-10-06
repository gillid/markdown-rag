export interface ModelPreset {
  /** Recorded in sidecars, where it decides freshness: change it whenever the revision, dtype, pooling or query prefix do. */
  id: string;
  repository: string;
  revision: string;
  dtype: "q8";
  /** The model's input window, counting special tokens. */
  maxTokens: number;
}

export interface EmbeddingPreset extends ModelPreset {
  dims: number;
  /** Prepended to queries only, never to documents. */
  queryPrefix: string;
}

export const BGE_SMALL_EN_V1_5: EmbeddingPreset = {
  id: "bge-small-en-v1.5-q8",
  repository: "Xenova/bge-small-en-v1.5",
  revision: "ea104dacec62c0de699686887e3f920caeb4f3e3",
  dtype: "q8",
  maxTokens: 512,
  dims: 384,
  queryPrefix: "Represent this sentence for searching relevant passages: ",
};

export const DEFAULT_EMBEDDING_PRESET = BGE_SMALL_EN_V1_5;

export type RerankerPreset = ModelPreset;

export const MS_MARCO_MINILM_L6_V2: RerankerPreset = {
  id: "ms-marco-MiniLM-L-6-v2",
  repository: "Xenova/ms-marco-MiniLM-L-6-v2",
  revision: "a09144355adeed5f58c8ed011d209bf8ee5a1fec",
  dtype: "q8",
  maxTokens: 512,
};

export const DEFAULT_RERANKER_PRESET = MS_MARCO_MINILM_L6_V2;

const EMBEDDING_PRESETS: readonly EmbeddingPreset[] = [BGE_SMALL_EN_V1_5];

export function findEmbeddingPreset(id: string): EmbeddingPreset | undefined {
  return EMBEDDING_PRESETS.find((preset) => preset.id === id);
}
