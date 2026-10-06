import type {
  IndexedDocument,
  KnowledgeIndex,
} from "../index/knowledge-index.ts";
import { DocumentNotFoundError } from "./errors.ts";
import type { DocumentOutput, GetDocumentOptions } from "./schemas/document.ts";
import { toSummaryOutput } from "./summary-output.ts";

interface Target {
  document: IndexedDocument;
  /** Undefined for the whole document. */
  anchor?: string;
}

function resolveRef(index: KnowledgeIndex, ref: string): Target {
  // A path is tried whole first, so a file name containing `#` still resolves.
  const whole = index.documents.get(ref);
  if (whole !== undefined) return { document: whole };

  const hash = ref.lastIndexOf("#");
  const path = hash === -1 ? ref : ref.slice(0, hash);
  const document = index.documents.get(path);
  if (document === undefined) {
    throw new DocumentNotFoundError(`no document at "${path}"`);
  }
  const anchor = ref.slice(hash + 1);
  if (!document.sections.has(anchor)) {
    throw new DocumentNotFoundError(
      `"${path}" has no section "${anchor}"; its outline lists the anchors`,
    );
  }
  return { document, anchor };
}

/** Resolves only indexed paths, so a ref can never reach a file outside the knowledge base (ADR-035). */
export function getDocumentOf(
  index: KnowledgeIndex,
  ref: string,
  options: GetDocumentOptions,
): DocumentOutput {
  const { document, anchor } = resolveRef(index, ref);
  const summary = {
    ...toSummaryOutput(document.summary, ref),
    outline: document.outline,
  };
  if (options.body === false) return summary;

  const section =
    anchor === undefined ? undefined : document.sections.get(anchor);
  return {
    ...summary,
    // Trimmed alike, so a section is exactly the text of the same range in the whole body.
    body: (section === undefined
      ? document.body
      : document.body.slice(section.start, section.end)
    ).trim(),
  };
}
