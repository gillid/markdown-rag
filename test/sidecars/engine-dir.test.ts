import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureEngineDir,
  ensureModelsDirIgnored,
} from "../../src/sidecars/engine-dir.ts";

describe("ensureEngineDir", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "md-rag-engine-dir-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates the folder with a .gitignore that ignores everything", async () => {
    const targetDir = join(root, "nested", ".md-rag");
    await ensureEngineDir(targetDir);
    expect(await readFile(join(targetDir, ".gitignore"), "utf8")).toBe("*\n");
  });

  it("restores an edited .gitignore", async () => {
    await ensureEngineDir(root);
    await writeFile(join(root, ".gitignore"), "!keep\n");
    await ensureEngineDir(root);
    expect(await readFile(join(root, ".gitignore"), "utf8")).toBe("*\n");
  });

  it("creates a missing .gitignore in a shared cache folder", async () => {
    const modelsDir = join(root, "shared", "models");
    expect(await ensureModelsDirIgnored(modelsDir)).toBe("ignored");
    expect(await readFile(join(modelsDir, ".gitignore"), "utf8")).toBe("*\n");
    expect(await ensureModelsDirIgnored(modelsDir)).toBe("ignored");
  });

  it("leaves a foreign .gitignore in a shared cache folder untouched", async () => {
    await writeFile(join(root, ".gitignore"), "*.tmp\n");
    expect(await ensureModelsDirIgnored(root)).toBe("unverified");
    expect(await readFile(join(root, ".gitignore"), "utf8")).toBe("*.tmp\n");
  });
});
