import { createHash } from "node:crypto";

// Spelled as a code unit because a literal U+FEFF is invisible and survives no formatter reliably.
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/** What is hashed and parsed: a leading byte order mark (Windows editors write one) is not content, so it is dropped before frontmatter detection and hashing. */
export function normalizeText(raw: string): string {
  const withoutMark = raw.startsWith(BYTE_ORDER_MARK) ? raw.slice(1) : raw;
  return normalizeLineEndings(withoutMark);
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function hashDocument(normalized: string): string {
  return sha256Hex(normalized);
}
