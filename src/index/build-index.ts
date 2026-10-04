import { create, insertMultiple } from "@orama/orama";
import { stopwords as englishStopWords } from "@orama/stopwords/english";
import { formatPathErrors } from "../contract/format-errors.ts";
import type {
  Document,
  DocumentLoadError,
  KnowledgeBase,
} from "../contract/loader.ts";
import { errorMessage } from "../errors.ts";
import { chunkText, hashChunk } from "../sidecars/chunk.ts";
import { checkFreshness, type SidecarEntry } from "../sidecars/freshness.ts";
import {
  type OpenedSidecar,
  type Sidecar,
  SidecarError,
} from "../sidecars/sidecar.ts";
import { type ChunkRecord, toChunkRecord } from "./chunk-record.ts";
import { createChunkSchema } from "./chunk-schema.ts";
import type {
  DocumentSummary,
  IndexedChunk,
  IndexedDocument,
  KnowledgeIndex,
} from "./knowledge-index.ts";
import { buildOutline } from "./outline.ts";
import { computeIndexVersion, type VersionedDocument } from "./version.ts";

// English is fixed for the PoC, as are the models (ADR-010).
const TOKENIZER = { language: "english", stopWords: englishStopWords };

// Orama needs a vector size even when nothing is inserted, as for a knowledge base with no documents.
const EMPTY_INDEX_DIMS = 1;

export class IndexBuildError extends Error {
  override readonly name = "IndexBuildError";

  readonly problems: readonly DocumentLoadError[];

  constructor(problems: readonly DocumentLoadError[]) {
    super(
      `cannot build the index: ${problems.length} problem(s)\n${formatPathErrors(problems)}`,
    );
    this.problems = problems;
  }
}

/** Refuses a knowledge base that breaks the contract or whose sidecars are not all fresh and consistent (ADR-006, ADR-007). */
export async function buildIndex(
  knowledgeBase: KnowledgeBase,
  sidecars: ReadonlyMap<string, SidecarEntry<OpenedSidecar>>,
): Promise<KnowledgeIndex> {
  const freshness = checkFreshness(knowledgeBase, sidecars);
  const problems: DocumentLoadError[] = [...knowledgeBase.errors];
  if (!freshness.ok) {
    throw new IndexBuildError([...problems, ...freshness.problems]);
  }

  const documents = new Map<string, IndexedDocument>();
  const records: ChunkRecord[] = [];
  const versioned: VersionedDocument[] = [];
  for (const { document: doc, entry } of freshness.documents) {
    // Opening only validated the file; decoding the vectors and matching the chunks to the body can still fail.
    try {
      const sidecar = entry.load();
      const indexed = indexDocument(doc, sidecar);
      documents.set(doc.path, indexed.document);
      records.push(...indexed.records);
      versioned.push({
        path: doc.path,
        docHash: doc.docHash,
        chunker: sidecar.chunker,
        model: sidecar.model,
        dims: sidecar.dims,
        chunkHashes: sidecar.chunks.map((chunk) => chunk.hash),
      });
    } catch (cause) {
      if (!(cause instanceof SidecarError)) throw cause;
      problems.push({
        path: doc.path,
        reason: `invalid sidecar: ${errorMessage(cause)}; run md-rag embed`,
      });
    }
  }
  if (problems.length > 0) {
    throw new IndexBuildError(problems);
  }

  const orama = create({
    schema: createChunkSchema(freshness.model?.dims ?? EMPTY_INDEX_DIMS),
    components: { tokenizer: TOKENIZER },
  });
  await insertMultiple(orama, records);

  return {
    version: computeIndexVersion(versioned),
    model: freshness.model,
    orama,
    documents,
  };
}

function indexDocument(
  doc: Document,
  sidecar: Sidecar,
): { document: IndexedDocument; records: ChunkRecord[] } {
  const { path, docHash, tree, body, ...metadata } = doc;
  const summary: DocumentSummary = { ref: path, path, ...metadata };
  const chunks: IndexedChunk[] = [];
  const records: ChunkRecord[] = [];
  sidecar.chunks.forEach((chunk, ordinal) => {
    const text = chunkText(body, chunk);
    // The document hash matched, so a differing chunk means offsets from another normalisation or a damaged file.
    if (hashChunk(chunk.breadcrumb, text) !== chunk.hash) {
      throw new SidecarError(
        `chunk ${ordinal} does not match the document text`,
      );
    }
    const indexed: IndexedChunk = {
      ordinal,
      breadcrumb: chunk.breadcrumb,
      anchor: chunk.anchor,
      text,
    };
    chunks.push(indexed);
    records.push(toChunkRecord(summary, indexed, chunk.vector));
  });
  return {
    document: { summary, outline: buildOutline(tree), chunks },
    records,
  };
}
