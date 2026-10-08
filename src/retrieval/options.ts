import { SEARCH_MODES, type SearchMode } from "../index/search-mode.ts";
import {
  requirePositive,
  validateHybridWeights,
} from "../index/validate-query.ts";
import { RetrievalOptionError } from "./errors.ts";
import { type SignalWeights, validateWeights } from "./signals.ts";
import {
  DEFAULT_RETRIEVAL,
  MAX_EXPAND,
  MAX_LIMIT,
  MIN_EXPAND,
  MIN_LIMIT,
  type RetrievalDefaults,
} from "./types.ts";

/** An explicit `undefined` keeps the built-in default instead of overwriting it; `weights` merge key by key, as a request's do. */
export function withDefaults(
  overrides: Partial<RetrievalDefaults> = {},
): RetrievalDefaults {
  const defined = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  );
  const merged = { ...DEFAULT_RETRIEVAL, ...defined };
  // Copies, so no retriever shares or can mutate the module's defaults.
  return {
    ...merged,
    weights: mergeWeights(DEFAULT_RETRIEVAL.weights, overrides.weights),
    hybridWeights: { ...merged.hybridWeights },
  };
}

/** Request weights override the configured ones key by key; an `undefined` one keeps the configured weight. */
export function mergeWeights(
  configured: SignalWeights,
  overrides: Partial<SignalWeights> = {},
): SignalWeights {
  const defined = Object.entries(overrides).filter(
    (entry): entry is [string, number] => entry[1] !== undefined,
  );
  return { ...configured, ...Object.fromEntries(defined) };
}

function requireInteger(name: string, value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RetrievalOptionError(
      `${name} must be an integer from ${min} to ${max}, got ${value}`,
    );
  }
}

/** The options a request can override, checked for both the configured defaults and each request. */
export function validateOptions(options: {
  mode: SearchMode;
  limit: number;
  expand: number;
  minScore: number;
}): void {
  if (!SEARCH_MODES.includes(options.mode)) {
    throw new RetrievalOptionError(
      `mode must be one of ${SEARCH_MODES.join(", ")}, got ${options.mode}`,
    );
  }
  requireInteger("limit", options.limit, MIN_LIMIT, MAX_LIMIT);
  requireInteger("expand", options.expand, MIN_EXPAND, MAX_EXPAND);
  if (!Number.isFinite(options.minScore)) {
    throw new RetrievalOptionError(
      `minScore must be finite, got ${options.minScore}`,
    );
  }
}

/** The configured defaults over the built-in ones, checked. Needs no models. */
export function resolveDefaults(
  overrides: Partial<RetrievalDefaults> | undefined,
): RetrievalDefaults {
  const defaults = withDefaults(overrides);
  validateDefaults(defaults);
  return defaults;
}

function validateDefaults(defaults: RetrievalDefaults): void {
  validateWeights(defaults.weights);
  requireInteger("candidates", defaults.candidates, 1, Number.MAX_SAFE_INTEGER);
  validateOptions(defaults);
  requirePositive("halfLifeDays", defaults.halfLifeDays);
  validateHybridWeights(defaults.hybridWeights);
}
