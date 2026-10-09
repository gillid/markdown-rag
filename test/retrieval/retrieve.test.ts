import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KnowledgeIndex } from "../../src/index/knowledge-index.ts";
import type { SearchMode } from "../../src/index/search-mode.ts";
import type { Reranker } from "../../src/models/reranker.ts";
import { createRetriever } from "../../src/retrieval/retrieve.ts";
import type { RetrievalDefaults } from "../../src/retrieval/types.ts";
import { buildTestIndex, MODEL } from "../support/build-test-index.ts";
import { createCountingEmbedder } from "../support/embed-fakes.ts";

const EXAMPLES = join(import.meta.dirname, "..", "..", "examples", "docs");
const NOW = Date.parse("2026-10-05T00:00:00Z");
const KEY_ROTATION = "Rotate the gateway signing key every quarter.";

function constantReranker(logit = 0): Reranker {
  return {
    modelId: "fake-reranker",
    async rerank(_query, passages) {
      return passages.map(() => logit);
    },
  };
}

/** Scores a passage by how many of the query's words it contains. */
function overlapReranker(): Reranker {
  return {
    modelId: "fake-reranker",
    async rerank(query, passages) {
      const words = query.toLowerCase().split(/\s+/);
      return passages.map(
        (passage) =>
          words.filter((word) => passage.toLowerCase().includes(word)).length -
          1,
      );
    },
  };
}

async function writeDocument(
  root: string,
  path: string,
  frontmatter: Record<string, string>,
  body: string,
): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  const header = Object.entries({
    title: "Signing keys",
    tags: "[]",
    ...frontmatter,
  }).map(([key, value]) => `${key}: ${value}`);
  await writeFile(file, `---\n${header.join("\n")}\n---\n\n${body}\n`, "utf8");
}

describe("retrieve over examples/docs", () => {
  let root: string;
  let retrieve: ReturnType<typeof createRetriever>;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "md-rag-retrieve-examples-"));
    retrieve = createRetriever({
      index: await buildTestIndex(EXAMPLES, join(root, "engine")),
      embedder: createCountingEmbedder(MODEL),
      reranker: overlapReranker(),
      now: () => NOW,
    });
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("finds the document holding an exact error code in keyword mode", async () => {
    const { results } = await retrieve({
      query: "ERR_WEBHOOK_TIMEOUT_504",
      mode: "keyword",
    });

    expect(["api/webhooks.md", "api/errors-reference.md"]).toContain(
      results[0]?.summary.path,
    );
  });

  it("returns at most the requested number of results, each document within its cap", async () => {
    const { results } = await retrieve({
      query: "webhook signature",
      limit: 10,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(10);
    const paths = results.map((r) => r.summary.path);
    for (const path of new Set(paths)) {
      expect(paths.filter((p) => p === path).length).toBeLessThanOrEqual(2);
    }
  });

  it("orders results by final score within each rank class", async () => {
    const { results } = await retrieve({ query: "rotate api keys", limit: 10 });

    const finals = results.map((r) => r.scores.final);
    expect(finals).toEqual([...finals].sort((a, b) => b - a));
  });
});

