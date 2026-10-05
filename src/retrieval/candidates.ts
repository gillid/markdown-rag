import type { Candidate } from "../index/search-candidates.ts";

/** Keeps each document's best `max` candidates, preserving the best-first order (ADR-013). */
export function capPerDocument(
  candidates: readonly Candidate[],
  max: number,
): Candidate[] {
  const seen = new Map<string, number>();
  return candidates.filter(({ path }) => {
    const count = (seen.get(path) ?? 0) + 1;
    seen.set(path, count);
    return count <= max;
  });
}
