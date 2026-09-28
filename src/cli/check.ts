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
  -h, --help          Show this help message
`;

/** Runs the loader and reports the aggregated contract errors; sidecar freshness is checked at `embed`/`serve` time, not here (ADR-038). */
export async function runCheck(argv: readonly string[]): Promise<CliResult> {
  let values: { "source-dir"?: string; "target-dir"?: string; help?: boolean };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        "source-dir": { type: "string" },
        "target-dir": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: false,
    }));
  } catch (cause) {
    return usageError((cause as Error).message);
  }

  if (values.help) {
    return { exitCode: 0, stdout: CHECK_HELP, stderr: "" };
  }

  const sourceDir = values["source-dir"];
  if (sourceDir === undefined) {
    return usageError("check: --source-dir is required");
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

function usageError(message: string): CliResult {
  return { exitCode: 1, stdout: "", stderr: `${message}\n\n${CHECK_HELP}` };
}
