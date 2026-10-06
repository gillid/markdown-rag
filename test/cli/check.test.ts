import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../../src/cli/main.ts";
import { loadConfig } from "../../src/config/config.ts";
import { loadKnowledgeBase } from "../../src/contract/loader.ts";
import { embedKnowledgeBase } from "../../src/sidecars/embed.ts";
import { deleteSidecar } from "../../src/sidecars/store.ts";
import {
  createCountingEmbedder,
  createParagraphChunker,
  writeDoc,
} from "../support/embed-fakes.ts";

const EXAMPLES = join(import.meta.dirname, "..", "..", "examples", "docs");
const MODEL_ID = "bge-small-en-v1.5-q8";

// Windows and macOS resolve a renamed document's old and new spelling to one sidecar file; Linux does not.
const caseInsensitiveFs = await detectCaseInsensitiveFs();

async function detectCaseInsensitiveFs(): Promise<boolean> {
  const dir = await mkdtemp(join(tmpdir(), "md-rag-case-probe-"));
  try {
    await writeFile(join(dir, "probe"), "", "utf8");
    await access(join(dir, "PROBE"));
    return true;
  } catch {
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Generates sidecars the way `md-rag embed` does, with a fake embedder posing as the default preset. */
async function embedWithFakeModel(
  sourceDir: string,
  targetDir: string,
  modelId = MODEL_ID,
): Promise<void> {
  const config = loadConfig({ sourceDir, targetDir });
  const report = await embedKnowledgeBase({
    targetDir,
    knowledgeBase: await loadKnowledgeBase(config),
    embedder: createCountingEmbedder({ modelId, dims: 384 }),
    chunker: createParagraphChunker(),
  });
  expect(report.failures).toEqual([]);
}

describe("md-rag check", () => {
  let root: string;
  let targetDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "md-rag-check-"));
    targetDir = join(root, "engine");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("exits 0 and reports the document count and model for a fresh knowledge base", async () => {
    await embedWithFakeModel(EXAMPLES, targetDir);

    const result = await run([
      "check",
      "--source-dir",
      EXAMPLES,
      "--target-dir",
      targetDir,
    ]);

    expect(result).toEqual({
      exitCode: 0,
      stdout: `30 document(s) passed the contract; sidecars are fresh (model ${MODEL_ID}).\n`,
      stderr: "",
    });
  });

  describe("a sidecar whose header is fresh but whose contents are damaged", () => {
    async function checkAfterDamage(
      damage: (sidecar: { chunks: Record<string, unknown>[] }) => void,
    ) {
      const sourceDir = join(root, "kb");
      await writeDoc(sourceDir, "a.md", ["alpha"]);
      await embedWithFakeModel(sourceDir, targetDir);
      const path = join(targetDir, "vectors", "a.md.vec.json");
      const sidecar = JSON.parse(await readFile(path, "utf8"));
      damage(sidecar);
      await writeFile(path, JSON.stringify(sidecar));
      return run([
        "check",
        "--source-dir",
        sourceDir,
        "--target-dir",
        targetDir,
      ]);
    }

    it("exits 1 when a chunk no longer matches the document text", async () => {
      const result = await checkAfterDamage((sidecar) => {
        sidecar.chunks[0].hash = "0".repeat(64);
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "invalid sidecar: chunk 0 does not match the document text; run md-rag embed",
      );
    });

    it("exits 1 when a vector holds a non-finite value", async () => {
      // 1,024 base64 characters decode to 384 float16 values; all-ones bits are NaN.
      const result = await checkAfterDamage((sidecar) => {
        sidecar.chunks[0].vector = "/".repeat(1024);
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("non-finite");
    });
  });

  it("passes an empty knowledge base even though embed never created a sidecar folder", async () => {
    const emptyDir = join(root, "empty");
    await mkdir(emptyDir);

    const result = await run([
      "check",
      "--source-dir",
      emptyDir,
      "--target-dir",
      targetDir,
    ]);

    expect(result).toEqual({
      exitCode: 0,
      stdout: "0 document(s) passed the contract; no sidecars to check.\n",
      stderr: "",
    });
  });

  it("exits 1 when --source-dir is missing", async () => {
    const result = await run(["check"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--source-dir is required");
  });

  it("exits 1 on an unknown flag", async () => {
    const result = await run(["check", "--bogus"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Usage: md-rag check");
  });

  it("exits 0 and prints usage with --help", async () => {
    const result = await run(["check", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: md-rag check");
  });

  it("exits 1 with a clean error for a non-existent --source-dir", async () => {
    const missing = join(tmpdir(), "md-rag-check-does-not-exist");
    const result = await run(["check", "--source-dir", missing]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("check:");
  });

  describe("sidecar freshness", () => {
    let sourceDir: string;

    beforeEach(async () => {
      sourceDir = join(root, "kb");
      await writeDoc(sourceDir, "a.md", ["alpha"]);
      await writeDoc(sourceDir, "nested/b.md", ["beta"]);
    });

    const check = () =>
      run(["check", "--source-dir", sourceDir, "--target-dir", targetDir]);

    it("fails and names the directory when embed has never run", async () => {
      const result = await check();

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(join(targetDir, "vectors"));
      expect(result.stderr).toContain("md-rag embed");
      expect(result.stderr).toContain("--target-dir");
    });

    it("still reports contract errors when embed has never run", async () => {
      await writeFile(join(sourceDir, "bad.md"), "no frontmatter\n", "utf8");

      const result = await check();

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("bad.md:");
      expect(result.stderr).toContain(
        "1 of 3 document(s) failed the contract.",
      );
      expect(result.stderr).toContain(join(targetDir, "vectors"));
    });

    it("reports a document that has no sidecar", async () => {
      await embedWithFakeModel(sourceDir, targetDir);
      await deleteSidecar(targetDir, "nested/b.md");

      const result = await check();

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe(
        "nested/b.md: sidecar missing; run md-rag embed\n\n1 path(s) with sidecar problems.\n",
      );
    });

    it("reports a document edited after embed as stale", async () => {
      await embedWithFakeModel(sourceDir, targetDir);
      await writeDoc(sourceDir, "a.md", ["alpha, edited"]);

      const result = await check();

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("a.md: stale sidecar");
    });

    it("reports the sidecar of a deleted document as an orphan", async () => {
      await embedWithFakeModel(sourceDir, targetDir);
      await rm(join(sourceDir, "a.md"));

      const result = await check();

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("a.md: orphaned sidecar");
    });

    it("reports sidecars built with a model the engine has no preset for", async () => {
      await embedWithFakeModel(sourceDir, targetDir, "some-other-model");

      const result = await check();

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("no preset for the recorded model");
    });

    it("keeps the contract errors when the sidecar folder cannot be read", async () => {
      await mkdir(targetDir, { recursive: true });
      await writeFile(join(targetDir, "vectors"), "not a folder", "utf8");
      await writeFile(join(sourceDir, "bad.md"), "no frontmatter\n", "utf8");

      const result = await check();

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("bad.md:");
      expect(result.stderr).toContain("exists but is not a directory");
    });

    it.skipIf(!caseInsensitiveFs)(
      "accepts the sidecar of a case-renamed document",
      async () => {
        await embedWithFakeModel(sourceDir, targetDir);
        await rename(join(sourceDir, "a.md"), join(sourceDir, "tmp.md"));
        await rename(join(sourceDir, "tmp.md"), join(sourceDir, "A.md"));
        await embedWithFakeModel(sourceDir, targetDir);

        const result = await check();

        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
      },
    );

    it("reports contract errors and sidecar problems together", async () => {
      await embedWithFakeModel(sourceDir, targetDir);
      await deleteSidecar(targetDir, "a.md");
      await writeFile(join(sourceDir, "bad.md"), "no frontmatter\n", "utf8");

      const result = await check();

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("bad.md:");
      expect(result.stderr).toContain("a.md: sidecar missing");
    });
  });

  describe("against a broken knowledge base", () => {
    it("exits 1 and lists every failing document by path", async () => {
      await writeFile(join(root, "good.md"), goodDoc("Good"), "utf8");
      await mkdir(join(root, "nested"), { recursive: true });
      await writeFile(
        join(root, "nested", "bad.md"),
        "no frontmatter here\n",
        "utf8",
      );

      const result = await run([
        "check",
        "--source-dir",
        root,
        "--target-dir",
        join(root, ".md-rag"),
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("nested/bad.md:");
      expect(result.stderr).toContain(
        "1 of 2 document(s) failed the contract.",
      );
    });
  });
});

function goodDoc(title: string): string {
  return [
    "---",
    `title: "${title}"`,
    "source: docs",
    'updated_at: "2026-01-15"',
    "---",
    "",
    `# ${title}`,
    "",
  ].join("\n");
}
