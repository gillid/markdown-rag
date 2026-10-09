import { expect } from "vitest";
import { createStructuralChunker } from "../../src/chunking/structural-chunker.ts";
import { loadConfig } from "../../src/config/config.ts";
import { loadKnowledgeBase } from "../../src/contract/loader.ts";
import { buildIndex } from "../../src/index/build-index.ts";
import type { Embedder } from "../../src/models/embedder.ts";
import { embedKnowledgeBase } from "../../src/sidecars/embed.ts";
import { readSidecarEntries } from "../../src/sidecars/read-entries.ts";
import { createCountingEmbedder } from "./embed-fakes.ts";

// A fake embedder must carry a preset's ID and dims for the freshness check to accept it.
export const MODEL = { modelId: "bge-small-en-v1.5-q8", dims: 384 };

/** Embeds `sourceDir` with a fake embedder into `targetDir`, as `markdown-rag embed` would. */
export async function embedTestSidecars(
  sourceDir: string,
  targetDir: string,
  embedder: Embedder = createCountingEmbedder(MODEL),
) {
  const config = loadConfig({ sourceDir, targetDir });
  const knowledgeBase = await loadKnowledgeBase(config);
  const report = await embedKnowledgeBase({
    targetDir,
    knowledgeBase,
    embedder,
    chunker: createStructuralChunker(),
  });
  expect(report.failures).toEqual([]);
  return { config, knowledgeBase };
}

/** Embeds `sourceDir` with a fake embedder into `targetDir` and builds the index from the sidecars. */
export async function buildTestIndex(
  sourceDir: string,
  targetDir: string,
  embedder: Embedder = createCountingEmbedder(MODEL),
) {
  const { knowledgeBase } = await embedTestSidecars(
    sourceDir,
    targetDir,
    embedder,
  );
  return buildIndex(
    knowledgeBase,
    await readSidecarEntries(targetDir, knowledgeBase),
  );
}
