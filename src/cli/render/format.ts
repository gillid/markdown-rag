export function formatDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

export function formatScore(score: number): string {
  return score.toFixed(3);
}
