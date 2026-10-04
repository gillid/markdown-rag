import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/config.ts";
import type { KnowledgeIndex } from "../../src/index/knowledge-index.ts";
import { searchCandidates } from "../../src/index/search-candidates.ts";
import type { Embedder } from "../../src/models/embedder.ts";
import { createTransformersEmbedder } from "../../src/models/transformers-embedder.ts";
import { buildTestIndex } from "../support/build-test-index.ts";

const EXAMPLES = join(import.meta.dirname, "..", "..", "examples", "docs");
const TIMEOUT = 600_000;
const PARAPHRASE =
  "what should I do when the main data store dies and we have to switch over to the standby copy?";
const FAILOVER_RUNBOOK = "runbooks/database-failover-runbook.md";

describe("searchCandidates with the real embedder", () => {
  let root: string;
  let embedder: Embedder;
  let index: KnowledgeIndex;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "md-rag-candidates-models-"));
    const targetDir = join(root, "engine");
    embedder = createTransformersEmbedder(
      loadConfig({
        sourceDir: EXAMPLES,
        targetDir,
        modelsDir: join(root, "models"),
      }),
    );
    index = await buildTestIndex(EXAMPLES, targetDir, embedder);
  }, TIMEOUT);

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it(
    "finds a document from a paraphrase that shares no keywords with it, in semantic mode",
    async () => {
      const vector = await embedder.embedQuery(PARAPHRASE);

      const candidates = await searchCandidates(index, {
        mode: "semantic",
        vector,
        k: 10,
      });

      expect(candidates.map((c) => c.path)).toContain(FAILOVER_RUNBOOK);
    },
    TIMEOUT,
  );

  it(
    "finds the same document in hybrid mode, the default, with finite scores",
    async () => {
      const vector = await embedder.embedQuery(PARAPHRASE);

      const candidates = await searchCandidates(index, {
        mode: "hybrid",
        text: PARAPHRASE,
        vector,
        k: 10,
      });

      expect(candidates.map((c) => c.path)).toContain(FAILOVER_RUNBOOK);
      expect(candidates.every((c) => Number.isFinite(c.score))).toBe(true);
    },
    TIMEOUT,
  );
});
