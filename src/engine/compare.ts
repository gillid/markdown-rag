/** Code-unit order, so a listing doesn't depend on the host's locale. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
