import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runEmbed } from "../../src/cli/embed.ts";
import { run } from "../../src/cli/main.ts";
import type { Config } from "../../src/config/config.ts";
import { readSidecar } from "../../src/sidecars/store.ts";
import { createCountingEmbedder, writeDoc } from "../support/embed-fakes.ts";

describe("md-rag embed", () => {
  let root: string;
  let sourceDir: string;
  let targetDir: string;
  const configs: Config[] = [];
  const deps = {
    createEmbedder(config: Config) {
      configs.push(config);
      return createCountingEmbedder();
    },
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "md-rag-embed-cli-"));
    sourceDir = join(root, "kb");
    targetDir = join(root, "engine");
    configs.length = 0;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("is dispatched by the main CLI and prints usage with --help", async () => {
    const result = await run(["embed", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: md-rag embed");
  });

  it("exits 1 when --source-dir is missing", async () => {
    const result = await runEmbed([], deps);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--source-dir is required");
  });

  it("exits 1 on an unknown flag", async () => {
    const result = await runEmbed(["--bogus"], deps);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage: md-rag embed");
    expect(result.stderr).toMatch(/^embed: Unknown option '--bogus'/);
  });

  it("prefixes a repeated flag with the command and prints usage", async () => {
    const result = await runEmbed(
      ["--source-dir", "a", "--source-dir", "b"],
      deps,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(
      /^embed: --source-dir was given more than once\n\nUsage: md-rag embed/,
    );
  });

  it("writes sidecars and prints a summary", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha one", "alpha two"]);

    const result = await runEmbed(
      ["--source-dir", sourceDir, "--target-dir", targetDir],
      deps,
    );

    expect(result).toEqual({
      exitCode: 0,
      stdout:
        "1 document(s) written (1 chunk(s) embedded, 0 reused), 0 up to date, 0 sidecar(s) pruned.\n",
      stderr: "",
    });
    expect(await readSidecar(targetDir, "a.md")).toBeDefined();
  });

  it("passes --models-dir and --offline to the embedder", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha"]);
    const modelsDir = join(root, "models");

    await runEmbed(
      ["--source-dir", sourceDir, "--models-dir", modelsDir, "--offline"],
      deps,
    );

    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({ modelsDir, allowRemoteModels: false });
  });

  it("downloads models by default", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha"]);

    await runEmbed(["--source-dir", sourceDir], deps);

    expect(configs[0]?.allowRemoteModels).toBe(true);
  });

  it("exits 1 on a contract error but still writes the valid documents", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha"]);
    await writeFile(join(sourceDir, "bad.md"), "no frontmatter\n", "utf8");

    const result = await runEmbed(
      ["--source-dir", sourceDir, "--target-dir", targetDir],
      deps,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("bad.md: contract:");
    expect(result.stderr).toContain("1 document(s) failed.");
    expect(await readSidecar(targetDir, "a.md")).toBeDefined();
  });

  it("exits 1 when the embedder fails on a document", async () => {
    await writeDoc(sourceDir, "a.md", ["alpha BOOM"]);

    const result = await runEmbed(
      ["--source-dir", sourceDir, "--target-dir", targetDir],
      { createEmbedder: () => createCountingEmbedder({ failOn: "BOOM" }) },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('a.md: cannot embed "BOOM"');
  });

  it("exits 1 with a clean error for a non-existent --source-dir", async () => {
    const result = await runEmbed(
      ["--source-dir", join(root, "missing")],
      deps,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("embed:");
  });
});
