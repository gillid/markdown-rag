import { RetrievalOptionError } from "./errors.ts";

export const RECENCY = "recency";
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

/** Each weight is in [0, 1], they sum to at most 0.5, and each names `recency`, the only signal (ADR-034). */
export function validateWeights(weights: SignalWeights): void {
  let total = 0;
  for (const [name, weight] of Object.entries(weights)) {
    if (name !== RECENCY) {
      throw new RetrievalOptionError(
        `weight for "${name}": the only signal is "${RECENCY}"`,
      );
    }
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
      throw new RetrievalOptionError(
        `weight for "${name}" must be in [0, 1], got ${weight}`,
      );
    }
    total += weight;
  }
  if (total > MAX_TOTAL_WEIGHT + WEIGHT_TOLERANCE) {
    throw new RetrievalOptionError(
      `signal weights must sum to at most ${MAX_TOTAL_WEIGHT}, got ${total}`,
    );
  }
}

/** The value of each weighted signal for one document. */
export function signalValues(
  weights: SignalWeights,
  recency: number,
): Record<string, number> {
  return Object.fromEntries(
    Object.keys(weights).map((name) => {
      if (name !== RECENCY) throw new Error(`unknown signal "${name}"`);
      return [name, recency];
    }),
  );
}

export function sigmoid(logit: number): number {
  return 1 / (1 + Math.exp(-logit));
}

/** Retrieval scores are only comparable within one search, so without a reranker the best candidate sets the scale (ADR-036). */
export function normaliseScores(scores: readonly number[]): number[] {
  const top = scores.reduce((max, score) => Math.max(max, score), 0);
  return scores.map((score) => (top > 0 ? Math.max(0, score) / top : 0));
}

/** `(1 − Σwᵢ)·relevance + Σ wᵢ·sᵢ` (ADR-034). */
export function blend(
  relevance: number,
  weights: SignalWeights,
  signals: Readonly<Record<string, number>>,
): number {
  let weightSum = 0;
  let signalSum = 0;
  for (const [name, weight] of Object.entries(weights)) {
    weightSum += weight;
    signalSum += weight * (signals[name] ?? 0);
  }
  return (1 - weightSum) * relevance + signalSum;
}
