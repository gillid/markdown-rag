import { RetrievalOptionError } from "./errors.ts";

export const RECENCY = "recency";
export const DEFAULT_RECENCY_WEIGHT = 0.15;
const TAGS = "tags";
const TAG_PREFIX = "tag:";
export const MAX_TOTAL_WEIGHT = 0.5;
// 0.1 + 0.2 + 0.2 sums to 0.5000000000000001, which is still the limit.
const WEIGHT_TOLERANCE = 1e-9;

const MS_PER_DAY = 86_400_000;

export type SignalWeights = Readonly<Record<string, number>>;

/** `0.5^(age/half_life)`; a document dated in the future counts as brand new (ADR-034). */
export function recencyScore(
  updatedAt: number,
  now: number,
  halfLifeDays: number,
): number {
  const ageDays = Math.max(0, now - updatedAt) / MS_PER_DAY;
  return 0.5 ** (ageDays / halfLifeDays);
}

function tagOf(name: string): string | undefined {
  return name.startsWith(TAG_PREFIX)
    ? name.slice(TAG_PREFIX.length)
    : undefined;
}

function tagWeights(weights: SignalWeights): [tag: string, weight: number][] {
  return Object.entries(weights).flatMap(([name, weight]) => {
    const tag = tagOf(name);
    return tag === undefined ? [] : [[tag, weight]];
  });
}

/** The weight of the `tags` signal: the largest tag weight by magnitude, so a document moves by at most this much (ADR-045). */
function tagsSignalWeight(weights: SignalWeights): number {
  return Math.max(0, ...tagWeights(weights).map(([, w]) => Math.abs(w)));
}

/**
 * Names `recency` (in [0, 1]) or `tag:<name>` (in [-1, 1], a tag some document carries when `knownTags` is given).
 * The recency weight plus the largest tag weight by magnitude is at most 0.5 (ADR-034, ADR-045).
 */
export function validateWeights(
  weights: SignalWeights,
  knownTags?: ReadonlySet<string>,
): void {
  for (const [name, weight] of Object.entries(weights)) {
    const tag = tagOf(name);
    if (name !== RECENCY && (tag === undefined || tag === "")) {
      throw new RetrievalOptionError(
        `weight for "${name}": the signals are "${RECENCY}" and "${TAG_PREFIX}<tag>"`,
      );
    }
    const min = tag === undefined ? 0 : -1;
    if (!Number.isFinite(weight) || weight < min || weight > 1) {
      throw new RetrievalOptionError(
        `weight for "${name}" must be in [${min}, 1], got ${weight}`,
      );
    }
    if (tag !== undefined && knownTags !== undefined && !knownTags.has(tag)) {
      throw new RetrievalOptionError(
        `weight for "${name}": no document has the tag "${tag}"`,
      );
    }
  }
  const recency = weights[RECENCY] ?? 0;
  const largestTag = tagsSignalWeight(weights);
  const total = recency + largestTag;
  if (total > MAX_TOTAL_WEIGHT + WEIGHT_TOLERANCE) {
    const defaultHint =
      largestTag > 0 && recency === DEFAULT_RECENCY_WEIGHT
        ? " (the default; set recency to lower it)"
        : "";
    throw new RetrievalOptionError(
      `signal weights must sum to at most ${MAX_TOTAL_WEIGHT}, got ${total}: the recency weight ${recency}${defaultHint} plus the largest tag weight by magnitude ${largestTag}`,
    );
  }
}

/** The matching tag weight of the largest magnitude, the lower one on a tie so a penalty wins; 0 for no match. */
function appliedTagWeight(weights: SignalWeights, tags: readonly string[]) {
  return tagWeights(weights)
    .filter(([tag]) => tags.includes(tag))
    .map(([, weight]) => weight)
    .reduce(
      (best, weight) =>
        Math.abs(weight) > Math.abs(best) ||
        (Math.abs(weight) === Math.abs(best) && weight < best)
          ? weight
          : best,
      0,
    );
}

/** The value of each weighted signal for one document: `recency`, and `tags` in [-1, 1] when any tag has a weight. */
export function signalValues(
  weights: SignalWeights,
  recency: number,
  tags: readonly string[],
): Record<string, number> {
  const values: Record<string, number> = {};
  if (RECENCY in weights) values[RECENCY] = recency;
  const scale = tagsSignalWeight(weights);
  if (tagWeights(weights).length > 0) {
    values[TAGS] = scale === 0 ? 0 : appliedTagWeight(weights, tags) / scale;
  }
  return values;
}

export function sigmoid(logit: number): number {
  return 1 / (1 + Math.exp(-logit));
}

/** Retrieval scores are only comparable within one search, so without a reranker the best candidate sets the scale (ADR-036). */
export function normaliseScores(scores: readonly number[]): number[] {
  const top = scores.reduce((max, score) => Math.max(max, score), 0);
  return scores.map((score) => (top > 0 ? Math.max(0, score) / top : 0));
}

/** `(1 − Σwᵢ)·relevance + Σ wᵢ·sᵢ` over `recency` and `tags`, where the `tags` weight is the largest tag weight by magnitude (ADR-034, ADR-045). */
export function blend(
  relevance: number,
  weights: SignalWeights,
  signals: Readonly<Record<string, number>>,
): number {
  const recencyWeight = weights[RECENCY] ?? 0;
  const tagsWeight = tagsSignalWeight(weights);
  const signalSum =
    recencyWeight * (signals[RECENCY] ?? 0) + tagsWeight * (signals[TAGS] ?? 0);
  return (1 - recencyWeight - tagsWeight) * relevance + signalSum;
}
