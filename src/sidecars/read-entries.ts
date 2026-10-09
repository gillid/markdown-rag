import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { VECTORS_DIR_NAME } from "../config/layout.ts";
import type { KnowledgeBase } from "../contract/loader.ts";
import { errorMessage, isErrnoException } from "../errors.ts";
import type { SidecarEntry } from "./freshness.ts";
import { findCaseAliases, knownDocumentPaths } from "./known-paths.ts";
import {
  type OpenedSidecar,
  SidecarContentError,
  SidecarError,
  SidecarReadError,
} from "./sidecar.ts";
import { openSidecar, scanVectorsDir } from "./store.ts";

// A knowledge base with no documents needs no sidecars, so a missing folder is then not an error.
export async function readSidecarEntries(
  targetDir: string,
  knowledgeBase: KnowledgeBase,
): Promise<Map<string, SidecarEntry<OpenedSidecar>>> {
  const vectorsDir = resolve(targetDir, VECTORS_DIR_NAME);
  const entries = new Map<string, SidecarEntry<OpenedSidecar>>();
  if (!(await vectorsDirExists(vectorsDir))) {
    if (knowledgeBase.documents.length === 0) return entries;
    throw new SidecarError(
      `no sidecars: ${vectorsDir} does not exist. Run markdown-rag embed first, or pass the --target-dir that embed used.`,
    );
  }

  const { docPaths } = await scanVectorsDir(targetDir);
  const aliases = await findCaseAliases(
    targetDir,
    knownDocumentPaths(knowledgeBase),
    docPaths,
  );
  for (const docPath of docPaths) {
    const entry = await readEntry(targetDir, docPath);
    if (entry) entries.set(aliases.get(docPath) ?? docPath, entry);
  }
  return entries;
}

// A sidecar that vanished since the scan is simply absent, so its document counts as missing one.
async function readEntry(
  targetDir: string,
  docPath: string,
): Promise<SidecarEntry<OpenedSidecar> | undefined> {
  try {
    return await openSidecar(targetDir, docPath);
  } catch (error) {
    if (error instanceof SidecarReadError) {
      return { failure: "unreadable", message: errorMessage(error) };
    }
    if (error instanceof SidecarContentError) {
      return { failure: "invalid", message: errorMessage(error) };
    }
    if (error instanceof SidecarError) {
      return { failure: "rejected", message: errorMessage(error) };
    }
    throw error;
  }
}

async function vectorsDirExists(vectorsDir: string): Promise<boolean> {
  try {
    const info = await stat(vectorsDir);
    if (!info.isDirectory()) {
      throw new SidecarError(`${vectorsDir} exists but is not a directory`);
    }
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return false;
    throw error;
  }
}
