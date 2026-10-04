import type { Orama } from "@orama/orama";

type VectorField = `vector[${number}]`;

// Identifiers and filter values are enums so they are matched whole and never tokenised for BM25.
export function createChunkSchema(dims: number) {
  const embedding: VectorField = `vector[${dims}]`;
  return {
    path: "enum",
    ordinal: "number",
    title: "string",
    breadcrumb: "string",
    text: "string",
    source: "enum",
    tags: "enum[]",
    dirs: "enum[]",
    updated_at: "number",
    url: "enum",
    anchor: "enum",
    embedding,
  } as const;
}

export type ChunkSchema = ReturnType<typeof createChunkSchema>;
export type ChunkIndex = Orama<ChunkSchema>;
