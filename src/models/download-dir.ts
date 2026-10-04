import type { Config } from "../config/config.ts";
import { isSameOrAncestor } from "../config/paths.ts";
import { errorMessage } from "../errors.ts";
import {
  ensureEngineDir,
  ensureModelsDirIgnored,
} from "../sidecars/engine-dir.ts";

export type ModelsConfig = Pick<
  Config,
  "targetDir" | "modelsDir" | "allowRemoteModels"
>;

const inFlight = new Map<string, Promise<void>>();

// Models loading side by side share one run, so they can't race on the same .gitignore.
export function prepareDownloadDir(config: ModelsConfig): Promise<void> {
  const key = `${config.targetDir}\n${config.modelsDir}`;
  let run = inFlight.get(key);
  if (run === undefined) {
    run = prepare(config).finally(() => inFlight.delete(key));
    inFlight.set(key, run);
  }
  return run;
}

// Best effort: the .gitignore is a convenience, so e.g. a read-only mount of pre-fetched weights still loads.
async function prepare(config: ModelsConfig): Promise<void> {
  try {
    if (isSameOrAncestor(config.targetDir, config.modelsDir)) {
      await ensureEngineDir(config.targetDir);
    } else if (
      (await ensureModelsDirIgnored(config.modelsDir)) === "unverified"
    ) {
      process.emitWarning(
        `${config.modelsDir} has its own .gitignore, which was not checked: make sure it keeps the downloaded model weights out of Git.`,
      );
    }
  } catch (error) {
    process.emitWarning(
      `Could not prepare ${config.modelsDir} (${errorMessage(error)}); continuing without setting up its .gitignore.`,
    );
  }
}
