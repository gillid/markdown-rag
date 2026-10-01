import { createHash } from "node:crypto";

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function hashDocument(normalized: string): string {
  return sha256Hex(normalized);
}
