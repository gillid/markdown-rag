import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutoTokenizer } from "@huggingface/transformers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/config.ts";
import { createPairFitter } from "../../src/models/fit-pair.ts";
import { DEFAULT_RERANKER_PRESET } from "../../src/models/presets.ts";
import { RerankerError } from "../../src/models/reranker.ts";
import { createTransformersReranker } from "../../src/models/transformers-reranker.ts";

const TIMEOUT = 120_000;

describe("transformers reranker", () => {
  let root: string;

  function rerankerFor(overrides: { allowRemoteModels?: boolean } = {}) {
    return createTransformersReranker(
      loadConfig({
        sourceDir: join(root, "docs"),
        targetDir: join(root, "engine"),
        modelsDir: join(root, "models"),
        ...overrides,
      }),
    );
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "markdown-rag-reranker-"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it(
    "scores a relevant passage above an irrelevant one",
    async () => {
      const scores = await rerankerFor().rerank("how do I rotate API keys?", [
        "A recipe for baking lasagna with béchamel sauce.",
        "To rotate an API key, create a new key in the console and revoke the old one.",
      ]);
      expect(scores).toHaveLength(2);
      expect(scores[1]).toBeGreaterThan(scores[0] as number);
    },
    TIMEOUT,
  );

  it(
    "returns no scores for no passages",
    async () => {
      expect(await rerankerFor().rerank("anything", [])).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "truncates passages longer than the model's input limit",
    async () => {
      const long = "rotate the API keys regularly. ".repeat(2_000);
      const scores = await rerankerFor().rerank("rotate api keys", [long]);
      expect(scores).toHaveLength(1);
      expect(Number.isFinite(scores[0])).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "keeps the passage visible when the query is very long",
    async () => {
      const reranker = rerankerFor();
      const query = "how do I rotate the production API keys? ".repeat(200);
      const [relevant, irrelevant] = await reranker.rerank(query, [
        "To rotate an API key, create a new key in the console and revoke the old one.",
        "A recipe for baking lasagna with béchamel sauce.",
      ]);
      expect(relevant).toBeGreaterThan(irrelevant as number);
    },
    TIMEOUT,
  );

  it(
    "still ranks a relevant opening above an irrelevant one when both passages exceed the token limit",
    async () => {
      const reranker = rerankerFor();
      const relevant =
        "To rotate an API key, create a new key and revoke the old one. ";
      const padded = relevant + "filler words go here. ".repeat(1_000);
      const [long] = await reranker.rerank("rotate api key", [padded]);
      const [unrelatedLong] = await reranker.rerank("rotate api key", [
        "lasagna recipe. ".repeat(1_000),
      ]);
      expect(long).toBeGreaterThan(unrelatedLong as number);
    },
    TIMEOUT,
  );

  it(
    "fits the longest pair into the model's window with both separators intact",
    async () => {
      const tokenizer = await AutoTokenizer.from_pretrained(
        DEFAULT_RERANKER_PRESET.repository,
        {
          revision: DEFAULT_RERANKER_PRESET.revision,
          cache_dir: join(root, "models"),
        },
      );
      const query = "how do I rotate the production API keys? ".repeat(200);
      const fitter = createPairFitter(
        tokenizer,
        query,
        DEFAULT_RERANKER_PRESET.maxTokens,
      );
      const pair = tokenizer.encode(fitter.query, {
        text_pair: fitter.fitPassage("rotate the keys regularly. ".repeat(500)),
      });
      expect(pair).toHaveLength(DEFAULT_RERANKER_PRESET.maxTokens);
      const separator = tokenizer.encode("", { add_special_tokens: true })[1];
      expect(pair.filter((id) => id === separator)).toHaveLength(2);
    },
    TIMEOUT,
  );

  it(
    "rejects an empty passage instead of scoring the bare query",
    async () => {
      const failure = rerankerFor().rerank("rotate api keys", [
        "A real passage.",
        "   ",
      ]);
      await expect(failure).rejects.toThrow(RerankerError);
      await expect(failure).rejects.toThrow(/empty passage \(passage 1\)/);
    },
    TIMEOUT,
  );

  it(
    "gives null to a passage the tokenizer strips to nothing and still scores the rest",
    async () => {
      const scores = await rerankerFor().rerank("rotate api keys", [
        "Rotate API keys from the dashboard.",
        "\u200b\u200b\u200b",
        "Lunch is served at noon.",
      ]);
      expect(scores[1]).toBeNull();
      expect(scores[0]).toBeGreaterThan(scores[2] ?? Number.NaN);
    },
    TIMEOUT,
  );

  it(
    "rejects an empty query instead of scoring noise",
    async () => {
      const failure = rerankerFor().rerank("  ", ["A real passage."]);
      await expect(failure).rejects.toThrow(RerankerError);
      await expect(failure).rejects.toThrow(/empty query/);
    },
    TIMEOUT,
  );

  it(
    "rejects a passage that isn't a string with a RerankerError",
    async () => {
      const failure = rerankerFor().rerank("q", [
        undefined as unknown as string,
      ]);
      await expect(failure).rejects.toThrow(RerankerError);
    },
    TIMEOUT,
  );

  it(
    "fails with an actionable error when remote models are disabled and the cache is empty",
    async () => {
      const failure = createTransformersReranker(
        loadConfig({
          sourceDir: join(root, "docs"),
          targetDir: join(root, "engine-offline"),
          modelsDir: join(root, "empty-models"),
          allowRemoteModels: false,
        }),
      ).rerank("q", ["p"]);
      await expect(failure).rejects.toThrow(RerankerError);
      await expect(failure).rejects.toThrow(
        /ms-marco-MiniLM-L-6-v2@a0914435.*empty-models.*remote models are disabled/s,
      );
    },
    TIMEOUT,
  );
});