// Bespoke fixtures: the recency cases need two documents with identical text that differ
// only in `updated_at`, which `examples/docs` has no pair for.
describe("retrieve", () => {
  let root: string;
  let index: KnowledgeIndex;

  const retriever = (
    reranker: Reranker | undefined,
    defaults: Partial<RetrievalDefaults> = {},
  ) =>
    createRetriever({
      index,
      embedder: createCountingEmbedder(MODEL),
      reranker,
      defaults: { rerank: reranker !== undefined, ...defaults },
      now: () => NOW,
    });

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "md-rag-retrieve-"));
    const docs = join(root, "docs");
    await writeDocument(
      docs,
      "fresh.md",
      { updated_at: "2026-09-20" },
      KEY_ROTATION,
    );
    await writeDocument(
      docs,
      "stale.md",
      { updated_at: "2025-01-10" },
      KEY_ROTATION,
    );
    await writeDocument(
      docs,
      "guide.md",
      { title: "Guide", updated_at: "2025-01-10" },
      "## Alpha\n\nfirst section\n\n## Bravo\n\nzebra crossing\n\n## Charlie\n\nthird section",
    );
    index = await buildTestIndex(docs, join(root, "engine"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("ranks the fresh document above the stale one on the same topic", async () => {
    const { results } = await retriever(constantReranker())({
      query: "gateway signing key",
      mode: "keyword",
    });

    expect(results.map((r) => r.summary.path)).toEqual([
      "fresh.md",
      "stale.md",
    ]);
    expect(results[0]?.scores.final).toBeGreaterThan(
      results[1]?.scores.final ?? 0,
    );
  });

  it("scores them equally when the recency weight is 0", async () => {
    const { results } = await retriever(constantReranker())({
      query: "gateway signing key",
      mode: "keyword",
      weights: { recency: 0 },
    });

    expect(results.map((r) => r.scores.final)).toEqual([0.5, 0.5]);
  });

  it("reports the blend of a reranked result against hand-computed values", async () => {
    const { results } = await retriever(constantReranker(), {
      halfLifeDays: 90,
    })({ query: "gateway signing key", mode: "keyword", limit: 1 });

    // Fresh is 15 days old, so recency is 0.5^(1/6) = 0.89089871814; relevance is sigmoid(0) = 0.5.
    // final = 0.85 * 0.5 + 0.15 * 0.89089871814 = 0.55863480772.
    const scores = results[0]?.scores;
    expect(scores).toMatchObject({ rerank: 0, relevance: 0.5 });
    expect(scores?.signals.recency).toBeCloseTo(0.89089871814, 10);
    expect(scores?.final).toBeCloseTo(0.55863480772, 10);
  });

  it("cites a chunk with no anchor by its document alone", async () => {
    const { results } = await retriever(constantReranker())({
      query: "gateway signing key",
      mode: "keyword",
      limit: 1,
    });

    expect(results[0]?.ref).toBe("fresh.md");
  });

  it("counts results, not chunks, against the limit", async () => {
    const { results } = await retriever(overlapReranker())({
      query: "gateway signing key section first third",
      mode: "keyword",
      expand: 1,
      limit: 3,
    });

    expect(results.map((r) => r.summary.path).sort()).toEqual([
      "fresh.md",
      "guide.md",
      "stale.md",
    ]);
  });

  it("rejects a weight for any signal but recency or a tag", async () => {
    await expect(
      retriever(constantReranker())({
        query: "key",
        weights: { authority: 0.1 },
      }),
    ).rejects.toThrow('the signals are "recency" and "tag:<tag>"');
  });

  it("rejects a weight for a tag no document carries", async () => {
    await expect(
      retriever(constantReranker())({
        query: "key",
        weights: { "tag:runbook": 0.1 },
      }),
    ).rejects.toThrow('no document has the tag "runbook"');
  });

  it("uses the reranker's logits for relevance and ordering", async () => {
    const { results } = await retriever(overlapReranker())({
      query: "zebra crossing",
      mode: "keyword",
      weights: { recency: 0 },
    });

    expect(results[0]?.summary.path).toBe("guide.md");
    expect(results[0]?.scores.rerank).toBe(1);
    expect(results[0]?.scores.relevance).toBeCloseTo(0.7310585786, 10);
  });

  it("normalises the retrieval score when reranking is off", async () => {
    const { results } = await retriever(undefined)({
      query: "zebra crossing",
      mode: "keyword",
      weights: { recency: 0 },
    });

    expect(results[0]?.scores).toMatchObject({ rerank: null, relevance: 1 });
  });

  it("drops results under min_score and honours limit", async () => {
    const run = retriever(constantReranker());

    const none = await run({
      query: "gateway signing key",
      mode: "keyword",
      minScore: 0.99,
    });
    const one = await run({
      query: "gateway signing key",
      mode: "keyword",
      limit: 1,
    });

    expect(none.results).toEqual([]);
    expect(one.results).toHaveLength(1);
  });

  describe("min_score", () => {
    const request = {
      query: "gateway signing key",
      mode: "keyword" as const,
      minScore: 0.1,
    };

    it("cuts on relevance, so a fresh document cannot be carried over it by its signals alone", async () => {
      // Relevance is sigmoid(-20), about 2e-9. Fresh scores 0.15 * 0.89 = 0.134 on recency alone, above 0.1.
      const { results } = await retriever(constantReranker(-20))(request);

      expect(results).toEqual([]);
    });

    it("keeps results whose relevance clears it", async () => {
      // Relevance is sigmoid(0) = 0.5.
      const { results } = await retriever(constantReranker(0))(request);

      expect(results.map((r) => r.summary.path)).toEqual([
        "fresh.md",
        "stale.md",
      ]);
    });
  });

  it("expands a hit with its neighbouring chunks and stops at the document's edges", async () => {
    const run = retriever(overlapReranker());

    const [middle] = (
      await run({
        query: "zebra crossing",
        mode: "keyword",
        limit: 1,
        expand: 1,
      })
    ).results;
    const [edge] = (
      await run({
        query: "first",
        mode: "keyword",
        limit: 1,
        expand: 1,
      })
    ).results;

    expect(middle?.chunks).toEqual({ from: 0, to: 2 });
    expect(middle?.text).toContain("first section");
    expect(middle?.text).toContain("third section");
    expect(middle?.ref).toBe("guide.md#bravo");
    expect(edge?.chunks).toEqual({ from: 0, to: 1 });
  });

  it("runs the semantic mode through the query embedding", async () => {
    const { results, timings } = await retriever(constantReranker())({
      query: "anything",
      mode: "semantic",
    });

    expect(results.length).toBeGreaterThan(0);
    expect(timings.totalMs).toBeGreaterThanOrEqual(timings.searchMs);
  });

  it.each([
    [{ query: "  " }, "blank"],
    [{ query: "​​" }, "blank"],
    [{ query: "key", limit: 11 }, "limit"],
    [{ query: "key", limit: 0 }, "limit"],
    [{ query: "key", expand: 3 }, "expand"],
    [{ query: "key", minScore: Number.NaN }, "minScore"],
  ])("rejects %j", async (request, message) => {
    await expect(retriever(constantReranker())(request)).rejects.toThrow(
      message,
    );
  });

  it.each([
    [{ halfLifeDays: 0 }, "halfLifeDays"],
    [{ minScore: Number.NaN }, "minScore"],
    [{ limit: 11 }, "limit"],
    [{ hybridWeights: { text: 0, vector: 1 } }, "hybrid weight"],
  ])("rejects the configured defaults %j", (defaults, message) => {
    expect(() => retriever(constantReranker(), defaults)).toThrow(message);
  });

  it("keeps the built-in default for a configured value that is undefined", async () => {
    const { results } = await retriever(constantReranker(), {
      weights: undefined,
    })({ query: "gateway signing key", mode: "keyword" });

    expect(results[0]?.scores.signals).toHaveProperty("recency");
  });

  describe("a chunk the reranker could not score", () => {
    const unscorable: Reranker = {
      modelId: "fake-reranker",
      async rerank(_query, passages) {
        return passages.map(() => null);
      },
    };
    const request = {
      query: "zebra crossing",
      mode: "keyword" as const,
      weights: { recency: 0.15 },
    };

    it("is returned with no rerank score and no relevance", async () => {
      const { results } = await retriever(unscorable)(request);

      expect(results[0]?.scores).toMatchObject({ rerank: null, relevance: 0 });
    });

    it("is dropped once min_score asks for relevance, however fresh the document", async () => {
      const { results } = await retriever(unscorable)({
        ...request,
        minScore: 0.01,
      });

      expect(results).toEqual([]);
    });
  });

  it("fails when the reranker returns the wrong number of scores", async () => {
    const short: Reranker = {
      modelId: "fake-reranker",
      async rerank() {
        return [];
      },
    };

    await expect(
      retriever(short)({ query: "zebra crossing", mode: "keyword" }),
    ).rejects.toThrow("0 scores for 1 passages");
  });

  it("rejects a mode that is not hybrid, keyword or semantic", async () => {
    const run = retriever(constantReranker());
    const fuzzy = "fuzzy" as SearchMode;

    await expect(run({ query: "key", mode: fuzzy })).rejects.toThrow("mode");
    expect(() => retriever(constantReranker(), { mode: fuzzy })).toThrow(
      "mode",
    );
  });

  it("does not call the reranker when no candidate matched", async () => {
    let calls = 0;
    const counting: Reranker = {
      modelId: "fake-reranker",
      async rerank(_query, passages) {
        calls++;
        return passages.map(() => 0);
      },
    };

    const { results } = await retriever(counting)({
      query: "zzzunmatchedterm",
      mode: "keyword",
    });

    expect(results).toEqual([]);
    expect(calls).toBe(0);
  });

  it("refuses an embedder from another model than the index's", () => {
    expect(() =>
      createRetriever({
        index,
        embedder: createCountingEmbedder({ modelId: "other-model", dims: 384 }),
        reranker: constantReranker(),
      }),
    ).toThrow("bge-small-en-v1.5-q8 but the embedder is other-model");
  });

  it("requires a reranker while rerank is on", () => {
    expect(() => retriever(undefined, { rerank: true })).toThrow("reranker");
  });
});

