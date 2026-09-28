import { createHash } from "node:crypto";

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export function hashDocument(normalized: string): string {
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}
