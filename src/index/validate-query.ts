import type { HybridWeights } from "@orama/orama";

const SINGLE_SIGNAL_HINT =
  "; use keyword or semantic mode to search with one signal";

export function requirePositive(name: string, value: number, hint = ""): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `${name} must be a positive number, got ${value}${hint}`,
    );
  }
}

// Orama falls back to 0.5/0.5 when either weight is falsy, which would hide a mistaken zero.
export function validateHybridWeights(
  weights: HybridWeights | undefined,
): void {
  if (weights === undefined) return;
  // Untyped input can omit a key, so check both rather than the keys present.
  const names: (keyof HybridWeights)[] = ["text", "vector"];
  for (const name of names) {
    requirePositive(
      `hybrid weight "${name}"`,
      weights[name],
      SINGLE_SIGNAL_HINT,
    );
  }
}

// A failed embedder can hand back zeros or NaN; fail fast instead of looking like "no matches".
export function validateVectorValues(vector: Float32Array): void {
  if (!vector.every(Number.isFinite) || vector.every((v) => v === 0)) {
    throw new RangeError("the query vector must be finite and not all zeros");
  }
}

export function validateVectorSize(vector: Float32Array, dims: number): void {
  if (vector.length !== dims) {
    throw new RangeError(
      `the query vector has ${vector.length} dimensions but the index holds ${dims}`,
    );
  }
}
