import type { ModelsConfig } from "./download-dir.ts";
import {
  type Embedder,
  EmbedderError,
  EmbedderUnavailableError,
} from "./embedder.ts";
import { inBatches } from "./in-batches.ts";
import { hubModel } from "./model-loader.ts";
import { DEFAULT_EMBEDDING_PRESET, type EmbeddingPreset } from "./presets.ts";
import { assertFitsWindow } from "./token-window.ts";

// q8 output shifts slightly with batch padding, so one text per run keeps a stored vector independent of its neighbours (ADR-005, ADR-033).
const DOCUMENT_BATCH_SIZE = 1;

export function createTransformersEmbedder(
  config: ModelsConfig,
  preset: EmbeddingPreset = DEFAULT_EMBEDDING_PRESET,
): Embedder {
  const load = hubModel(
    config,
    preset,
    EmbedderUnavailableError,
    ({ pipeline }, options) =>
      pipeline("feature-extraction", preset.repository, {
        ...options,
        dtype: preset.dtype,
      }),
  );

  const embedBatch = async (texts: string[]): Promise<Float32Array[]> => {
    const extractor = await load();
    const output = await extractor(texts, {
      pooling: "cls",
      normalize: true,
    });
    const data = output.data;
    if (!(data instanceof Float32Array)) {
      throw new EmbedderError(`${preset.id} did not return float32 vectors.`);
    }
    if (data.length !== texts.length * preset.dims) {
      throw new EmbedderError(
        `Expected ${texts.length} vectors of ${preset.dims} dimensions from ${preset.id}, got ${data.length} values.`,
      );
    }
    return texts.map((_, row) =>
      data.slice(row * preset.dims, (row + 1) * preset.dims),
    );
  };

  return {
    modelId: preset.id,
    dims: preset.dims,
    async embedDocuments(texts) {
      // Checked up front, so one over-long text doesn't waste the embedding of those before it.
      assertFitsWindow((await load()).tokenizer, texts, preset, "chunk");
      return inBatches(texts, DOCUMENT_BATCH_SIZE, embedBatch);
    },
    async embedQuery(text) {
      const prefixed = preset.queryPrefix + text;
      assertFitsWindow((await load()).tokenizer, [prefixed], preset, "query");
      const [vector] = await embedBatch([prefixed]);
      if (vector === undefined) {
        throw new EmbedderError(
          `${preset.id} returned no vector for the query.`,
        );
      }
      return vector;
    },
  };
}
