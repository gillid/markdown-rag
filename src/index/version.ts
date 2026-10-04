import { sha256Hex } from "../contract/hash.ts";
import type { Document } from "../contract/loader.ts";
import type { Sidecar } from "../sidecars/sidecar.ts";

export type VersionedDocument = Pick<Document, "path" | "docHash"> &
  Pick<Sidecar, "chunker" | "model" | "dims"> & {
    chunkHashes: readonly string[];
  };

/** Covers the sidecars as well as the documents, so a re-chunk or a model change is a new version. */
export function computeIndexVersion(
  documents: readonly VersionedDocument[],
): string {
  const sorted = [...documents].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  return sha256Hex(
    JSON.stringify(
      sorted.map((doc) => [
        doc.path,
        doc.docHash,
        doc.chunker,
        doc.model,
        doc.dims,
        doc.chunkHashes,
      ]),
    ),
  );
}
