import type { ModelsConfig } from "./download-dir.ts";
import {
  type Embedder,
  EmbedderError,
  EmbedderUnavailableError,
} from "./embedder.ts";
import { inBatches } from "./in-batches.ts";
import { hubModel } from "./model-loader.ts";
import { DEFAULT_EMBEDDING_PRESET, type EmbeddingPreset } from "./presets.ts";

const BATCH_SIZE = 32;

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
        dtype: "q8",
      }),
  );

  const embedBatch = async (texts: string[]): Promise<Float32Array[]> => {
    const output = await (await load())(texts, {
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
    embedDocuments: (texts) => inBatches(texts, BATCH_SIZE, embedBatch),
    async embedQuery(text) {
      const [vector] = await embedBatch([preset.queryPrefix + text]);
      if (vector === undefined) {
        throw new EmbedderError(
          `${preset.id} returned no vector for the query.`,
        );
      }
      return vector;
    },
  };
}
