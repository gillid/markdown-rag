import type { PartialSchemaDeep, TypedDocument } from "@orama/orama";
import type { ChunkIndex } from "./chunk-schema.ts";
import type { DocumentSummary, IndexedChunk } from "./knowledge-index.ts";

export type ChunkRecord = PartialSchemaDeep<TypedDocument<ChunkIndex>>;

/** Every ancestor directory of a document path, outermost first: `a/b/c.md` gives `a` and `a/b`. */
export function ancestorDirs(path: string): string[] {
  const segments = path.split("/").slice(0, -1);
  return segments.map((_, i) => segments.slice(0, i + 1).join("/"));
}

export function toChunkRecord(
  summary: DocumentSummary,
  chunk: IndexedChunk,
  vector: Float32Array,
): ChunkRecord {
  return {
    path: summary.path,
    ordinal: chunk.ordinal,
    title: summary.title,
    breadcrumb: chunk.breadcrumb,
    text: chunk.text,
    source: summary.source,
    tags: summary.tags,
    dirs: ancestorDirs(summary.path),
    updated_at: summary.updatedAt,
    ...(summary.url !== undefined && { url: summary.url }),
    anchor: chunk.anchor,
    embedding: Array.from(vector),
  };
}
