import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "@huggingface/transformers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ConfigInput, loadConfig } from "../../src/config/config.ts";
import { EmbedderError } from "../../src/models/embedder.ts";
import { DEFAULT_EMBEDDING_PRESET } from "../../src/models/presets.ts";
import { createTransformersEmbedder } from "../../src/models/transformers-embedder.ts";

const TIMEOUT = 120_000;

function dot(a: Float32Array, b: Float32Array): number {
  return a.reduce((sum, value, i) => sum + value * (b[i] as number), 0);
}

describe("transformers embedder", () => {
  let root: string;
  let sharedModelsDir: string;
  let scenario = 0;

  // Every test gets its own knowledge base and engine folder; only the downloaded weights are shared.
  function embedderFor(overrides: Partial<ConfigInput> = {}) {
    const dir = join(root, `kb-${scenario++}`);
    const config = loadConfig({
      sourceDir: join(dir, "docs"),
      targetDir: join(dir, "engine"),
      modelsDir: sharedModelsDir,
      ...overrides,
    });
    return { config, embedder: createTransformersEmbedder(config) };
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "markdown-rag-embedder-"));
    sharedModelsDir = join(root, "shared-models");
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it(
    "scores a paraphrase pair above an unrelated pair",
    async () => {
      const { embedder } = embedderFor();
      const [reset, forgot, lasagna] = (await embedder.embedDocuments([
        "How do I reset my password?",
        "I forgot my login credentials and need to recover access.",
        "A recipe for baking lasagna with béchamel sauce.",
      ])) as [Float32Array, Float32Array, Float32Array];
      expect(dot(reset, forgot)).toBeGreaterThan(dot(reset, lasagna));
    },
    TIMEOUT,
  );

  it(
    "pools the CLS token, not the mean of the tokens",
    async () => {
      const { embedder } = embedderFor();
      const text = "Rotate the API keys every ninety days.";
      const extractor = await pipeline(
        "feature-extraction",
        DEFAULT_EMBEDDING_PRESET.repository,
        {
          revision: DEFAULT_EMBEDDING_PRESET.revision,
          dtype: "q8",
          cache_dir: sharedModelsDir,
        },
      );
      const cls = await extractor([text], { pooling: "cls", normalize: true });
      const mean = await extractor([text], {
        pooling: "mean",
        normalize: true,
      });
      const [vector] = await embedder.embedDocuments([text]);
      const embedded = vector as Float32Array;
      expect(dot(embedded, cls.data as Float32Array)).toBeGreaterThan(0.999);
      expect(dot(embedded, mean.data as Float32Array)).toBeLessThan(0.99);
    },
    TIMEOUT,
  );

  it(
    "returns 384-dimensional L2-normalised vectors",
    async () => {
      const { embedder } = embedderFor();
      const [document] = await embedder.embedDocuments([
        "Rotate the API keys.",
      ]);
      const query = await embedder.embedQuery("rotate api keys");
      for (const vector of [document as Float32Array, query]) {
        expect(vector).toHaveLength(384);
        expect(Math.hypot(...vector)).toBeCloseTo(1, 5);
      }
      expect(embedder.dims).toBe(384);
      expect(embedder.modelId).toBe("bge-small-en-v1.5-q8");
    },
    TIMEOUT,
  );

  it(
    "applies the instruction prefix to queries only",
    async () => {
      const { embedder } = embedderFor();
      const text = "rotate api keys";
      const { queryPrefix } = DEFAULT_EMBEDDING_PRESET;
      const [prefixed, plain] = (await embedder.embedDocuments([
        queryPrefix + text,
        text,
      ])) as [Float32Array, Float32Array];
      const asQuery = await embedder.embedQuery(text);
      expect(asQuery).toEqual(prefixed);
      expect(dot(asQuery, prefixed)).toBeGreaterThan(dot(asQuery, plain));
    },
    TIMEOUT,
  );

  it(
    "gives a document the same vector whatever it is batched with",
    async () => {
      const { embedder } = embedderFor();
      const text = "Rotate the API keys.";
      const [alone] = await embedder.embedDocuments([text]);
      const [withNeighbour] = await embedder.embedDocuments([
        text,
        "A much longer neighbouring passage about rotating keys. ".repeat(20),
      ]);
      expect(withNeighbour).toEqual(alone);
    },
    TIMEOUT,
  );

  it(
    "rejects a query past the model's window, advising about the query",
    async () => {
      const { embedder } = embedderFor();
      const tooLong = "rotate ".repeat(DEFAULT_EMBEDDING_PRESET.maxTokens);
      await expect(embedder.embedQuery(tooLong)).rejects.toThrow(
        /The query is \d+ tokens, over the 512-token window/,
      );
    },
    TIMEOUT,
  );

  it(
    "rejects a chunk past the model's window instead of truncating it",
    async () => {
      const { embedder } = embedderFor();
      const tooLong = "rotate ".repeat(DEFAULT_EMBEDDING_PRESET.maxTokens);
      await expect(embedder.embedDocuments([tooLong])).rejects.toThrow(
        /A chunk of \d+ tokens .* exceeds the 512-token window/,
      );
    },
    TIMEOUT,
  );

  it(
    "fails fast when the model returns a different width than the preset declares",
    async () => {
      const { config } = embedderFor();
      const wrongDims = createTransformersEmbedder(config, {
        ...DEFAULT_EMBEDDING_PRESET,
        dims: 10,
      });
      await expect(wrongDims.embedQuery("anything")).rejects.toThrow(
        EmbedderError,
      );
    },
    TIMEOUT,
  );

  describe("cache directory", () => {
    it(
      "creates the engine folder with its .gitignore when the default cache lives inside it",
      async () => {
        const dir = join(root, "default-cache");
        const config = loadConfig({
          sourceDir: join(dir, "docs"),
          targetDir: join(dir, "engine"),
        });
        await createTransformersEmbedder(config).embedQuery("warm");
        expect(await readFile(join(dir, "engine", ".gitignore"), "utf8")).toBe(
          "*\n",
        );
      },
      TIMEOUT,
    );

    it(
      "git-ignores a shared cache outside the engine folder",
      async () => {
        const { embedder } = embedderFor({
          modelsDir: join(root, "shared-with-gitignore"),
        });
        await embedder.embedQuery("warm");
        expect(
          await readFile(
            join(root, "shared-with-gitignore", ".gitignore"),
            "utf8",
          ),
        ).toBe("*\n");
      },
      TIMEOUT,
    );

    it(
      "warns and leaves an existing .gitignore in a shared cache alone",
      async () => {
        const modelsDir = join(root, "shared-with-own-gitignore");
        await mkdir(modelsDir, { recursive: true });
        await writeFile(join(modelsDir, ".gitignore"), "*.tmp\n");
        const warnings: string[] = [];
        const onWarning = (warning: Error) => warnings.push(warning.message);
        process.on("warning", onWarning);
        try {
          await embedderFor({ modelsDir }).embedder.embedQuery("warm");
          await new Promise((resolve) => setImmediate(resolve));
        } finally {
          process.off("warning", onWarning);
        }
        expect(warnings.join("\n")).toContain(modelsDir);
        expect(await readFile(join(modelsDir, ".gitignore"), "utf8")).toBe(
          "*.tmp\n",
        );
      },
      TIMEOUT,
    );
  });

  describe("with remote models disabled", () => {
    it(
      "fails with an actionable error when the cache is empty, writing nothing",
      async () => {
        const modelsDir = join(root, "empty-models");
        const { config, embedder } = embedderFor({
          modelsDir,
          allowRemoteModels: false,
        });
        const failure = embedder.embedQuery("anything");
        await expect(failure).rejects.toThrow(EmbedderError);
        await expect(failure).rejects.toThrow(
          /bge-small-en-v1\.5@ea104dac.*empty-models.*remote models are disabled/s,
        );
        await expect(readdir(config.targetDir)).rejects.toThrow(/ENOENT/);
        await expect(readdir(modelsDir)).rejects.toThrow(/ENOENT/);
      },
      TIMEOUT,
    );

    it(
      "uses cached weights",
      async () => {
        await embedderFor().embedder.embedQuery("warm the cache");
        const { embedder } = embedderFor({ allowRemoteModels: false });
        expect(await embedder.embedQuery("rotate api keys")).toHaveLength(384);
      },
      TIMEOUT,
    );
  });
});
