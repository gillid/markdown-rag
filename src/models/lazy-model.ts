import { errorMessage } from "../errors.ts";
import type { ModelsConfig } from "./download-dir.ts";

interface ModelPreset {
  id: string;
  repository: string;
  revision: string;
}

/** Loads once on first use; a failed load is retried on the next call. */
export function lazyModel<T>(
  preset: ModelPreset,
  load: () => Promise<T>,
  isUnavailable: (error: unknown) => boolean,
  unavailable: (message: string, cause: unknown) => Error,
): () => Promise<T> {
  let loaded: Promise<T> | undefined;
  return () => {
    loaded ??= load().catch((error: unknown) => {
      loaded = undefined;
      throw isUnavailable(error)
        ? error
        : unavailable(
            `Could not load ${preset.id}: ${errorMessage(error)}`,
            error,
          );
    });
    return loaded;
  };
}

export function offlineModelMissingMessage(
  preset: ModelPreset,
  config: ModelsConfig,
): string {
  return `Model ${preset.repository}@${preset.revision} is not in ${config.modelsDir} and remote models are disabled. Pre-fetch it into that directory or allow remote models.`;
}
