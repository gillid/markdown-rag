import type { Document } from "../contract/loader.ts";
import type { SidecarChunk } from "../sidecars/chunk.ts";

/** Offsets are UTF-16 code units into the normalised document body. */
export type ChunkSpan = Pick<
  SidecarChunk,
  "start" | "end" | "breadcrumb" | "anchor"
>;

export type ChunkerInput = Pick<Document, "title" | "body" | "tree">;

export interface Chunker {
  /** Recorded in the sidecar and compared by `embed`, so it must change whenever the output could (ADR-011, ADR-039). */
  readonly id: string;
  chunk(doc: ChunkerInput): Promise<ChunkSpan[]>;
}
