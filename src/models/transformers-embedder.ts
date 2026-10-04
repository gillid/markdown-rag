import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { type ModelsConfig, prepareDownloadDir } from "./download-dir.ts";
import {
  type Embedder,
  EmbedderError,
  EmbedderUnavailableError,
} from "./embedder.ts";
import { lazyModel, offlineModelMissingMessage } from "./lazy-model.ts";
import { DEFAULT_EMBEDDING_PRESET, type EmbeddingPreset } from "./presets.ts";

const BATCH_SIZE = 32;

export function createTransformersEmbedder(
  config: ModelsConfig,
  preset: EmbeddingPreset = DEFAULT_EMBEDDING_PRESET,
): Embedder {
  const load = lazyModel(
    preset,
    () => loadExtractor(config, preset),
    (error) => error instanceof EmbedderUnavailableError,
    (message, cause) => new EmbedderUnavailableError(message, { cause }),
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
    async embedDocuments(texts) {
      const vectors: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        vectors.push(...(await embedBatch(texts.slice(i, i + BATCH_SIZE))));
      }
      return vectors;
    },
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

async function loadExtractor(
  config: ModelsConfig,
  preset: EmbeddingPreset,
): Promise<FeatureExtractionPipeline> {
  // Offline loading never writes, so read-only mounts keep working.
  if (config.allowRemoteModels) {
    await prepareDownloadDir(config);
  }
  // Imported here so commands that never embed don't load the native onnxruntime binding.
  const { pipeline, ModelFileNotFoundError } = await import(
    "@huggingface/transformers"
  );
  // transformers.js itself still reads HF_TOKEN / HF_ACCESS_TOKEN when it downloads (ADR-032).
  try {
    return await pipeline("feature-extraction", preset.repository, {
      revision: preset.revision,
      dtype: "q8",
      cache_dir: config.modelsDir,
      local_files_only: !config.allowRemoteModels,
    });
  } catch (error) {
    if (!config.allowRemoteModels && error instanceof ModelFileNotFoundError) {
      throw new EmbedderUnavailableError(
        offlineModelMissingMessage(preset, config),
        { cause: error },
      );
    }
    throw error;
  }
}
