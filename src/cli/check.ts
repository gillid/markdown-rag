import { parseArgs } from "node:util";
import { loadKnowledgeBase } from "../contract/loader.ts";
import { errorMessage } from "../errors.ts";
import { formatPathErrors } from "./format-errors.ts";
import { loadConfigOutcome } from "./load-config.ts";
import { type CliResult, usageError } from "./result.ts";

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
    return usageError(errorMessage(cause), CHECK_HELP);
  }

  if (values.help) {
    return { exitCode: 0, stdout: CHECK_HELP, stderr: "" };
  }

  const sourceDir = values["source-dir"];
  if (sourceDir === undefined) {
    return usageError("check: --source-dir is required", CHECK_HELP);
  }

  const configOutcome = loadConfigOutcome({
    sourceDir,
    targetDir: values["target-dir"],
  });
  if (!configOutcome.ok) {
    return configOutcome.result;
  }

  let result: Awaited<ReturnType<typeof loadKnowledgeBase>>;
  try {
    result = await loadKnowledgeBase(configOutcome.config);
  } catch (cause) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `check: ${errorMessage(cause)}\n`,
    };
  }
  const { documents, errors } = result;

  if (errors.length > 0) {
    const total = documents.length + errors.length;
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${formatPathErrors(errors)}\n\n${errors.length} of ${total} document(s) failed the contract.\n`,
    };
  }

  return {
    exitCode: 0,
    stdout: `${documents.length} document(s) passed the contract.\n`,
    stderr: "",
  };
}
