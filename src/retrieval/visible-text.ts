// Whitespace, separators and invisible characters such as zero-width spaces, which `trim` leaves.
const NO_VISIBLE_TEXT = /^[\s\p{Z}\p{C}]*$/u;

export function hasNoVisibleText(text: string): boolean {
  return NO_VISIBLE_TEXT.test(text);
}
