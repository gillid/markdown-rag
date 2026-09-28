import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../../src/cli/main.ts";

const EXAMPLES = join(import.meta.dirname, "..", "..", "examples", "docs");

describe("md-rag check", () => {
  it("exits 0 and reports the document count for a valid knowledge base", async () => {
    const result = await run(["check", "--source-dir", EXAMPLES]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("30 document(s) passed the contract.\n");
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

  describe("against a broken knowledge base", () => {
    let root: string;

    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), "md-rag-check-"));
    });

    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it("exits 1 and lists every failing document by path", async () => {
      await writeFile(join(root, "good.md"), goodDoc("Good"), "utf8");
      await mkdir(join(root, "nested"), { recursive: true });
      await writeFile(
        join(root, "nested", "bad.md"),
        "no frontmatter here\n",
        "utf8",
      );

      const result = await run(["check", "--source-dir", root]);

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
