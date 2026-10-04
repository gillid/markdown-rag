import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SidecarContentError,
  SidecarError,
  SidecarReadError,
} from "../../src/sidecars/sidecar.ts";
import {
  deleteSidecar,
  deleteTempFile,
  openSidecar,
  scanVectorsDir,
  sidecarPath,
} from "../../src/sidecars/store.ts";

describe("sidecar store housekeeping", () => {
  let targetDir: string;

  beforeEach(async () => {
    targetDir = await mkdtemp(join(tmpdir(), "md-rag-store-"));
  });

  afterEach(async () => {
    await rm(targetDir, { recursive: true, force: true });
  });

  async function touch(...segments: string[]): Promise<string> {
    const path = join(targetDir, "vectors", ...segments);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "{}", "utf8");
    return path;
  }

  describe("scanVectorsDir", () => {
    it("returns nothing when the vectors folder does not exist", async () => {
      expect(await scanVectorsDir(targetDir)).toEqual({
        docPaths: [],
        tempFiles: [],
      });
    });

    it("lists sidecar document paths sorted, and temp files apart from them", async () => {
      await touch("b.md.vec.json");
      await touch("nested", "a.md.vec.json");
      const temp = await touch(
        "nested",
        ".0a1b2c3d-0000-4000-8000-0123456789ab.tmp",
      );
      await touch("notes.txt");

      expect(await scanVectorsDir(targetDir)).toEqual({
        docPaths: ["b.md", "nested/a.md"],
        tempFiles: [temp],
      });
    });
  });

  describe("deleteSidecar", () => {
    it("removes the sidecar and the folders it leaves empty, but not vectors/", async () => {
      await touch("a", "b", "doc.md.vec.json");

      await deleteSidecar(targetDir, "a/b/doc.md");

      expect(await readdir(join(targetDir, "vectors"))).toEqual([]);
    });

    it("keeps a folder that still holds another sidecar", async () => {
      await touch("a", "one.md.vec.json");
      await touch("a", "two.md.vec.json");

      await deleteSidecar(targetDir, "a/one.md");

      expect(await readdir(join(targetDir, "vectors", "a"))).toEqual([
        "two.md.vec.json",
      ]);
    });

    it("succeeds when the sidecar is already gone", async () => {
      await deleteSidecar(targetDir, "missing.md");
    });

    it("refuses a document path that is not normalised", async () => {
      await expect(deleteSidecar(targetDir, "../outside.md")).rejects.toThrow(
        SidecarError,
      );
    });
  });

  describe("deleteTempFile", () => {
    it("lets the folder that held only the temp file be tidied", async () => {
      const temp = await touch(
        "gone",
        ".0a1b2c3d-0000-4000-8000-0123456789ab.tmp",
      );

      await deleteTempFile(targetDir, temp);

      await expect(
        stat(join(targetDir, "vectors", "gone")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("refuses to delete a file outside the vectors folder", async () => {
    const outside = join(targetDir, "elsewhere", "x.tmp");
    await mkdir(join(outside, ".."), { recursive: true });
    await writeFile(outside, "x", "utf8");

    await expect(deleteTempFile(targetDir, outside)).rejects.toThrow(
      SidecarError,
    );
    expect(await readdir(join(targetDir, "elsewhere"))).toEqual(["x.tmp"]);
  });

  describe("openSidecar", () => {
    it("returns undefined for a missing sidecar", async () => {
      expect(await openSidecar(targetDir, "a.md")).toBeUndefined();
    });

    it("throws a SidecarContentError for invalid contents", async () => {
      await writeFile(
        (await touch("a.md.vec.json")) as string,
        "{ not json",
        "utf8",
      );
      const error = await openSidecar(targetDir, "a.md").catch((e) => e);
      expect(error).toBeInstanceOf(SidecarContentError);
      expect(error).not.toBeInstanceOf(SidecarReadError);
    });

    it("throws a SidecarReadError when the file cannot be read", async () => {
      await mkdir(sidecarPath(targetDir, "dir.md"), { recursive: true });
      await expect(openSidecar(targetDir, "dir.md")).rejects.toThrow(
        SidecarReadError,
      );
    });
  });
});
