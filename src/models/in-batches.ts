export async function inBatches<T, R>(
  items: readonly T[],
  size: number,
  run: (batch: T[]) => Promise<R[]>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await run(items.slice(i, i + size))));
  }
  return results;
}
