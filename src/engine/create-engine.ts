import type { ConfigInput } from "../config/config.ts";
import { type EngineOptions, engineOptionsSchema } from "./engine-options.ts";
import { parseRequest } from "./errors.ts";
import { type Engine, startEngine } from "./start-engine.ts";

/**
 * The basic layer that every interface composes on (ADR-014, ADR-035).
 * Resolves once the storage is validated and, unless `loadModels` is false, the models are loaded and warmed up;
 * rejects, whatever the cause, if the engine can't serve (ADR-040).
 */
export async function createEngine(
  input: ConfigInput,
  options: EngineOptions = {},
): Promise<Engine> {
  const { loadModels } = parseRequest(
    engineOptionsSchema,
    options,
    "createEngine options",
  );
  return startEngine(input, { loadModels });
}
