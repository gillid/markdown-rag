import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { count } from "@orama/orama";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Filter } from "../../src/index/filter.ts";
import type { KnowledgeIndex } from "../../src/index/knowledge-index.ts";
import {
  type CandidateQuery,
  searchCandidates,
} from "../../src/index/search-candidates.ts";
import type { SearchMode } from "../../src/index/search-mode.ts";
import { buildTestIndex, MODEL } from "../support/build-test-index.ts";
import { createCountingEmbedder } from "../support/embed-fakes.ts";

const EXAMPLES = join(import.meta.dirname, "..", "..", "examples", "docs");
const MODES: SearchMode[] = ["hybrid", "keyword", "semantic"];

async function query(
  mode: SearchMode,
  text: string,
  filter?: Filter,
  k = 30,
): Promise<CandidateQuery> {
  const base = { k, filter };
  if (mode === "keyword") return { ...base, mode, text };
  const vector = await createCountingEmbedder(MODEL).embedQuery(text);
  return mode === "semantic"
    ? { ...base, mode, vector }
    : { ...base, mode, text, vector };
}

describe("searchCandidates", () => {
  let root: string;
  let examples: KnowledgeIndex;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "markdown-rag-candidates-"));
    examples = await buildTestIndex(EXAMPLES, join(root, "engine"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("finds the document holding an exact error code in keyword mode", async () => {
    const candidates = await searchCandidates(
      examples,
      await query("keyword", "ERR_WEBHOOK_TIMEOUT_504"),
    );

    expect(["api/webhooks.md", "api/errors-reference.md"]).toContain(
      candidates[0]?.path,
    );
  });

  it("matches a chunk that has some of the query's words, not only all of them", async () => {
    const candidates = await searchCandidates(
      examples,
      await query("keyword", "the ERR_WEBHOOK_TIMEOUT_504 zzzunknownword"),
    );

    expect(["api/webhooks.md", "api/errors-reference.md"]).toContain(
      candidates[0]?.path,
    );
  });

  it("returns at most k candidates, best first", async () => {
    const candidates = await searchCandidates(
      examples,
      await query("hybrid", "webhook signature", undefined, 5),
    );

    expect(candidates).toHaveLength(5);
    expect(candidates.map((c) => c.score)).toEqual(
      candidates.map((c) => c.score).sort((a, b) => b - a),
    );
  });

  it("returns every chunk when k exceeds the chunk count, even the dissimilar ones, in semantic mode", async () => {
    const candidates = await searchCandidates(
      examples,
      await query("semantic", "anything", undefined, count(examples.orama)),
    );

    expect(candidates).toHaveLength(count(examples.orama));
  });

  describe.each(["  ", "the", "the and of", "???"])(
    "a query with no searchable text (%j)",
    (text) => {
      it("returns nothing in keyword mode", async () => {
        expect(
          await searchCandidates(examples, await query("keyword", text)),
        ).toEqual([]);
      });

      it("falls back to the vector side in hybrid mode", async () => {
        const vector = await createCountingEmbedder(MODEL).embedQuery(text);

        const hybrid = await searchCandidates(examples, {
          mode: "hybrid",
          text,
          vector,
          k: 10,
        });

        expect(hybrid).toHaveLength(10);
        expect(hybrid).toEqual(
          await searchCandidates(examples, { mode: "semantic", vector, k: 10 }),
        );
      });
    },
  );

  it("never returns a non-finite score, even when a filter leaves a single chunk", async () => {
    for (const filter of [
      { dir: "teams" },
      { tags_any: ["team"] },
      { tags: ["billing"] },
      { tags: ["database", "infra", "disaster-recovery"] },
    ]) {
      const candidates = await searchCandidates(
        examples,
        await query("hybrid", "webhook signature", filter),
      );
      expect(candidates.every((c) => Number.isFinite(c.score))).toBe(true);
    }
  });

  it("ignores titleBoost in semantic mode, where it has no effect", async () => {
    const vector = await createCountingEmbedder(MODEL).embedQuery("webhook");

    const candidates = await searchCandidates(examples, {
      mode: "semantic",
      k: 3,
      vector,
      titleBoost: 0,
    });

    expect(candidates).toHaveLength(3);
  });

  it.each([0, -1, Number.NaN])(
    "rejects titleBoost = %s",
    async (titleBoost) => {
      await expect(
        searchCandidates(examples, {
          ...(await query("keyword", "webhook")),
          titleBoost,
        }),
      ).rejects.toThrow(/titleBoost must be a positive number/);
    },
  );

  it.each([
    ["all zeros", new Float32Array(384)],
    [
      "a NaN",
      Float32Array.from({ length: 384 }, (_, i) => (i === 7 ? Number.NaN : 1)),
    ],
  ])("rejects a query vector that is %s", async (_name, vector) => {
    await expect(
      searchCandidates(examples, { mode: "semantic", k: 5, vector }),
    ).rejects.toThrow(/finite and not all zeros/);
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects k = %s", async (k) => {
    await expect(
      searchCandidates(
        examples,
        await query("keyword", "webhook", undefined, k),
      ),
    ).rejects.toThrow(RangeError);
  });

  it.each(["keyword", "semantic", "hybrid"] as const)(
    "caps an enormous k at the chunk count in %s mode",
    async (mode) => {
      const candidates = await searchCandidates(
        examples,
        await query(mode, "webhook", undefined, 2 ** 40),
      );

      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates.length).toBeLessThanOrEqual(count(examples.orama));
    },
  );

  it.each(MODES)(
    "returns scores in descending order in %s mode",
    async (mode) => {
      const scores = (
        await searchCandidates(examples, await query(mode, "webhook retries"))
      ).map((c) => c.score);

      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    },
  );

  it("rejects a query vector of the wrong size", async () => {
    await expect(
      searchCandidates(examples, {
        mode: "semantic",
        k: 5,
        vector: Float32Array.of(1, 2, 3),
      }),
    ).rejects.toThrow(/3 dimensions but the index holds 384/);
  });

  it.each([
    { text: 0, vector: 1 },
    { text: 1, vector: 0 },
    { text: -1, vector: 1 },
    { text: Number.NaN, vector: 1 },
    { text: 2 },
    { vector: 3 },
  ])("rejects hybrid weights %o", async (hybridWeights) => {
    await expect(
      searchCandidates(examples, {
        ...(await query("hybrid", "webhook")),
        hybridWeights,
      } as CandidateQuery),
    ).rejects.toThrow(/must be a positive number/);
  });

  it("weights the text and vector sides as asked", async () => {
    const text = "ERR_WEBHOOK_TIMEOUT_504";
    const base = await query("hybrid", text, undefined, 5);
    if (base.mode !== "hybrid") throw new Error("expected a hybrid query");

    const textHeavy = await searchCandidates(examples, {
      ...base,
      hybridWeights: { text: 1000, vector: 1 },
    });
    const vectorHeavy = await searchCandidates(examples, {
      ...base,
      hybridWeights: { text: 1, vector: 1000 },
    });
    const [nearest] = await searchCandidates(examples, {
      mode: "semantic",
      vector: base.vector,
      k: 1,
    });

    expect(["api/webhooks.md", "api/errors-reference.md"]).toContain(
      textHeavy[0]?.path,
    );
    expect(vectorHeavy[0]).toMatchObject({
      path: nearest?.path,
      ordinal: nearest?.ordinal,
    });
  });

  describe.each(MODES)("filters in %s mode", (mode) => {
    // The expected documents are read off the fixture's frontmatter, not computed by the filter code.
    it.each<[string, Filter, (path: string) => boolean]>([
      [
        "tags_any",
        { tags_any: ["runbook", "slack"] },
        (path) => path.startsWith("runbooks/") || path.startsWith("slack/"),
      ],
      [
        "tags",
        { tags: ["api", "rate-limiting"] },
        (path) =>
          [
            "api/rate-limits.md",
            "decisions/0001-initial-rate-limits.md",
            "decisions/0002-revised-rate-limits.md",
          ].includes(path),
      ],
      [
        "tags_any",
        { tags_any: ["billing", "disaster-recovery"] },
        (path) =>
          [
            "decisions/choose-stripe-for-billing.md",
            "runbooks/restoring-from-backup.md",
          ].includes(path),
      ],
      ["dir", { dir: "runbooks" }, (path) => path.startsWith("runbooks/")],
      [
        "updated_after",
        { updated_after: Date.UTC(2026, 5, 1) },
        (path) =>
          [
            "api/changelog.md",
            "api/errors-reference.md",
            "api/rate-limits.md",
            "decisions/0002-revised-rate-limits.md",
            "runbooks/incident-response-payment-gateway-timeouts.md",
            "runbooks/rollback-a-bad-deploy.md",
            "slack/thread-debugging-timeout-spike.md",
            "slack/thread-decide-on-graphql.md",
            "slack/thread-payment-retries-discussion.md",
            "slack/thread-quarterly-postmortem-recap.md",
          ].includes(path),
      ],
    ])("narrow the results by %s", async (_name, filter, isExpected) => {
      const text = "rate limit database failover";
      const matches = ({ path }: { path: string }) => isExpected(path);

      const unfiltered = await searchCandidates(
        examples,
        await query(mode, text),
      );
      const filtered = await searchCandidates(
        examples,
        await query(mode, text, filter),
      );

      expect(unfiltered.some((candidate) => !matches(candidate))).toBe(true);
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.every(matches)).toBe(true);
    });
  });
});

