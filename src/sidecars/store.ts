import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { VECTORS_DIR_NAME } from "../config/layout.ts";
import { isStrictlyInside } from "../config/paths.ts";
import { errorMessage, isErrnoException } from "../errors.ts";
import {
  type OpenedSidecar,
  openSidecarJson,
  type Sidecar,
  SidecarContentError,
  SidecarError,
  SidecarReadError,
  serializeSidecar,
} from "./sidecar.ts";

const SIDECAR_SUFFIX = ".vec.json";
// Matches the names `writeSidecar` gives its temp files.
const TEMP_FILE = /^\.[0-9a-f-]{36}\.tmp$/;
const WINDOWS_DRIVE = /^[A-Za-z]:/;

// Document identity is a normalised POSIX path, so spellings that alias another sidecar are refused.
export function sidecarPath(targetDir: string, docPath: string): string {
  const segments = docPath.split("/");
  const isNormalised =
    !WINDOWS_DRIVE.test(docPath) &&
    !docPath.includes("\\") &&
    segments.every(
      (segment) => segment !== "" && segment !== "." && segment !== "..",
    );
  if (!isNormalised) {
    throw new SidecarError(
      `document path must be a normalised POSIX path relative to the knowledge base: ${docPath}`,
    );
  }
  return resolve(targetDir, VECTORS_DIR_NAME, `${docPath}${SIDECAR_SUFFIX}`);
}

export async function readSidecar(
  targetDir: string,
  docPath: string,
): Promise<Sidecar | undefined> {
  return (await openSidecar(targetDir, docPath))?.load();
}

/** Reads and validates the file once; `load()` then decodes the vectors without re-reading it. */
export async function openSidecar(
  targetDir: string,
  docPath: string,
): Promise<OpenedSidecar | undefined> {
  const path = sidecarPath(targetDir, docPath);
  let json: string;
  try {
    json = await readFile(path, "utf8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw new SidecarReadError(`${path}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
  try {
    const opened = openSidecarJson(json);
    return { header: opened.header, load: () => inFile(path, opened.load) };
  } catch (error) {
    throw new SidecarContentError(`${path}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

function inFile<T>(path: string, action: () => T): T {
  try {
    return action();
  } catch (error) {
    throw new SidecarContentError(`${path}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

export interface VectorsDirScan {
  /** Document paths of every sidecar, sorted. */
  docPaths: string[];
  /** Leftovers of interrupted writes; they are not sidecars. */
  tempFiles: string[];
}

export async function scanVectorsDir(
  targetDir: string,
): Promise<VectorsDirScan> {
  const scan: VectorsDirScan = { docPaths: [], tempFiles: [] };

  async function walk(dir: string, prefix: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.isFile() && TEMP_FILE.test(entry.name)) {
        scan.tempFiles.push(join(dir, entry.name));
      } else if (
        entry.isFile() &&
        entry.name.length > SIDECAR_SUFFIX.length &&
        entry.name.endsWith(SIDECAR_SUFFIX)
      ) {
        scan.docPaths.push(
          `${prefix}${entry.name.slice(0, -SIDECAR_SUFFIX.length)}`,
        );
      }
    }
  }

  await walk(resolve(targetDir, VECTORS_DIR_NAME), "");
  scan.docPaths.sort();
  return scan;
}

export async function deleteSidecar(
  targetDir: string,
  docPath: string,
): Promise<void> {
  await removeAndTidy(targetDir, sidecarPath(targetDir, docPath));
}

export async function deleteTempFile(
  targetDir: string,
  tempFile: string,
): Promise<void> {
  await removeAndTidy(targetDir, tempFile);
}

// Climbs only through directories the removal left empty, never removing the vectors folder itself.
async function removeAndTidy(targetDir: string, path: string): Promise<void> {
  const vectorsDir = resolve(targetDir, VECTORS_DIR_NAME);
  if (!isStrictlyInside(path, vectorsDir)) {
    throw new SidecarError(`${path} is not inside ${vectorsDir}`);
  }
  await rm(path, { force: true });
  // Tidying is a convenience: the file is already gone, so a failure here must not fail the removal.
  for (let dir = dirname(path); dir !== vectorsDir; dir = dirname(dir)) {
    try {
      await rmdir(dir);
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") continue;
      return;
    }
  }
}

/** Writes through a temp file and a rename, so a reader never sees a partial sidecar. */
export async function writeSidecar(
  targetDir: string,
  docPath: string,
  sidecar: Sidecar,
): Promise<void> {
  const path = sidecarPath(targetDir, docPath);
  const contents = serializeSidecar(sidecar);
  await mkdir(dirname(path), { recursive: true });
  const tempPath = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, contents, "utf8");
    await rename(tempPath, path);
  } catch (error) {
    // A cleanup failure must not replace the error that caused it.
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}
