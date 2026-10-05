import { errorMessage } from "../errors.ts";
import { type ModelsConfig, prepareDownloadDir } from "./download-dir.ts";
import type { ModelPreset } from "./presets.ts";

type Transformers = typeof import("@huggingface/transformers");

export type UnavailableErrorClass = new (
  message: string,
  options?: ErrorOptions,
) => Error;

export interface HubOptions {
  revision: string;
  cache_dir: string;
  local_files_only: boolean;
}

/** Loads once on first use; a failed load is retried on the next call. */
export function lazyModel<T>(
  preset: ModelPreset,
  Unavailable: UnavailableErrorClass,
  load: () => Promise<T>,
): () => Promise<T> {
  let loaded: Promise<T> | undefined;
  return () => {
    loaded ??= load().catch((error: unknown) => {
      loaded = undefined;
      throw error instanceof Unavailable
        ? error
        : new Unavailable(
            `Could not load ${preset.id}: ${errorMessage(error)}`,
            { cause: error },
          );
    });
    return loaded;
  };
}

export function hubModel<T>(
  config: ModelsConfig,
  preset: ModelPreset,
  Unavailable: UnavailableErrorClass,
  load: (transformers: Transformers, options: HubOptions) => Promise<T>,
): () => Promise<T> {
  return lazyModel(preset, Unavailable, async () => {
    // Offline loading never writes, so read-only mounts keep working.
    if (config.allowRemoteModels) {
      await prepareDownloadDir(config);
    }
    // transformers.js itself still reads HF_TOKEN / HF_ACCESS_TOKEN when it downloads (ADR-032).
    // Imported here so commands that never load a model don't load the native onnxruntime binding.
    const transformers = await import("@huggingface/transformers");
    try {
      return await load(transformers, {
        revision: preset.revision,
        cache_dir: config.modelsDir,
        local_files_only: !config.allowRemoteModels,
      });
    } catch (error) {
      if (
        !config.allowRemoteModels &&
        error instanceof transformers.ModelFileNotFoundError
      ) {
        throw new Unavailable(
          `Model ${preset.repository}@${preset.revision} is not in ${config.modelsDir} and remote models are disabled. Pre-fetch it into that directory or allow remote models.`,
          { cause: error },
        );
      }
      throw error;
    }
  });
}
