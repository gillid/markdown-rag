import { parseArgs } from "node:util";
import { ConfigError, loadConfig } from "../config/config.ts";
import { loadKnowledgeBase } from "../contract/loader.ts";
import type { CliResult } from "./result.ts";

export const CHECK_HELP = `Usage: md-rag check --source-dir <dir> [options]

Validates the knowledge base contract: required frontmatter, valid signals
and the 1 MB size limit. Reports every failing document, keyed by path.

Options:
  --source-dir <dir>  The knowledge base to check (required)
  --target-dir <dir>  The engine folder (default: <source-dir>/.md-rag/)
`;

/** Runs the loader and reports the aggregated contract errors (step 6; sidecar freshness is added in step 12, ADR-038). */
export async function runCheck(argv: readonly string[]): Promise<CliResult> {
  let values: { "source-dir"?: string; "target-dir"?: string };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        "source-dir": { type: "string" },
        "target-dir": { type: "string" },
      },
      allowPositionals: false,
    }));
  } catch (cause) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${(cause as Error).message}\n\n${CHECK_HELP}`,
    };
  }

  const sourceDir = values["source-dir"];
  if (sourceDir === undefined) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `check: --source-dir is required\n\n${CHECK_HELP}`,
    };
  }

  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig({ sourceDir, targetDir: values["target-dir"] });
  } catch (cause) {
    if (cause instanceof ConfigError) {
      return { exitCode: 1, stdout: "", stderr: `${cause.message}\n` };
    }
    throw cause;
  }

  const { documents, errors } = await loadKnowledgeBase(config);

  if (errors.length > 0) {
    const lines = errors
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((error) => `${error.path}: ${error.reason}`);
    const total = documents.length + errors.length;
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${lines.join("\n")}\n\n${errors.length} of ${total} document(s) failed the contract.\n`,
    };
  }

  return {
    exitCode: 0,
    stdout: `${documents.length} document(s) passed the contract.\n`,
    stderr: "",
  };
}
