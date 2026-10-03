import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isErrnoException } from "../errors.ts";

const GITIGNORE_NAME = ".gitignore";
// Ignores the whole folder, itself included: nothing in it is hand-edited (ADR-038).
const GITIGNORE_CONTENT = "*\n";

export async function ensureEngineDir(targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  const path = join(targetDir, GITIGNORE_NAME);
  if ((await readIfExists(path)) !== GITIGNORE_CONTENT) {
    await writeFile(path, GITIGNORE_CONTENT);
  }
}

// An existing .gitignore isn't ours to rewrite, so it is reported as unverified.
export async function ensureModelsDirIgnored(
  modelsDir: string,
): Promise<"ignored" | "unverified"> {
  await mkdir(modelsDir, { recursive: true });
  const path = join(modelsDir, GITIGNORE_NAME);
  try {
    await writeFile(path, GITIGNORE_CONTENT, { flag: "wx" });
    return "ignored";
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "EEXIST") {
      throw error;
    }
  }
  return (await readIfExists(path)) === GITIGNORE_CONTENT
    ? "ignored"
    : "unverified";
}

async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
