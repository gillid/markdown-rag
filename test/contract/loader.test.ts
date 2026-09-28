import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/config.ts";
import { loadKnowledgeBase } from "../../src/contract/loader.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");

describe("loadKnowledgeBase against examples/docs", () => {
  it("loads every fixture document with no errors", async () => {
    const sourceDir = join(import.meta.dirname, "..", "..", "examples", "docs");
    const { documents, errors } = await loadKnowledgeBase(
      loadConfig({ sourceDir }),
    );
    expect(errors).toEqual([]);
    expect(documents).toHaveLength(30);
    expect(documents.map((d) => d.path)).toContain("api/authentication.md");
    expect(documents.every((d) => typeof d.docHash === "string")).toBe(true);
  });
});

describe("loadKnowledgeBase against static fixtures", () => {
  it("loads valid documents and reports their metadata", async () => {
    const { documents, errors } = await loadKnowledgeBase(
      loadConfig({ sourceDir: join(FIXTURES, "valid") }),
    );
    expect(errors).toEqual([]);
    expect(documents).toHaveLength(2);
    const full = documents.find((d) => d.path === "full.md");
    expect(full?.title).toBe("Full Document");
    expect(full?.tags).toEqual(["runbook", "payments"]);
    expect(full?.signals).toEqual({ authority: 0.8, curated: 1 });
    expect(full?.meta).toEqual({ source_id: "ext-123" });
  });

  it("collects an error per invalid document, keyed by path", async () => {
    const { documents, errors } = await loadKnowledgeBase(
      loadConfig({ sourceDir: join(FIXTURES, "invalid") }),
    );
    expect(documents).toEqual([]);
    const paths = errors.map((e) => e.path).sort();
    expect(paths).toEqual(
      [
        "bad-yaml.md",
        "missing-frontmatter.md",
        "missing-title.md",
        "reserved-signal-name.md",
        "signal-out-of-range.md",
        "signal-uppercase.md",
      ].sort(),
    );
    expect(errors.every((e) => e.reason.length > 0)).toBe(true);
  });
});

describe("loadKnowledgeBase walking", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "md-rag-loader-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function write(path: string, content: string): Promise<void> {
    const full = join(root, path);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content, "utf8");
  }

  const doc = (title: string) =>
    [
      "---",
      `title: "${title}"`,
      "source: docs",
      'updated_at: "2026-01-15"',
      "---",
      "",
      `# ${title}`,
      "",
    ].join("\n");

  it("finds Markdown files in nested directories and reports POSIX paths", async () => {
    await write("a.md", doc("A"));
    await write("nested/deep/b.md", doc("B"));
    const { documents, errors } = await loadKnowledgeBase(
      loadConfig({ sourceDir: root }),
    );
    expect(errors).toEqual([]);
    expect(documents.map((d) => d.path).sort()).toEqual([
      "a.md",
      "nested/deep/b.md",
    ]);
  });

  it("skips dot-directories, including the default .md-rag", async () => {
    await write("a.md", doc("A"));
    await write(".md-rag/vectors/stray.md", doc("Stray"));
    await write(".hidden/also-stray.md", doc("Also stray"));
    const { documents } = await loadKnowledgeBase(
      loadConfig({ sourceDir: root }),
    );
    expect(documents.map((d) => d.path)).toEqual(["a.md"]);
  });

  it("skips an explicit targetDir that isn't a dot-directory", async () => {
    await write("a.md", doc("A"));
    await write("index/stray.md", doc("Stray"));
    const { documents } = await loadKnowledgeBase(
      loadConfig({ sourceDir: root, targetDir: join(root, "index") }),
    );
    expect(documents.map((d) => d.path)).toEqual(["a.md"]);
  });

  it("reports a document over the 1 MB size limit as an error", async () => {
    const big = doc("Big") + "x".repeat(1024 * 1024);
    await write("big.md", big);
    const { documents, errors } = await loadKnowledgeBase(
      loadConfig({ sourceDir: root }),
    );
    expect(documents).toEqual([]);
    expect(errors).toEqual([
      { path: "big.md", reason: expect.stringContaining("size limit") },
    ]);
  });

  it("gives CRLF and LF copies of the same content the same doc_hash", async () => {
    const lf = doc("Same");
    const crlf = lf.replace(/\n/g, "\r\n");
    await write("lf.md", lf);
    await write("crlf.md", crlf);
    const { documents, errors } = await loadKnowledgeBase(
      loadConfig({ sourceDir: root }),
    );
    expect(errors).toEqual([]);
    const [a, b] = documents;
    expect(a?.docHash).toBe(b?.docHash);
  });
});