describe("searchCandidates when no chunk is similar to the query vector", () => {
  let root: string;
  let index: KnowledgeIndex;
  const unit = (at: number) =>
    Float32Array.from({ length: MODEL.dims }, (_, i) => (i === at ? 1 : 0));

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "markdown-rag-candidates-orthogonal-"));
    for (const [name, text] of [
      ["many.md", "alpha alpha alpha alpha"],
      [
        "once.md",
        "alpha among a good many other unrelated words that dilute the match",
      ],
      ["none.md", "nothing relevant here"],
    ]) {
      await mkdir(join(root, "kb"), { recursive: true });
      await writeFile(
        join(root, "kb", name as string),
        `---
title: "${name}"
updated_at: "2026-01-01"
tags: []
---

${text}
`,
        "utf8",
      );
    }
    // Every chunk points along axis 0 and the query along axis 1, so every cosine is exactly 0.
    index = await buildTestIndex(join(root, "kb"), join(root, "engine"), {
      ...MODEL,
      embedDocuments: async (texts) => texts.map(() => unit(0)),
      embedQuery: async () => unit(1),
    });
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("ranks hybrid results by the text side alone instead of collapsing every score to 0", async () => {
    const candidates = await searchCandidates(index, {
      mode: "hybrid",
      text: "alpha",
      vector: unit(1),
      k: 3,
    });

    expect(candidates.map((c) => c.path)).toEqual(["many.md", "once.md"]);
    expect(candidates.every((c) => c.score > 0)).toBe(true);
  });
});

describe("searchCandidates on a knowledge base with no documents", () => {
  let root: string;
  let empty: KnowledgeIndex;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "markdown-rag-candidates-empty-"));
    await mkdir(join(root, "kb"));
    await writeFile(join(root, "kb", ".keep"), "", "utf8");
    empty = await buildTestIndex(join(root, "kb"), join(root, "engine"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it.each([
    ["all zeros", new Float32Array(384)],
    ["a NaN", Float32Array.from({ length: 384 }, () => Number.NaN)],
  ])("still rejects a query vector that is %s", async (_name, vector) => {
    await expect(
      searchCandidates(empty, { mode: "semantic", k: 5, vector }),
    ).rejects.toThrow(/finite and not all zeros/);
  });

  it.each(MODES)("finds nothing in %s mode", async (mode) => {
    expect(await searchCandidates(empty, await query(mode, "webhook"))).toEqual(
      [],
    );
  });
});
