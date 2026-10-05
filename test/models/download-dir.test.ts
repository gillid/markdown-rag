import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    root = await mkdtemp(join(tmpdir(), "md-rag-download-dir-"));
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

  it("runs again once the previous run has finished", async () => {
    const config = configFor();
    const first = prepareDownloadDir(config);
    await first;
    const second = prepareDownloadDir(config);
    expect(second).not.toBe(first);
    await second;
  });
});
