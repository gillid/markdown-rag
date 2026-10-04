import { parseArgs } from "node:util";
import { type KnowledgeBase, loadKnowledgeBase } from "../contract/loader.ts";
import { errorMessage, isErrnoException } from "../errors.ts";
import { checkFreshness } from "../sidecars/freshness.ts";
import { readSidecarEntries } from "../sidecars/read-entries.ts";
import { SidecarError } from "../sidecars/sidecar.ts";
import { formatPathErrors } from "./format-errors.ts";
import { loadConfigOutcome } from "./load-config.ts";
import { type CliResult, usageError } from "./result.ts";

export const CHECK_HELP = `Usage: md-rag check --source-dir <dir> [options]

Validates the knowledge base contract (required frontmatter, valid signals
and the 1 MB size limit) and sidecar freshness (every document has a sidecar
that matches it, no orphans, one shared embedding model). Run it after
\`md-rag embed\`. Reports every problem, keyed by path.

Options:
  --source-dir <dir>  The knowledge base to check (required)
  --target-dir <dir>  The engine folder (default: <source-dir>/.md-rag/)
  -h, --help          Show this help message
`;

/** Reports contract errors and sidecar freshness problems together; it is meant to run after `embed` (ADR-038). */
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

  const sections: string[] = [];
  if (errors.length > 0) {
    const total = documents.length + errors.length;
    sections.push(
      `${formatPathErrors(errors)}\n\n${errors.length} of ${total} document(s) failed the contract.`,
    );
  }

  const sidecars = await checkSidecars(result, configOutcome.config.targetDir);
  if (sidecars.ok && sections.length === 0) {
    return {
      exitCode: 0,
      stdout: `${documents.length} document(s) passed the contract; ${sidecars.summary}.\n`,
      stderr: "",
    };
  }
  if (!sidecars.ok) {
    sections.push(sidecars.problem);
  }
  return { exitCode: 1, stdout: "", stderr: `${sections.join("\n\n")}\n` };
}

type SidecarOutcome =
  | { ok: true; summary: string }
  | { ok: false; problem: string };

// Failures are returned rather than thrown so the contract errors found earlier are still reported.
async function checkSidecars(
  knowledgeBase: KnowledgeBase,
  targetDir: string,
): Promise<SidecarOutcome> {
  try {
    const freshness = checkFreshness(
      knowledgeBase,
      await readSidecarEntries(targetDir, knowledgeBase),
    );
    if (!freshness.ok) {
      return {
        ok: false,
        problem: `${formatPathErrors(freshness.problems)}\n\n${new Set(freshness.problems.map((p) => p.path)).size} path(s) with sidecar problems.`,
      };
    }
    return {
      ok: true,
      summary: freshness.model
        ? `sidecars are fresh (model ${freshness.model.modelId})`
        : "no sidecars to check",
    };
  } catch (cause) {
    if (cause instanceof SidecarError || isErrnoException(cause)) {
      return { ok: false, problem: `check: ${errorMessage(cause)}` };
    }
    throw cause;
  }
}
