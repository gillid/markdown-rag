import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { count, search } from "@orama/orama";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStructuralChunker } from "../../src/chunking/structural-chunker.ts";
import { loadConfig } from "../../src/config/config.ts";
import { loadKnowledgeBase } from "../../src/contract/loader.ts";
import { buildIndex, IndexBuildError } from "../../src/index/build-index.ts";
import { embedKnowledgeBase } from "../../src/sidecars/embed.ts";
import { readSidecarEntries } from "../../src/sidecars/read-entries.ts";
import { readSidecar } from "../../src/sidecars/store.ts";
import {
  createCountingEmbedder,
  createParagraphChunker,
  writeDoc,
} from "../support/embed-fakes.ts";

const EXAMPLES = join(import.meta.dirname, "..", "..", "examples", "docs");
// A fake embedder must carry a preset's ID and dims for the freshness check to accept it.
const MODEL = { modelId: "bge-small-en-v1.5", dims: 384 };

describe("buildIndex", () => {
  let root: string;
  let sourceDir: string;
  let targetDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "md-rag-index-"));
    sourceDir = join(root, "kb");
    targetDir = join(root, "engine");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function embed(source: string, paragraphChunks = false) {
    const config = loadConfig({ sourceDir: source, targetDir });
    const knowledgeBase = await loadKnowledgeBase(config);
    const report = await embedKnowledgeBase({
      targetDir,
      knowledgeBase,
      embedder: createCountingEmbedder(MODEL),
      chunker: paragraphChunks
        ? createParagraphChunker()
        : createStructuralChunker(),
    });
    expect(report.failures).toEqual([]);
  }

  async function build(source: string) {
    const config = loadConfig({ sourceDir: source, targetDir });
    const knowledgeBase = await loadKnowledgeBase(config);
    return buildIndex(
      knowledgeBase,
      await readSidecarEntries(targetDir, knowledgeBase),
    );
  }

  it("indexes every chunk of every document in examples/docs", async () => {
    await embed(EXAMPLES);

    const index = await build(EXAMPLES);

    const knowledgeBase = await loadKnowledgeBase(
      loadConfig({ sourceDir: EXAMPLES, targetDir }),
    );
    let chunksOnDisk = 0;
    for (const doc of knowledgeBase.documents) {
      const sidecar = await readSidecar(targetDir, doc.path);
      expect(index.documents.get(doc.path)?.chunks).toHaveLength(
        sidecar?.chunks.length ?? -1,
      );
      chunksOnDisk += sidecar?.chunks.length ?? 0;
    }
    const markdownFiles = (await readdir(EXAMPLES, { recursive: true })).filter(
      (file) => file.endsWith(".md"),
    );
    expect(index.documents.size).toBe(markdownFiles.length);
    expect(chunksOnDisk).toBeGreaterThan(markdownFiles.length);
    expect(count(index.orama)).toBe(chunksOnDisk);
    expect(index.model).toEqual(MODEL);
  });

  describe("on a small knowledge base", () => {
    beforeEach(async () => {
      await writeDoc(sourceDir, "runbooks/db/failover.md", [
        "# Failover",
        "Promote the replica.",
      ]);
      await writeDoc(sourceDir, "readme.md", ["Top level text."]);
      await embed(sourceDir, true);
    });

    it("stores each chunk's text, ordinal and its document's fields", async () => {
      const index = await build(sourceDir);

      const { hits } = await search(index.orama, {
        term: "",
        where: { path: { eq: "runbooks/db/failover.md" } },
        sortBy: { property: "ordinal", order: "ASC" },
      });

      expect(
        hits.map(({ document: d }) => ({
          ordinal: d.ordinal,
          text: d.text,
          title: d.title,
          source: d.source,
          dirs: d.dirs,
          updated_at: d.updated_at,
        })),
      ).toEqual([
        {
          ordinal: 0,
          text: "# Failover",
          title: "runbooks/db/failover.md",
          source: "docs",
          dirs: ["runbooks", "runbooks/db"],
          updated_at: Date.UTC(2026, 0, 15),
        },
        {
          ordinal: 1,
          text: "Promote the replica.",
          title: "runbooks/db/failover.md",
          source: "docs",
          dirs: ["runbooks", "runbooks/db"],
          updated_at: Date.UTC(2026, 0, 15),
        },
      ]);
    });

    it("gives a top-level document no ancestor directories", async () => {
      const index = await build(sourceDir);

      const { hits } = await search(index.orama, {
        term: "",
        where: { path: { eq: "readme.md" } },
      });

      expect(hits.map((hit) => hit.document.dirs)).toEqual([[]]);
    });

    it("keeps the sidecar vectors, so a vector search finds the chunk they came from", async () => {
      const index = await build(sourceDir);
      const query =
        await createCountingEmbedder(MODEL).embedQuery("Top level text.");

      const { hits } = await search(index.orama, {
        mode: "vector",
        vector: { value: Array.from(query), property: "embedding" },
        similarity: 0,
      });

      expect(hits[0]?.document.path).toBe("readme.md");
    });

    it("keeps a per-document summary, outline and ordered chunks", async () => {
      const index = await build(sourceDir);

      const failover = index.documents.get("runbooks/db/failover.md");

      expect(failover?.summary).toEqual({
        ref: "runbooks/db/failover.md",
        path: "runbooks/db/failover.md",
        title: "runbooks/db/failover.md",
        source: "docs",
        tags: [],
        updatedAt: Date.UTC(2026, 0, 15),
        url: undefined,
        signals: {},
        meta: {},
      });
      expect(failover?.outline).toEqual([
        { depth: 1, text: "Failover", anchor: "failover" },
      ]);
      expect(failover?.chunks.map((c) => [c.ordinal, c.text])).toEqual([
        [0, "# Failover"],
        [1, "Promote the replica."],
      ]);
    });

    it("reports a version that changes when a document is edited and re-embedded", async () => {
      const before = (await build(sourceDir)).version;
      const file = join(sourceDir, "readme.md");
      await writeFile(
        file,
        `${(await readFile(file, "utf8")).trimEnd()} Edited.\n`,
        "utf8",
      );
      await embed(sourceDir, true);

      const after = (await build(sourceDir)).version;

      expect(before).toMatch(/^[0-9a-f]{64}$/);
      expect(after).toMatch(/^[0-9a-f]{64}$/);
      expect(after).not.toBe(before);
    });

    it("reports a sidecar whose vectors cannot be decoded as an index build error", async () => {
      const file = join(targetDir, "vectors", "readme.md.vec.json");
      const sidecar = JSON.parse(await readFile(file, "utf8"));
      sidecar.chunks[0].vector = "!".repeat(sidecar.chunks[0].vector.length);
      await writeFile(file, JSON.stringify(sidecar), "utf8");

      const error = await build(sourceDir).catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(IndexBuildError);
      expect((error as IndexBuildError).problems).toEqual([
        {
          path: "readme.md",
          reason: expect.stringContaining("invalid sidecar"),
        },
      ]);
    });

    it("refuses to build when a document fails the contract, rather than leaving it out", async () => {
      await writeFile(join(sourceDir, "bad.md"), "no frontmatter\n", "utf8");

      const error = await build(sourceDir).catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(IndexBuildError);
      expect((error as IndexBuildError).problems).toEqual([
        { path: "bad.md", reason: expect.stringContaining("frontmatter") },
      ]);
    });

    it("reports a sidecar whose chunk does not match the document text", async () => {
      const file = join(targetDir, "vectors", "readme.md.vec.json");
      const sidecar = JSON.parse(await readFile(file, "utf8"));
      sidecar.chunks[0].hash = "0".repeat(64);
      await writeFile(file, JSON.stringify(sidecar), "utf8");

      const error = await build(sourceDir).catch((cause: unknown) => cause);

      expect((error as IndexBuildError).problems).toEqual([
        {
          path: "readme.md",
          reason: expect.stringContaining("does not match the document text"),
        },
      ]);
    });

    it("reports a contract failure and an undecodable sidecar together", async () => {
      await writeFile(join(sourceDir, "bad.md"), "no frontmatter\n", "utf8");
      const file = join(targetDir, "vectors", "readme.md.vec.json");
      const sidecar = JSON.parse(await readFile(file, "utf8"));
      sidecar.chunks[0].vector = "!".repeat(sidecar.chunks[0].vector.length);
      await writeFile(file, JSON.stringify(sidecar), "utf8");

      const error = await build(sourceDir).catch((cause: unknown) => cause);

      expect((error as IndexBuildError).problems.map((p) => p.path)).toEqual([
        "bad.md",
        "readme.md",
      ]);
    });

    it("refuses to build when a sidecar is stale", async () => {
      const file = join(sourceDir, "readme.md");
      await writeFile(
        file,
        `${(await readFile(file, "utf8")).trimEnd()} Edited.\n`,
        "utf8",
      );

      const error = await build(sourceDir).catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(IndexBuildError);
      expect((error as IndexBuildError).problems).toEqual([
        {
          path: "readme.md",
          reason: expect.stringContaining("stale sidecar"),
        },
      ]);
    });
  });

  it("builds an empty index for a knowledge base with no documents", async () => {
    await writeFile(join(root, ".keep"), "", "utf8");
    const index = await build(root);

    expect(index.documents.size).toBe(0);
    expect(index.model).toBeUndefined();
    expect(count(index.orama)).toBe(0);
  });
});
