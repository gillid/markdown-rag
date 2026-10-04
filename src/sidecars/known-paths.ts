import { realpath } from "node:fs/promises";
import type { KnowledgeBase } from "../contract/loader.ts";
import { sidecarPath } from "./store.ts";

/** A document that failed the contract still exists, so its sidecar is not an orphan. */
export function knownDocumentPaths({
  documents,
  errors,
}: KnowledgeBase): Set<string> {
  return new Set([
    ...documents.map((doc) => doc.path),
    ...errors.map((error) => error.path),
  ]);
}

// On a case-insensitive filesystem a sidecar under a document's old spelling is its live one; maps it to the owner.
export async function findCaseAliases(
  targetDir: string,
  known: ReadonlySet<string>,
  sidecarPaths: readonly string[],
): Promise<Map<string, string>> {
  const knownByLowerCase = new Map<string, string[]>();
  for (const path of known) {
    const key = path.toLowerCase();
    knownByLowerCase.set(key, [...(knownByLowerCase.get(key) ?? []), path]);
  }
  const aliases = new Map<string, string>();
  for (const path of sidecarPaths) {
    if (known.has(path)) continue;
    for (const owner of knownByLowerCase.get(path.toLowerCase()) ?? []) {
      if (await isSameFile(targetDir, path, owner)) {
        aliases.set(path, owner);
        break;
      }
    }
  }
  return aliases;
}

async function isSameFile(
  targetDir: string,
  orphan: string,
  owner: string,
): Promise<boolean> {
  try {
    return (
      (await realpath(sidecarPath(targetDir, orphan))) ===
      (await realpath(sidecarPath(targetDir, owner)))
    );
  } catch {
    return false;
  }
}
