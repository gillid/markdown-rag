import type {
  PreTrainedModel,
  PreTrainedTokenizer,
} from "@huggingface/transformers";
import { errorMessage } from "../errors.ts";
import type { ModelsConfig } from "./download-dir.ts";
import { createPairFitter, type PairFitter } from "./fit-pair.ts";
import { inBatches } from "./in-batches.ts";
import { hubModel } from "./model-loader.ts";
import { DEFAULT_RERANKER_PRESET, type RerankerPreset } from "./presets.ts";
import {
  type Reranker,
  RerankerError,
  RerankerUnavailableError,
} from "./reranker.ts";

const BATCH_SIZE = 32;

interface LoadedReranker {
  tokenizer: PreTrainedTokenizer;
  model: PreTrainedModel;
}

export function createTransformersReranker(
  config: ModelsConfig,
  preset: RerankerPreset = DEFAULT_RERANKER_PRESET,
): Reranker {
  const load = hubModel(
    config,
    preset,
    RerankerUnavailableError,
    async (
      {
        AutoTokenizer,
        AutoModelForSequenceClassification,
        ModelFileNotFoundError,
      },
      options,
    ) => {
      // Both settle before a failure is reported, so a retry never overlaps a download still in flight.
      const [tokenizer, model] = await Promise.allSettled([
        AutoTokenizer.from_pretrained(preset.repository, options),
        AutoModelForSequenceClassification.from_pretrained(preset.repository, {
          ...options,
          dtype: "q8",
        }),
      ]);
      if (tokenizer.status === "fulfilled" && model.status === "fulfilled") {
        return { tokenizer: tokenizer.value, model: model.value };
      }
      const failures: unknown[] = [tokenizer, model].flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      // A missing file is the actionable failure, so it wins over any other.
      throw (
        failures.find((reason) => reason instanceof ModelFileNotFoundError) ??
        failures[0]
      );
    },
  );

  const scoreBatch = async (
    { tokenizer, model }: LoadedReranker,
    fitter: PairFitter,
    passages: readonly string[],
  ): Promise<number[]> => {
    const scores = await infer(
      tokenizer,
      model,
      fitter,
      passages,
      preset.maxTokens,
    ).catch((error: unknown) => {
      throw error instanceof RerankerError
        ? error
        : new RerankerError(
            `${preset.id} failed to score ${passages.length} passages: ${errorMessage(error)}`,
            { cause: error },
          );
    });
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
      if (passages.length === 0) {
        return [];
      }
      if (typeof query !== "string" || query.trim() === "") {
        throw new RerankerError(`${preset.id} can't score an empty query.`);
      }
      // An empty passage would be tokenized as no pair and score as the bare query.
      const empty = passages.findIndex(
        (passage) => typeof passage !== "string" || passage.trim() === "",
      );
      if (empty >= 0) {
        throw new RerankerError(
          `${preset.id} can't score an empty passage (passage ${empty}).`,
        );
      }
      const loaded = await load();
      let fitter: PairFitter;
      try {
        fitter = createPairFitter(loaded.tokenizer, query, preset.maxTokens);
      } catch (error) {
        throw new RerankerError(
          `${preset.id} could not fit the query into its window: ${errorMessage(error)}`,
          { cause: error },
        );
      }
      return inBatches(passages, BATCH_SIZE, (batch) =>
        scoreBatch(loaded, fitter, batch),
      );
    },
  };
}

async function infer(
  tokenizer: PreTrainedTokenizer,
  model: PreTrainedModel,
  fitter: PairFitter,
  passages: readonly string[],
  maxTokens: number,
): Promise<unknown> {
  const fitted = passages.map(fitter.fitPassage);
  if (fitted.some((passage) => passage === "")) {
    throw new RerankerError("A passage was cut to nothing to fit the window.");
  }
  const inputs = tokenizer(
    new Array<string>(passages.length).fill(fitter.query),
    {
      text_pair: fitted,
      padding: true,
      truncation: true,
      max_length: maxTokens,
    },
  );
  const { logits } = await model(inputs);
  return logits.data;
}
