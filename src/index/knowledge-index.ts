import type { HeadingRef } from "../chunking/blocks.ts";
import type { DocumentMetadata } from "../contract/document.ts";
import type { Embedder } from "../models/embedder.ts";
import type { ChunkIndex } from "./chunk-schema.ts";

/** The fields every operation shares for a document (ADR-035); `ref` is its path for a whole document. */
export interface DocumentSummary extends DocumentMetadata {
  ref: string;
  path: string;
}

export interface IndexedChunk {
  /** Position within the document. */
  ordinal: number;
  breadcrumb: string;
  anchor: string;
  text: string;
}

export interface IndexedDocument {
  summary: DocumentSummary;
  outline: HeadingRef[];
  /** In document order. */
  chunks: IndexedChunk[];
}

export interface KnowledgeIndex {
  /** Changes whenever the indexed content does, including a sidecar rebuilt with another chunker or model. */
  version: string;
  /** Undefined only for a knowledge base with no documents, which has no sidecars to name one. */
  model: Pick<Embedder, "modelId" | "dims"> | undefined;
  orama: ChunkIndex;
  /** Keyed by document path. */
  documents: ReadonlyMap<string, IndexedDocument>;
}