// Four documents with identical text and date, so only their tags tell them apart.
describe("retrieve with tag weights", () => {
  let root: string;
  let index: KnowledgeIndex;

  const finalsByPath = async (
    weights: Record<string, number>,
    defaults: Partial<RetrievalDefaults> = {},
  ) => {
    const retrieve = createRetriever({
      index,
      embedder: createCountingEmbedder(MODEL),
      reranker: constantReranker(),
      defaults,
      now: () => NOW,
    });
    const { results } = await retrieve({
      query: "gateway signing key",
      mode: "keyword",
      limit: 10,
      weights,
    });
    return Object.fromEntries(
      results.map((r) => [r.summary.path, r.scores.final]),
    );
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "md-rag-retrieve-tags-"));
    const docs = join(root, "docs");
    const updated_at = "2026-09-20";
    const tagged = (tags: string) => ({ updated_at, tags });
    await writeDocument(docs, "plain.md", tagged("[]"), KEY_ROTATION);
    await writeDocument(docs, "runbook.md", tagged("[runbook]"), KEY_ROTATION);
    await writeDocument(docs, "slack.md", tagged("[slack]"), KEY_ROTATION);
    await writeDocument(
      docs,
      "both.md",
      tagged("[runbook, slack]"),
      KEY_ROTATION,
    );
    index = await buildTestIndex(docs, join(root, "engine"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("boosts and penalises by tag against hand-computed blends", async () => {
    // Relevance is sigmoid(0) = 0.5 and the largest tag weight is 0.2, so relevance keeps 0.8.
    // plain: 0.8 * 0.5 = 0.4; runbook: 0.4 + 0.2 = 0.6; slack: 0.4 - 0.1 = 0.3;
    // both: the larger magnitude, runbook's +0.2, wins over slack's -0.1, so 0.6.
    const finals = await finalsByPath({
      recency: 0,
      "tag:runbook": 0.2,
      "tag:slack": -0.1,
    });

    expect(finals["plain.md"]).toBeCloseTo(0.4, 12);
    expect(finals["runbook.md"]).toBeCloseTo(0.6, 12);
    expect(finals["slack.md"]).toBeCloseTo(0.3, 12);
    expect(finals["both.md"]).toBeCloseTo(0.6, 12);
  });

  it("ranks a curated page above a chat thread of the same relevance", async () => {
    const finals = await finalsByPath({
      recency: 0,
      "tag:runbook": 0.2,
      "tag:slack": -0.1,
    });

    expect(finals["runbook.md"]).toBeGreaterThan(finals["plain.md"] ?? 0);
    expect(finals["plain.md"]).toBeGreaterThan(finals["slack.md"] ?? 0);
  });

  it("combines with recency under the shared cap", async () => {
    // Fresh is 15 days old: recency 0.89089871814. runbook: (1 - 0.1 - 0.2) * 0.5 + 0.1 * 0.89089871814 + 0.2 = 0.639089871814.
    const finals = await finalsByPath({ recency: 0.1, "tag:runbook": 0.2 });

    expect(finals["runbook.md"]).toBeCloseTo(0.639089871814, 10);
  });

  it("applies a configured tag weight, which a request can override", async () => {
    const configured = { weights: { recency: 0, "tag:slack": -0.2 } };

    const byDefault = await finalsByPath({}, configured);
    const overridden = await finalsByPath({ "tag:slack": -0.1 }, configured);

    expect(byDefault["slack.md"]).toBeCloseTo(0.8 * 0.5 - 0.2, 12);
    expect(overridden["slack.md"]).toBeCloseTo(0.9 * 0.5 - 0.1, 12);
  });

  it("counts the default recency weight against the cap unless the request lowers it", async () => {
    const run = (weights: Record<string, number>) => finalsByPath(weights);

    // Defaults carry recency 0.15, so 0.15 + 0.4 = 0.55.
    await expect(run({ "tag:runbook": 0.4 })).rejects.toThrow(
      "recency weight 0.15 (the default; set recency to lower it) plus the largest tag weight by magnitude 0.4",
    );
    await expect(
      run({ recency: 0, "tag:runbook": 0.4 }),
    ).resolves.toBeDefined();
  });

  it("refuses to start with a configured weight for a tag no document carries", () => {
    expect(() =>
      createRetriever({
        index,
        embedder: createCountingEmbedder(MODEL),
        reranker: constantReranker(),
        defaults: { weights: { "tag:nosuch": 0.1 } },
      }),
    ).toThrow('no document has the tag "nosuch"');
  });
});
