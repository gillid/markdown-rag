import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prepareDownloadDir } from "../../src/models/download-dir.ts";

describe("prepareDownloadDir", () => {
  let root: string;
  let scenario = 0;

  function configFor() {
    const targetDir = join(root, `engine-${scenario++}`);
    return {
      targetDir,
      modelsDir: join(targetDir, "models"),
      allowRemoteModels: true,
    };
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "markdown-rag-download-dir-"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("shares one run between concurrent calls for the same folders", async () => {
    const config = configFor();
    const first = prepareDownloadDir(config);
    const second = prepareDownloadDir({ ...config });
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(await readFile(join(config.targetDir, ".gitignore"), "utf8")).toBe(
      "*\n",
    );
  });

  it("does not share a run between different folders", async () => {
    const first = prepareDownloadDir(configFor());
    const second = prepareDownloadDir(configFor());
    expect(second).not.toBe(first);
    await Promise.all([first, second]);
  });

  describe("warnings", () => {
    // Stubbed so the expected warnings don't print into the test run.
    async function warningsDuring(run: () => Promise<void>): Promise<string> {
      const emitWarning = vi
        .spyOn(process, "emitWarning")
        .mockImplementation(() => {});
      try {
        await run();
        return emitWarning.mock.calls
          .map(([warning]) => String(warning))
          .join("\n");
      } finally {
        emitWarning.mockRestore();
      }
    }

    it("warns about a shared cache with its own .gitignore and leaves it alone", async () => {
      const modelsDir = join(root, `own-gitignore-${scenario++}`);
      await mkdir(modelsDir, { recursive: true });
      await writeFile(join(modelsDir, ".gitignore"), "*.tmp\n");
      const warnings = await warningsDuring(() =>
        prepareDownloadDir({
          targetDir: join(root, `engine-${scenario++}`),
          modelsDir,
          allowRemoteModels: true,
        }),
      );
      expect(warnings).toContain(`${modelsDir} has its own .gitignore`);
      expect(await readFile(join(modelsDir, ".gitignore"), "utf8")).toBe(
        "*.tmp\n",
      );
    });

    it("warns instead of failing when the folder can't be prepared", async () => {
      const targetDir = join(root, `not-a-folder-${scenario++}`);
      await writeFile(targetDir, "a file, not a folder");
      const warnings = await warningsDuring(() =>
        prepareDownloadDir({
          targetDir,
          modelsDir: join(targetDir, "models"),
          allowRemoteModels: true,
        }),
      );
      expect(warnings).toContain("Could not prepare");
    });
  });

  it("runs again once the previous run has finished", async () => {
    const config = configFor();
    const first = prepareDownloadDir(config);
    await first;
    const second = prepareDownloadDir(config);
    expect(second).not.toBe(first);
    await second;
  });
});
