import type { Config } from "../config/config.ts";
import { loadKnowledgeBase } from "../contract/loader.ts";
import { buildIndex } from "../index/build-index.ts";
import type { KnowledgeIndex } from "../index/knowledge-index.ts";
import { readSidecarEntries } from "../sidecars/read-entries.ts";

/** Refuses a knowledge base that breaks the contract or has missing, stale or mixed sidecars, rather than serving it (ADR-006). */
export async function loadIndex(config: Config): Promise<KnowledgeIndex> {
  const knowledgeBase = await loadKnowledgeBase(config);
  const sidecars = await readSidecarEntries(config.targetDir, knowledgeBase);
  return buildIndex(knowledgeBase, sidecars);
}
