import type {
  Document,
  DocumentLoadError,
  KnowledgeBase,
} from "../contract/loader.ts";
import type { Embedder } from "../models/embedder.ts";
import { findEmbeddingPreset } from "../models/presets.ts";
import { matchesDocument, matchesModel } from "./currency.ts";
import { knownDocumentPaths } from "./known-paths.ts";
import type { SidecarHeader } from "./sidecar.ts";

interface WithHeader {
  header: SidecarHeader;
}

/** What was found for one document's sidecar: its header (plus whatever else `E` adds), or why it could not be used. */
export type SidecarEntry<E extends WithHeader = WithHeader> =
  | E
  | { failure: SidecarFailure; message: string };

export type SidecarFailure = "invalid" | "unreadable" | "rejected";

type EmbeddingModel = Pick<Embedder, "modelId" | "dims">;

interface DocumentEntry<E extends WithHeader> {
  document: Document;
  entry: E;
}

/** `model` is undefined only when no document has a current sidecar; `documents` pairs each document with its entry. */
export type FreshnessResult<E extends WithHeader = WithHeader> =
  | {
      ok: true;
      model: EmbeddingModel | undefined;
      documents: DocumentEntry<E>[];
    }
  | { ok: false; problems: DocumentLoadError[] };

const RUN_EMBED = "run md-rag embed";
const EMBED_SKIPS = "embed skips documents that fail the contract";

// Judges sidecars from their headers alone (ADR-006); `sidecars` is keyed by the owning document's path.
export function checkFreshness<E extends WithHeader>(
  knowledgeBase: KnowledgeBase,
  sidecars: ReadonlyMap<string, SidecarEntry<E>>,
): FreshnessResult<E> {
  const problems: DocumentLoadError[] = [];
  const problem = (path: string, reason: string) =>
    problems.push({ path, reason });

  const known = knownDocumentPaths(knowledgeBase);
  const documentPaths = new Set(knowledgeBase.documents.map((d) => d.path));
  for (const [path, entry] of sidecars) {
    const fix = documentPaths.has(path) ? RUN_EMBED : EMBED_SKIPS;
    if (!known.has(path)) {
      problem(
        path,
        "orphaned sidecar: no document has this path (is another knowledge base sharing the --target-dir?)",
      );
    } else if ("failure" in entry) {
      problem(path, describeFailure(entry, fix));
    }
  }

  // A stale sidecar is rebuilt by embed anyway, so only current ones say anything about the model.
  const current = new Map<string, SidecarHeader>();
  const stale = new Map<string, SidecarHeader>();
  const documents: DocumentEntry<E>[] = [];
  for (const doc of knowledgeBase.documents) {
    const entry = sidecars.get(doc.path);
    if (entry === undefined) {
      problem(doc.path, `sidecar missing; ${RUN_EMBED}`);
    } else if ("header" in entry) {
      const bucket = matchesDocument(entry.header, doc.docHash)
        ? current
        : stale;
      bucket.set(doc.path, entry.header);
      documents.push({ document: doc, entry });
    }
  }

  const model = checkSharedModel(current, problem);
  for (const [path, header] of stale) {
    const builtWith =
      model && header.model !== model.modelId
        ? ` and was built with model ${header.model}, not ${model.modelId}`
        : "";
    problem(
      path,
      `stale sidecar: its doc_hash does not match the document${builtWith}; ${RUN_EMBED}`,
    );
  }

  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return { ok: true, model, documents };
}

function describeFailure(
  entry: { failure: SidecarFailure; message: string },
  fix: string,
): string {
  switch (entry.failure) {
    case "invalid":
      return `invalid sidecar: ${entry.message}; ${fix}`;
    case "unreadable":
      return `unreadable sidecar: ${entry.message}; check the file's permissions`;
    case "rejected":
      return `rejected sidecar path: ${entry.message}; remove or rename the file by hand`;
    default: {
      const exhaustive: never = entry.failure;
      return exhaustive;
    }
  }
}

// Undefined when there are no sidecars or the shared model is unusable, which is reported as problems.
function checkSharedModel(
  headers: ReadonlyMap<string, SidecarHeader>,
  problem: (path: string, reason: string) => unknown,
): EmbeddingModel | undefined {
  const modelIds = [...new Set([...headers.values()].map((h) => h.model))];
  modelIds.sort();

  if (modelIds.length > 1) {
    for (const [path, header] of headers) {
      problem(
        path,
        `sidecars record different models (${modelIds.join(", ")}) and this one has ${header.model}; ${RUN_EMBED}`,
      );
    }
    return undefined;
  }

  const [modelId] = modelIds;
  if (modelId === undefined) return undefined;
  const preset = findEmbeddingPreset(modelId);
  if (preset === undefined) {
    for (const path of headers.keys()) {
      problem(
        path,
        `the engine has no preset for the recorded model ${modelId}`,
      );
    }
    return undefined;
  }

  const model = { modelId, dims: preset.dims };
  for (const [path, header] of headers) {
    if (!matchesModel(header, model)) {
      problem(
        path,
        `sidecar vectors have ${header.dims} dims, but model ${modelId} has ${model.dims}; ${RUN_EMBED}`,
      );
    }
  }
  return model;
}
