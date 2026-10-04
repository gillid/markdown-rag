import type {
  PreTrainedModel,
  PreTrainedTokenizer,
} from "@huggingface/transformers";
import { errorMessage } from "../errors.ts";
import { type ModelsConfig, prepareDownloadDir } from "./download-dir.ts";
import { fitPair } from "./fit-pair.ts";
import { lazyModel, offlineModelMissingMessage } from "./lazy-model.ts";
import { DEFAULT_RERANKER_PRESET, type RerankerPreset } from "./presets.ts";
import {
  type Reranker,
  RerankerError,
  RerankerUnavailableError,
} from "./reranker.ts";

const MAX_TOKENS = 512;
const BATCH_SIZE = 32;

interface LoadedReranker {
  tokenizer: PreTrainedTokenizer;
  model: PreTrainedModel;
}

export function createTransformersReranker(
  config: ModelsConfig,
  preset: RerankerPreset = DEFAULT_RERANKER_PRESET,
): Reranker {
  const load = lazyModel(
    preset,
    () => loadReranker(config, preset),
    (error) => error instanceof RerankerUnavailableError,
    (message, cause) => new RerankerUnavailableError(message, { cause }),
  );

  const scoreBatch = async (
    query: string,
    passages: readonly string[],
  ): Promise<number[]> => {
    const { tokenizer, model } = await load();
    const scores = await infer(tokenizer, model, query, passages).catch(
      (error: unknown) => {
        throw error instanceof RerankerError
          ? error
          : new RerankerError(
              `${preset.id} failed to score ${passages.length} passages: ${errorMessage(error)}`,
              { cause: error },
            );
      },
    );
    if (!(scores instanceof Float32Array)) {
      throw new RerankerError(`${preset.id} did not return float32 scores.`);
    }
    if (scores.length !== passages.length) {
      throw new RerankerError(
        `Expected ${passages.length} scores from ${preset.id}, got ${scores.length} values.`,
      );
    }
    if (!scores.every(Number.isFinite)) {
      throw new RerankerError(`${preset.id} returned a non-finite score.`);
    }
    return Array.from(scores);
  };

  return {
    modelId: preset.id,
    async rerank(query, passages) {
      const scores: number[] = [];
      for (let i = 0; i < passages.length; i += BATCH_SIZE) {
        scores.push(
          ...(await scoreBatch(query, passages.slice(i, i + BATCH_SIZE))),
        );
      }
      return scores;
    },
  };
}

async function infer(
  tokenizer: PreTrainedTokenizer,
  model: PreTrainedModel,
  query: string,
  passages: readonly string[],
): Promise<unknown> {
  const fitted = fitPair(tokenizer, query, passages, MAX_TOKENS);
  const inputs = tokenizer(
    new Array<string>(passages.length).fill(fitted.query),
    {
      text_pair: fitted.passages,
      padding: true,
      truncation: true,
      max_length: MAX_TOKENS,
    },
  );
  const { logits } = await model(inputs);
  return logits.data;
}

async function loadReranker(
  config: ModelsConfig,
  preset: RerankerPreset,
): Promise<LoadedReranker> {
  // Offline loading never writes, so read-only mounts keep working.
  if (config.allowRemoteModels) {
    await prepareDownloadDir(config);
  }
  // Imported here so commands that never rerank don't load the native onnxruntime binding.
  const {
    AutoTokenizer,
    AutoModelForSequenceClassification,
    ModelFileNotFoundError,
  } = await import("@huggingface/transformers");
  const options = {
    revision: preset.revision,
    cache_dir: config.modelsDir,
    local_files_only: !config.allowRemoteModels,
  };
  try {
    const [tokenizer, model] = await Promise.all([
      AutoTokenizer.from_pretrained(preset.repository, options),
      AutoModelForSequenceClassification.from_pretrained(preset.repository, {
        ...options,
        dtype: "q8",
      }),
    ]);
    return { tokenizer, model };
  } catch (error) {
    if (!config.allowRemoteModels && error instanceof ModelFileNotFoundError) {
      throw new RerankerUnavailableError(
        offlineModelMissingMessage(preset, config),
        { cause: error },
      );
    }
    throw error;
  }
}
