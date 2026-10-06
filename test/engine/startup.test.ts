import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createEngine,
  InvalidRequestError,
  ModelsNotLoadedError,
} from "../../src/engine/index.ts";
import { startEngine } from "../../src/engine/start-engine.ts";
import { IndexBuildError } from "../../src/index/build-index.ts";
import { embedTestSidecars, MODEL } from "../support/build-test-index.ts";
import { createCountingEmbedder } from "../support/embed-fakes.ts";
import {
  engineOver,
  frontmatter,
  overlapReranker,
  scratchKnowledgeBases,
  writeMarkdown,
} from "../support/engine-fixtures.ts";

describe("engine startup", () => {
  const kbs = scratchKnowledgeBases("md-rag-engine-startup-");
  const freshKnowledgeBase = kbs.fresh;
  it("refuses to start with a default weight for an undeclared signal", async () => {
    const dir = await freshKnowledgeBase("weights");
    await writeMarkdown(dir, "a.md", frontmatter(), "Alpha.");

    await expect(
      engineOver(kbs.workDir("weights"), dir, { weights: { authority: 0.1 } }),
    ).rejects.toThrow(/authority/);
  });

  it("refuses to start without sidecars, naming md-rag embed", async () => {
    const dir = await freshKnowledgeBase("unembedded");
    await writeMarkdown(dir, "a.md", frontmatter(), "Alpha.");

    await expect(
      createEngine({
        sourceDir: dir,
        targetDir: join(kbs.workDir("unembedded"), "engine"),
      }),
    ).rejects.toThrow(/md-rag embed/);
  });

  it("refuses to start once a document has changed since it was embedded", async () => {
    const dir = await freshKnowledgeBase("stale");
    await writeMarkdown(dir, "a.md", frontmatter(), "Alpha.");
    const targetDir = join(kbs.workDir("stale"), "engine");
    await embedTestSidecars(dir, targetDir);
    await writeMarkdown(dir, "a.md", frontmatter(), "Alpha, edited.");

    await expect(createEngine({ sourceDir: dir, targetDir })).rejects.toThrow(
      IndexBuildError,
    );
  });

  async function embeddedKnowledgeBase(name: string) {
    const dir = await freshKnowledgeBase(name);
    await writeMarkdown(dir, "a.md", frontmatter(), "Alpha.");
    const targetDir = join(kbs.workDir(name), "engine");
    await embedTestSidecars(dir, targetDir);
    return { sourceDir: dir, targetDir };
  }

  it("has warmed up both models by the time it resolves", async () => {
    const config = await embeddedKnowledgeBase("warm");
    const warmed: string[] = [];
    await startEngine(config, {
      embedder: {
        ...createCountingEmbedder(MODEL),
        embedQuery: async () => {
          warmed.push("embedder");
          return new Float32Array(MODEL.dims);
        },
      },
      reranker: {
        ...overlapReranker,
        rerank: async (_query, passages) => {
          warmed.push("reranker");
          return passages.map(() => 0);
        },
      },
    });

    expect([...warmed].sort()).toEqual(["embedder", "reranker"]);
  });

  it("refuses to start when a model can't be loaded", async () => {
    const config = await embeddedKnowledgeBase("unloadable");

    await expect(
      startEngine(config, {
        embedder: createCountingEmbedder(MODEL),
        reranker: {
          ...overlapReranker,
          rerank: async () => {
            throw new Error("weights are missing");
          },
        },
      }),
    ).rejects.toThrow(/weights are missing/);
  });

  it("reads documents without touching a model when created with loadModels: false", async () => {
    const config = await embeddedKnowledgeBase("unranked");
    const engine = await createEngine(config, { loadModels: false });

    expect((await engine.listDocuments()).total).toBe(1);
    expect((await engine.overview()).documents).toBe(1);
    expect((await engine.getDocument("a.md")).ref).toBe("a.md");
    await expect(engine.search({ query: "alpha" })).rejects.toThrow(
      ModelsNotLoadedError,
    );
  });

  it("still checks the retrieval defaults with loadModels: false", async () => {
    const config = await embeddedKnowledgeBase("unranked-weights");

    await expect(
      createEngine(
        { ...config, retrieval: { weights: { authority: 0.1 } } },
        { loadModels: false },
      ),
    ).rejects.toThrow(/authority/);
    await expect(
      createEngine(
        { ...config, retrieval: { limit: 99 } },
        { loadModels: false },
      ),
    ).rejects.toThrow(/limit/);
  });

  it("uses the options as they were when it was called", async () => {
    const config = await embeddedKnowledgeBase("options-copied");
    const options = { loadModels: false };
    const pending = createEngine(config, options);
    options.loadModels = true;

    await expect((await pending).search({ query: "alpha" })).rejects.toThrow(
      ModelsNotLoadedError,
    );
  });

  it("still refuses a stale knowledge base with loadModels: false", async () => {
    const config = await embeddedKnowledgeBase("unranked-stale");
    await writeMarkdown(config.sourceDir, "a.md", frontmatter(), "Edited.");

    await expect(createEngine(config, { loadModels: false })).rejects.toThrow(
      IndexBuildError,
    );
  });

  it("rejects an invalid configuration through the same promise", async () => {
    await expect(createEngine({ sourceDir: "" })).rejects.toThrow(/sourceDir/);
  });

  it.each([
    ["a misspelt option", { loadModel: false }],
    ["an option that would swap an internal", { embedder: {} }],
    ["a non-boolean loadModels", { loadModels: "false" }],
  ])("rejects %s in the options", async (_name, options) => {
    await expect(
      createEngine({ sourceDir: "docs" }, options as never),
    ).rejects.toThrow(InvalidRequestError);
  });

  it("lets both models finish warming up before reporting that one failed", async () => {
    const config = await embeddedKnowledgeBase("settled");
    let embedderFinished = false;

    await expect(
      startEngine(config, {
        embedder: {
          ...createCountingEmbedder(MODEL),
          embedQuery: async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            embedderFinished = true;
            return new Float32Array(MODEL.dims);
          },
        },
        reranker: {
          ...overlapReranker,
          rerank: async () => {
            throw new Error("weights are missing");
          },
        },
      }),
    ).rejects.toThrow(/weights are missing/);

    expect(embedderFinished).toBe(true);
  });
});
