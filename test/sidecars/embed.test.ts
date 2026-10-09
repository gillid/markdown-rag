import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/config.ts";
import { loadKnowledgeBase } from "../../src/contract/loader.ts";
import {
  type Embedder,
  EmbedderUnavailableError,
} from "../../src/models/embedder.ts";
import { embedKnowledgeBase } from "../../src/sidecars/embed.ts";
import { readSidecar, sidecarPath } from "../../src/sidecars/store.ts";
import {
  createCountingEmbedder,
  createParagraphChunker,
  writeDoc,
} from "../support/embed-fakes.ts";

describe("embedKnowledgeBase", () => {
  let root: string;
  let sourceDir: string;
  let targetDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "markdown-rag-embed-"));
    sourceDir = join(root, "kb");
    targetDir = join(root, "engine");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function embed(
    embedder: Embedder,
    chunker = createParagraphChunker(),
    options: { rechunk?: boolean } = {},
  ) {
    const knowledgeBase = await loadKnowledgeBase(
      loadConfig({ sourceDir, targetDir }),
    );
    return embedKnowledgeBase({
      targetDir,
      knowledgeBase,
      embedder,
      chunker,
      ...options,
    });
  }

  it("writes a sidecar per document and creates the git-ignored engine folder", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha one", "alpha two"]);
    await writeDoc(sourceDir, "nested/b.md", ["beta"]);
    const embedder = createCountingEmbedder();

    const report = await embed(embedder);

    expect(report).toEqual({
      written: 2,
      upToDate: 0,
      pruned: 0,
      chunksEmbedded: 3,
      chunksReused: 0,
      failures: [],
      warnings: [],
      skipped: 0,
    });
    expect(embedder.embeddedTexts.sort()).toEqual([
      "alpha one",
      "alpha two",
      "beta",
    ]);
    const sidecar = await readSidecar(targetDir, "a.md");
    expect(sidecar).toMatchObject({
      chunker: "paragraphs@1",
      model: "fake-model",
      dims: 4,
    });
    expect(sidecar?.chunks.map((chunk) => chunk.breadcrumb)).toEqual([
      "a.md",
      "a.md",
    ]);
    expect(await readSidecar(targetDir, "nested/b.md")).toBeDefined();
    expect(await readFile(join(targetDir, ".gitignore"), "utf8")).toBe("*\n");
  });

  it("embeds the chunks of several documents in one batch", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha"]);
    await writeDoc(sourceDir, "b.md", ["beta"]);
    await writeDoc(sourceDir, "c.md", ["gamma"]);
    const embedder = createCountingEmbedder();

    await embed(embedder);

    expect(embedder.batchSizes).toEqual([3]);
  });

  it("does nothing on a second run over unchanged documents", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha"]);
    await embed(createCountingEmbedder());
    const embedder = createCountingEmbedder();
    const chunker = createParagraphChunker();

    const report = await embed(embedder, chunker);

    expect(report).toMatchObject({
      written: 0,
      upToDate: 1,
      chunksEmbedded: 0,
    });
    expect(embedder.batchSizes).toEqual([]);
    expect(chunker.calls).toBe(0);
  });

  it("processes only the edited document and embeds only its changed chunks", async () => {
    await writeDoc(sourceDir, "a.md", [
      "alpha one",
      "alpha two",
      "alpha three",
    ]);
    await writeDoc(sourceDir, "b.md", ["beta"]);
    await embed(createCountingEmbedder());
    await writeDoc(sourceDir, "a.md", [
      "alpha one",
      "alpha TWO",
      "alpha three",
    ]);
    const embedder = createCountingEmbedder();

    const report = await embed(embedder);

    expect(report).toMatchObject({
      written: 1,
      upToDate: 1,
      chunksEmbedded: 1,
      chunksReused: 2,
    });
    expect(embedder.embeddedTexts).toEqual(["alpha TWO"]);
    const sidecar = await readSidecar(targetDir, "a.md");
    expect(sidecar?.chunks).toHaveLength(3);
  });

  it("prunes the sidecar of a deleted document and the folder it leaves empty", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha"]);
    await writeDoc(sourceDir, "nested/b.md", ["beta"]);
    await embed(createCountingEmbedder());
    await rm(join(sourceDir, "nested"), { recursive: true });

    const report = await embed(createCountingEmbedder());

    expect(report).toMatchObject({ written: 0, upToDate: 1, pruned: 1 });
    expect(await readSidecar(targetDir, "nested/b.md")).toBeUndefined();
    await expect(
      stat(join(targetDir, "vectors", "nested")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readSidecar(targetDir, "a.md")).toBeDefined();
  });

  it("re-embeds the recorded chunks, without re-chunking, when the model differs", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha one", "alpha two"]);
    await embed(createCountingEmbedder());
    const before = await readSidecar(targetDir, "a.md");
    const embedder = createCountingEmbedder({ modelId: "other-model" });
    const chunker = createParagraphChunker();

    const report = await embed(embedder, chunker);

    expect(report).toMatchObject({
      written: 1,
      chunksEmbedded: 2,
      chunksReused: 0,
    });
    expect(chunker.calls).toBe(0);
    expect(embedder.embeddedTexts).toEqual(["alpha one", "alpha two"]);
    const after = await readSidecar(targetDir, "a.md");
    expect(after?.model).toBe("other-model");
    expect(after?.chunker).toBe("paragraphs@1");
    expect(after?.chunks.map((c) => [c.start, c.end, c.hash])).toEqual(
      before?.chunks.map((c) => [c.start, c.end, c.hash]),
    );
  });

  it("re-chunks a sidecar built by another chunker, reusing the vectors of unchanged chunks", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha"]);
    await embed(createCountingEmbedder());
    const chunker = { ...createParagraphChunker(), id: "paragraphs@2" };
    const embedder = createCountingEmbedder();

    const report = await embed(embedder, chunker);

    expect(report).toMatchObject({
      written: 1,
      upToDate: 0,
      chunksEmbedded: 0,
      chunksReused: 1,
    });
    expect((await readSidecar(targetDir, "a.md"))?.chunker).toBe(
      "paragraphs@2",
    );
  });

  it("fails a document whose chunker leaves text in no chunk, writing no sidecar", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha", "beta"]);
    const paragraphs = createParagraphChunker();
    const chunker = {
      ...paragraphs,
      id: "partial@1",
      async chunk(doc: Parameters<typeof paragraphs.chunk>[0]) {
        return (await paragraphs.chunk(doc)).slice(0, 1);
      },
    };

    const report = await embed(createCountingEmbedder(), chunker);

    expect(report).toMatchObject({ written: 0, upToDate: 0 });
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.reason).toMatch(
      /^chunker partial@1: the document text between offsets \d+ and \d+ is in no chunk$/,
    );
    expect(await readSidecar(targetDir, "a.md")).toBeUndefined();
  });

  it("rebuilds a header-fresh sidecar whose chunks no longer match the document", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha"]);
    await embed(createCountingEmbedder());
    const path = join(targetDir, "vectors", "a.md.vec.json");
    const damaged = JSON.parse(await readFile(path, "utf8"));
    damaged.chunks[0].hash = "0".repeat(64);
    await writeFile(path, JSON.stringify(damaged));

    const report = await embed(createCountingEmbedder());

    expect(report).toMatchObject({ written: 1, upToDate: 0, failures: [] });
  });

  it("re-chunks up-to-date documents with rechunk, reusing the vectors", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha one", "alpha two"]);
    await embed(createCountingEmbedder());
    const chunker = { ...createParagraphChunker(), id: "paragraphs@2" };
    const embedder = createCountingEmbedder();

    const report = await embed(embedder, chunker, { rechunk: true });

    expect(report).toMatchObject({
      written: 1,
      chunksEmbedded: 0,
      chunksReused: 2,
    });
    expect(embedder.embeddedTexts).toEqual([]);
    expect((await readSidecar(targetDir, "a.md"))?.chunker).toBe(
      "paragraphs@2",
    );
  });

  it("reports a document the embedder fails on and still writes every other sidecar", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha"]);
    await writeDoc(sourceDir, "bad.md", ["alpha"]);
    await embed(createCountingEmbedder());
    const stale = await readSidecar(targetDir, "bad.md");
    await writeDoc(sourceDir, "a.md", ["alpha edited"]);
    await writeDoc(sourceDir, "bad.md", ["alpha BOOM"]);

    const report = await embed(createCountingEmbedder({ failOn: "BOOM" }));

    expect(report.written).toBe(1);
    expect(report.failures).toEqual([
      { path: "bad.md", reason: 'cannot embed "BOOM"' },
    ]);
    expect((await readSidecar(targetDir, "a.md"))?.chunks).toHaveLength(1);
    expect(await readSidecar(targetDir, "bad.md")).toEqual(stale);
  });

  it("reports a document failure when the embedder returns the wrong number of vectors", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha one", "alpha two"]);
    const embedder: Embedder = {
      ...createCountingEmbedder(),
      embedDocuments: async () => [Float32Array.of(0, 0, 0, 0)],
    };

    const report = await embed(embedder);

    expect(report.failures).toEqual([
      {
        path: "a.md",
        reason: "the embedder returned 1 vectors for 2 chunks",
      },
    ]);
  });

  it("restores an edited .gitignore in the engine folder", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha"]);
    await embed(createCountingEmbedder());
    await writeFile(join(targetDir, ".gitignore"), "!vectors\n");

    await embed(createCountingEmbedder());

    expect(await readFile(join(targetDir, ".gitignore"), "utf8")).toBe("*\n");
  });

  it("rebuilds a corrupt sidecar", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha"]);
    await embed(createCountingEmbedder());
    await writeFile(sidecarPath(targetDir, "a.md"), "{ not json", "utf8");

    const report = await embed(createCountingEmbedder());

    expect(report).toMatchObject({ written: 1, chunksEmbedded: 1 });
    expect(await readSidecar(targetDir, "a.md")).toBeDefined();
  });

  it("keeps the sidecar of a document that currently fails the contract", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha"]);
    await embed(createCountingEmbedder());
    await writeFile(join(sourceDir, "a.md"), "no frontmatter\n", "utf8");

    const report = await embed(createCountingEmbedder());

    expect(report).toMatchObject({ written: 0, pruned: 0 });
    expect(await readSidecar(targetDir, "a.md")).toBeDefined();
  });
  it("embeds a chunk repeated within a document once", async () => {
    await writeDoc(sourceDir, "a.md", ["same", "other", "same"]);
    const embedder = createCountingEmbedder();

    const report = await embed(embedder);

    expect(embedder.embeddedTexts).toEqual(["same", "other"]);
    expect(report.chunksEmbedded).toBe(3);
    expect((await readSidecar(targetDir, "a.md"))?.chunks).toHaveLength(3);
  });

  it("stops instead of retrying per document when the model is unavailable, and still reports", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha"]);
    await writeDoc(sourceDir, "b.md", ["beta"]);
    let calls = 0;
    const embedder: Embedder = {
      ...createCountingEmbedder(),
      embedDocuments: async () => {
        calls++;
        throw new EmbedderUnavailableError("model is not cached");
      },
    };

    const report = await embed(embedder);

    expect(calls).toBe(1);
    expect(report.modelError).toBe("model is not cached");
    expect(report.written).toBe(0);
    expect(report.skipped).toBe(2);
  });

  it("reports a sidecar that cannot be read as a document failure", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha"]);
    await writeDoc(sourceDir, "b.md", ["beta"]);
    await mkdir(sidecarPath(targetDir, "a.md"), { recursive: true });

    const report = await embed(createCountingEmbedder());

    expect(report.written).toBe(1);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.path).toBe("a.md");
  });

  it("removes leftover temp files from interrupted writes", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha"]);
    await embed(createCountingEmbedder());
    const leftover = join(
      targetDir,
      "vectors",
      ".0a1b2c3d-0000-4000-8000-0123456789ab.tmp",
    );
    await writeFile(leftover, "partial", "utf8");

    await embed(createCountingEmbedder());

    await expect(stat(leftover)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("leaves other files under vectors/ alone", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha"]);
    await embed(createCountingEmbedder());
    const other = join(targetDir, "vectors", "cache.tmp");
    await writeFile(other, "keep", "utf8");

    await embed(createCountingEmbedder());

    expect(await readFile(other, "utf8")).toBe("keep");
  });

  it("rebuilds a sidecar whose vectors have the wrong size", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha"]);
    await embed(createCountingEmbedder());
    const path = sidecarPath(targetDir, "a.md");
    const damaged = JSON.parse(await readFile(path, "utf8"));
    damaged.chunks[0].vector = damaged.chunks[0].vector.slice(0, 4);
    await writeFile(path, JSON.stringify(damaged), "utf8");
    const embedder = createCountingEmbedder();

    const report = await embed(embedder);

    expect(report).toMatchObject({ written: 1, upToDate: 0 });
    expect(embedder.embeddedTexts).toEqual(["alpha"]);
  });

  it("does not prune when the run ended because the model is unavailable", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha"]);
    await writeDoc(sourceDir, "gone.md", ["gone"]);
    await embed(createCountingEmbedder());
    await rm(join(sourceDir, "gone.md"));
    await writeDoc(sourceDir, "a.md", ["alpha edited"]);
    const embedder: Embedder = {
      ...createCountingEmbedder(),
      embedDocuments: async () => {
        throw new EmbedderUnavailableError("model is not cached");
      },
    };

    const report = await embed(embedder);

    expect(report.pruned).toBe(0);
    expect(await readSidecar(targetDir, "gone.md")).toBeDefined();
  });

  it.runIf(isCaseInsensitiveFileSystem())(
    "keeps the sidecar of a document renamed only by case",
    async () => {
      await writeDoc(sourceDir, "Guide.md", ["alpha"]);
      await embed(createCountingEmbedder());
      await rm(join(sourceDir, "Guide.md"));
      await writeDoc(sourceDir, "guide.md", ["alpha"]);

      const report = await embed(createCountingEmbedder());

      expect(report.pruned).toBe(0);
      expect(await readSidecar(targetDir, "guide.md")).toBeDefined();
    },
  );

  it("does not embed a document whose sidecar path is refused before reading it", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha"]);
    const knowledgeBase = await loadKnowledgeBase(
      loadConfig({ sourceDir, targetDir }),
    );
    const [doc] = knowledgeBase.documents;
    const embedder = createCountingEmbedder();

    const report = await embedKnowledgeBase({
      targetDir,
      knowledgeBase: {
        errors: [],
        documents: doc ? [{ ...doc, path: "a\\b.md" }] : [],
      },
      embedder,
      chunker: createParagraphChunker(),
    });

    expect(report.failures).toHaveLength(1);
    expect(embedder.embeddedTexts).toEqual([]);
  });
});

function isCaseInsensitiveFileSystem(): boolean {
  const dir = mkdtempSync(join(tmpdir(), "markdown-rag-case-"));
  try {
    writeFileSync(join(dir, "A"), "");
    return existsSync(join(dir, "a"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
