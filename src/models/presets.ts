export interface EmbeddingPreset {
  /** The value recorded in sidecars. */
  id: string;
  repository: string;
  revision: string;
  dims: number;
  /** Prepended to queries only, never to documents. */
  queryPrefix: string;
}

export const BGE_SMALL_EN_V1_5: EmbeddingPreset = {
  id: "bge-small-en-v1.5",
  repository: "Xenova/bge-small-en-v1.5",
  revision: "ea104dacec62c0de699686887e3f920caeb4f3e3",
  dims: 384,
  queryPrefix: "Represent this sentence for searching relevant passages: ",
};

export const DEFAULT_EMBEDDING_PRESET = BGE_SMALL_EN_V1_5;

const EMBEDDING_PRESETS: readonly EmbeddingPreset[] = [BGE_SMALL_EN_V1_5];

export function findEmbeddingPreset(id: string): EmbeddingPreset | undefined {
  return EMBEDDING_PRESETS.find((preset) => preset.id === id);
}
