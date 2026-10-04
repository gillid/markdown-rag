import { realpath } from "node:fs/promises";
import { relative } from "node:path";
import type { Chunker } from "../chunking/chunker.ts";
import type { DocumentLoadError, KnowledgeBase } from "../contract/loader.ts";
import { errorMessage } from "../errors.ts";
import { type Embedder, EmbedderUnavailableError } from "../models/embedder.ts";
import { embedPlans } from "./embed-plans.ts";
import { ensureEngineDir } from "./engine-dir.ts";
import { completeSidecar, planSidecar, type SidecarPlan } from "./plan.ts";
import { SidecarContentError } from "./sidecar.ts";
import {
  deleteSidecar,
  deleteTempFile,
  openSidecar,
  scanVectorsDir,
  sidecarPath,
  writeSidecar,
} from "./store.ts";

export interface EmbedOptions {
  targetDir: string;
  knowledgeBase: KnowledgeBase;
  embedder: Embedder;
  chunker: Chunker;
  /** Re-chunk every document, even those whose sidecar is fresh. */
  rechunk?: boolean;
}

export interface EmbedReport {
  written: number;
  upToDate: number;
  pruned: number;
  /** Chunks that needed a vector, counting repeats of the same chunk within a document. */
  chunksEmbedded: number;
  chunksReused: number;
  failures: DocumentLoadError[];
  /** Housekeeping problems; they never fail the run. */
  warnings: string[];
  /** Set when the model could not be loaded, which ends the run early without pruning. */
  modelError?: string;
  /** Documents that needed embedding but were not reached because the run ended early. */
  skipped: number;
}

/** A document that fails keeps its old sidecar and is reported; the rest are still written (ADR-005, ADR-032). */
export async function embedKnowledgeBase(
  options: EmbedOptions,
): Promise<EmbedReport> {
  const { targetDir, knowledgeBase, embedder, chunker } = options;
  const rechunk = options.rechunk ?? false;
  await ensureEngineDir(targetDir);

  const report: EmbedReport = {
    written: 0,
    upToDate: 0,
    pruned: 0,
    chunksEmbedded: 0,
    chunksReused: 0,
    failures: [],
    warnings: [],
    skipped: 0,
  };

  const plans: SidecarPlan[] = [];
  for (const doc of knowledgeBase.documents) {
    try {
      const opened = await tolerateInvalid(() =>
        openSidecar(targetDir, doc.path),
      );
      const plan = await planSidecar({
        doc,
        previous: opened && {
          header: opened.header,
          load: () => tolerateInvalidSync(opened.load),
        },
        chunker,
        embedder,
        rechunk,
      });
      if (plan) {
        plans.push(plan);
      } else {
        report.upToDate++;
      }
    } catch (cause) {
      report.failures.push({ path: doc.path, reason: errorMessage(cause) });
    }
  }

  let handled = 0;
  try {
    for await (const embedding of embedPlans(plans, embedder)) {
      handled++;
      const { plan } = embedding;
      if ("error" in embedding) {
        report.failures.push({ path: plan.path, reason: embedding.error });
        continue;
      }
      try {
        await writeSidecar(
          targetDir,
          plan.path,
          completeSidecar(plan, embedding.vectors),
        );
      } catch (cause) {
        report.failures.push({ path: plan.path, reason: errorMessage(cause) });
        continue;
      }
      const reused = plan.chunks.filter((chunk) => chunk.vector).length;
      report.written++;
      report.chunksReused += reused;
      report.chunksEmbedded += plan.chunks.length - reused;
    }
  } catch (cause) {
    if (!(cause instanceof EmbedderUnavailableError)) throw cause;
    report.modelError = cause.message;
    report.skipped = plans.length - handled;
    return report;
  }

  await prune(targetDir, knowledgeBase, report);
  return report;
}

// Invalid contents mean a rebuild from scratch; an unreadable file or a bad path is a failure.
async function tolerateInvalid<T>(
  read: () => Promise<T | undefined>,
): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof SidecarContentError) {
      return undefined;
    }
    throw error;
  }
}

function tolerateInvalidSync<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch (error) {
    if (error instanceof SidecarContentError) return undefined;
    throw error;
  }
}

// A document that failed the contract still exists, so its sidecar is not an orphan.
async function prune(
  targetDir: string,
  { documents, errors }: KnowledgeBase,
  report: EmbedReport,
): Promise<void> {
  const existing = new Set([
    ...documents.map((doc) => doc.path),
    ...errors.map((error) => error.path),
  ]);
  const existingByLowerCase = new Map(
    [...existing].map((path) => [path.toLowerCase(), path]),
  );
  const { docPaths, tempFiles } = await scanVectorsDir(targetDir);

  // Temp files go first so the directories they keep non-empty can be tidied.
  for (const tempFile of tempFiles) {
    await attempt(
      relative(targetDir, tempFile),
      () => deleteTempFile(targetDir, tempFile),
      report,
    );
  }
  for (const path of docPaths.filter((docPath) => !existing.has(docPath))) {
    if (await isCaseAliasOfExisting(targetDir, path, existingByLowerCase)) {
      continue;
    }
    if (await attempt(path, () => deleteSidecar(targetDir, path), report)) {
      report.pruned++;
    }
  }
}

async function attempt(
  path: string,
  action: () => Promise<void>,
  report: EmbedReport,
): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (cause) {
    report.warnings.push(`${path}: could not prune: ${errorMessage(cause)}`);
    return false;
  }
}

// On a case-insensitive filesystem a sidecar named for the old spelling of a renamed document is the live one.
async function isCaseAliasOfExisting(
  targetDir: string,
  orphan: string,
  existingByLowerCase: ReadonlyMap<string, string>,
): Promise<boolean> {
  const alias = existingByLowerCase.get(orphan.toLowerCase());
  if (alias === undefined) return false;
  try {
    return (
      (await realpath(sidecarPath(targetDir, orphan))) ===
      (await realpath(sidecarPath(targetDir, alias)))
    );
  } catch {
    return false;
  }
}
