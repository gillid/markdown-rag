import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll } from "vitest";
import type { Engine } from "../../src/engine/start-engine.ts";
import { startEngine } from "../../src/engine/start-engine.ts";
import type { Reranker } from "../../src/models/reranker.ts";
import { embedTestSidecars, MODEL } from "./build-test-index.ts";
import { createCountingEmbedder } from "./embed-fakes.ts";

export const EXAMPLES = join(
  import.meta.dirname,
  "..",
  "..",
  "examples",
  "docs",
);
export const NOW = Date.parse("2026-10-05T00:00:00Z");

/** Scores a passage by how many of the query's words it contains. */
export const overlapReranker: Reranker = {
  modelId: "fake-reranker",
  async rerank(query, passages) {
    const words = query.toLowerCase().split(/\s+/);
    return passages.map(
      (passage) =>
        words.filter((word) => passage.toLowerCase().includes(word)).length - 1,
    );
  },
};

export const frontmatter = (extra: string[] = []) => [
  "title: Guide",
  "source: docs",
  'updated_at: "2026-01-15"',
  ...extra,
];

export async function writeMarkdown(
  root: string,
  path: string,
  frontmatterLines: string[],
  body: string,
): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    ["---", ...frontmatterLines, "---", "", body, ""].join("\n"),
    "utf8",
  );
}

/** Embeds `sourceDir` into a sibling engine folder and starts an engine over it, with fake models and a fixed clock. */
export async function engineOver(
  workDir: string,
  sourceDir: string,
  retrieval: Record<string, unknown> = {},
): Promise<Engine> {
  const targetDir = join(workDir, "engine");
  await embedTestSidecars(sourceDir, targetDir);
  return startEngine(
    { sourceDir, targetDir, retrieval },
    {
      embedder: createCountingEmbedder(MODEL),
      reranker: overlapReranker,
      now: () => NOW,
    },
  );
}

/** A temporary directory for the tests of one file, holding a `<name>/kb` knowledge base per test. */
export function scratchKnowledgeBases(prefix: string) {
  let root = "";
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), prefix));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return {
    root: () => root,
    /** The work directory of one test: its knowledge base is `<workDir>/kb`. */
    workDir: (name: string) => join(root, name),
    async fresh(name: string): Promise<string> {
      const dir = join(root, name, "kb");
      await mkdir(dir, { recursive: true });
      return dir;
    },
  };
}
