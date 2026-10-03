import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { VECTORS_DIR_NAME } from "../config/layout.ts";
import { errorMessage, isErrnoException } from "../errors.ts";
import {
  parseSidecar,
  type Sidecar,
  SidecarError,
  serializeSidecar,
} from "./sidecar.ts";

const SIDECAR_SUFFIX = ".vec.json";
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
  const path = sidecarPath(targetDir, docPath);
  let json: string;
  try {
    json = await readFile(path, "utf8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw new SidecarError(`${path}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
  try {
    return parseSidecar(json);
  } catch (error) {
    throw new SidecarError(`${path}: ${errorMessage(error)}`, {
      cause: error,
    });
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
