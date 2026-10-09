import type { Document, DocumentLoadError } from "../contract/loader.ts";
import { errorMessage } from "../errors.ts";
import { chunkText, hashChunk } from "./chunk.ts";
import { type OpenedSidecar, type Sidecar, SidecarError } from "./sidecar.ts";

/** Decodes every vector and matches every chunk to its document, the checks `serve` makes when it builds the index, so `check` can't pass what `serve` rejects. */
export function verifySidecars(
  pairs: readonly { document: Document; entry: OpenedSidecar }[],
): DocumentLoadError[] {
  const problems: DocumentLoadError[] = [];
  for (const { document, entry } of pairs) {
    try {
      verifyChunks(document, entry.load());
    } catch (cause) {
      if (!(cause instanceof SidecarError)) throw cause;
      problems.push({
        path: document.path,
        reason: `invalid sidecar: ${errorMessage(cause)}; run markdown-rag embed`,
      });
    }
  }
  return problems;
}

/** Throws when chunks don't hash to the text at their offsets or leave text uncovered; the document hash matched, so that means a damaged or hand-edited file. */
export function verifyChunks(
  doc: Pick<Document, "body">,
  sidecar: Pick<Sidecar, "chunks">,
): void {
  assertChunksCover(doc.body, sidecar.chunks);
  sidecar.chunks.forEach((chunk, ordinal) => {
    if (
      hashChunk(chunk.breadcrumb, chunkText(doc.body, chunk)) !== chunk.hash
    ) {
      throw new SidecarError(
        `chunk ${ordinal} does not match the document text`,
      );
    }
  });
}

/** Throws when ranges (ordered, as chunks are) run past the body or leave any text of it uncovered, bar whitespace between them. */
export function assertChunksCover(
  body: string,
  ranges: readonly { start: number; end: number }[],
): void {
  let covered = 0;
  ranges.forEach((range, ordinal) => {
    if (range.end > body.length) {
      throw new SidecarError(
        `chunk ${ordinal} ends at ${range.end}, past the end of the document (${body.length})`,
      );
    }
    assertUncoveredIsBlank(body, covered, range.start);
    covered = range.end;
  });
  assertUncoveredIsBlank(body, covered, body.length);
}

function assertUncoveredIsBlank(body: string, from: number, to: number): void {
  if (body.slice(from, to).trim() !== "") {
    throw new SidecarError(
      `the document text between offsets ${from} and ${to} is in no chunk`,
    );
  }
}
