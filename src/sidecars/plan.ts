import type { Chunker, ChunkSpan } from "../chunking/chunker.ts";
import type { Document } from "../contract/loader.ts";
import type { Embedder } from "../models/embedder.ts";
import { chunkText, hashChunk } from "./chunk.ts";
import { matchesChunker, matchesDocument, matchesModel } from "./currency.ts";
import { type Sidecar, SidecarError, type SidecarHeader } from "./sidecar.ts";
import { assertChunksCover, verifyChunks } from "./verify-chunks.ts";

export interface PlannedChunk extends ChunkSpan {
  hash: string;
  /** Present when reused from the previous sidecar. */
  vector: Float32Array | undefined;
}

export interface PendingChunk {
  hash: string;
  text: string;
}

export interface SidecarPlan {
  path: string;
  docHash: string;
  chunker: string;
  model: string;
  dims: number;
  chunks: PlannedChunk[];
  /** One entry per distinct chunk that still needs a vector. */
  pending: PendingChunk[];
}

// A sidecar that leaves text uncovered would be rejected by `check` and `serve`, so it is never written.
function assertChunkerCovers(
  doc: Document,
  chunker: Chunker,
  spans: readonly ChunkSpan[],
): void {
  try {
    assertChunksCover(doc.body, spans);
  } catch (cause) {
    if (!(cause instanceof SidecarError)) throw cause;
    throw new Error(`chunker ${chunker.id}: ${cause.message}`, { cause });
  }
}

function chunksMatch(doc: Document, sidecar: Sidecar): boolean {
  try {
    verifyChunks(doc, sidecar);
    return true;
  } catch (cause) {
    if (cause instanceof SidecarError) return false;
    throw cause;
  }
}

/** The sidecar on disk; `load` decodes it in full, and is undefined when its contents are invalid. */
export interface PreviousSidecar {
  header: SidecarHeader;
  load(): Sidecar | undefined;
}

export interface PlanInput {
  doc: Document;
  previous: PreviousSidecar | undefined;
  chunker: Chunker;
  embedder: Pick<Embedder, "modelId" | "dims">;
  rechunk: boolean;
}

/** Returns undefined when the sidecar is already fresh for this document, chunker and model (ADR-006, ADR-032, ADR-039). */
export async function planSidecar(
  input: PlanInput,
): Promise<SidecarPlan | undefined> {
  const { doc, chunker, embedder, rechunk } = input;
  const header = input.previous?.header;
  const sameModel = header !== undefined && matchesModel(header, embedder);
  const sameChunker =
    header !== undefined && matchesChunker(header, chunker.id);
  const sameDocument =
    header !== undefined && matchesDocument(header, doc.docHash);

  // A header-fresh sidecar whose contents are damaged is rebuilt, never trusted.
  const loaded = input.previous?.load();
  const previous =
    sameDocument && loaded && !chunksMatch(doc, loaded) ? undefined : loaded;

  if (previous && sameModel && sameChunker && sameDocument && !rechunk) {
    return undefined;
  }

  // A model change alone re-embeds the recorded chunks; a chunker change re-chunks (ADR-039).
  const keepRecordedChunks =
    previous !== undefined && sameDocument && sameChunker && !rechunk;
  const spans = keepRecordedChunks ? previous.chunks : await chunker.chunk(doc);
  if (!keepRecordedChunks) assertChunkerCovers(doc, chunker, spans);

  // Vectors from another model are never reusable.
  const reusable = new Map<string, Float32Array>();
  if (previous && sameModel) {
    for (const chunk of previous.chunks) {
      reusable.set(chunk.hash, chunk.vector);
    }
  }

  const pending = new Map<string, PendingChunk>();
  const chunks = spans.map((span): PlannedChunk => {
    const text = chunkText(doc.body, span);
    const hash = hashChunk(span.breadcrumb, text);
    const vector = reusable.get(hash);
    if (vector === undefined && !pending.has(hash)) {
      pending.set(hash, { hash, text });
    }
    return {
      start: span.start,
      end: span.end,
      breadcrumb: span.breadcrumb,
      anchor: span.anchor,
      hash,
      vector,
    };
  });

  return {
    path: doc.path,
    docHash: doc.docHash,
    chunker: chunker.id,
    model: embedder.modelId,
    dims: embedder.dims,
    chunks,
    pending: [...pending.values()],
  };
}

/** `vectors` are the embeddings of `plan.pending`, in order. */
export function completeSidecar(
  plan: SidecarPlan,
  vectors: readonly Float32Array[],
): Sidecar {
  const embedded = new Map(
    plan.pending.map((chunk, i) => [chunk.hash, vectors[i]]),
  );
  return {
    docHash: plan.docHash,
    chunker: plan.chunker,
    model: plan.model,
    dims: plan.dims,
    chunks: plan.chunks.map((chunk) => {
      const vector = chunk.vector ?? embedded.get(chunk.hash);
      if (vector === undefined) {
        throw new Error(`no vector for the chunk at ${chunk.start}`);
      }
      return {
        start: chunk.start,
        end: chunk.end,
        breadcrumb: chunk.breadcrumb,
        anchor: chunk.anchor,
        hash: chunk.hash,
        vector,
      };
    }),
  };
}
