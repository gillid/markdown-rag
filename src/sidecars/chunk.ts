import { sha256Hex } from "../contract/hash.ts";

export interface SidecarChunk {
  /** Offsets (UTF-16 code units) into the normalised document body. */
  start: number;
  end: number;
  breadcrumb: string;
  anchor: string;
  hash: string;
  vector: Float32Array;
}

export function hashChunk(breadcrumb: string, text: string): string {
  return sha256Hex(`${breadcrumb}\n${text}`);
}

export function chunkText(
  body: string,
  chunk: Pick<SidecarChunk, "start" | "end">,
): string {
  return body.slice(chunk.start, chunk.end);
}
