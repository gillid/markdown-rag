function isFreezable(value: unknown): value is object {
  return (
    Array.isArray(value) ||
    (value !== null &&
      typeof value === "object" &&
      Object.getPrototypeOf(value) === Object.prototype)
  );
}

/** Freezes arrays and plain objects all the way down; anything else (a Date, say) is left as it is. */
export function deepFreeze<T>(value: T): T {
  // Frozen before descending, so a structure that refers back to itself ends the recursion.
  if (!isFreezable(value) || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}
