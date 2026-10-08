import type { FailureKind } from "../engine/failure-kind.ts";
import { errorMessage, isErrnoException } from "../errors.ts";
import { failure } from "./failure.ts";
import { FlagError } from "./flag-error.ts";
import type { CliResult } from "./result.ts";

// Returned instead of values so that help wins over every flag value.
export const SHOW_HELP = "help";

export interface PreflightCommand {
  command: string;
  help: string;
  /** Whether a failure is printed as a JSON error object (ADR-041); only the commands that take `--json` set it. */
  json?: boolean;
}

export type Preflight<Values extends { sourceDir?: string }> =
  | { ok: true; values: Values & { sourceDir: string } }
  | { ok: false; result: CliResult };

/** `parseArgs` reports a bad flag with an `ERR_PARSE_ARGS_*` code; any other failure is a bug and must surface. */
function isFlagFailure(cause: unknown): cause is Error {
  return (
    cause instanceof FlagError ||
    (isErrnoException(cause) &&
      cause.code?.startsWith("ERR_PARSE_ARGS") === true)
  );
}

export function commandFailure(
  { command, help, json = false }: PreflightCommand,
  kind: FailureKind,
  cause: unknown,
): CliResult {
  return failure(command, kind, errorMessage(cause), { json, help });
}

/** The opening every command shares: parse the flags, let `--help` win, and require `--source-dir`. */
export function preflight<Values extends { sourceDir?: string }>(
  command: PreflightCommand,
  parse: () => Values | typeof SHOW_HELP,
): Preflight<Values> {
  let values: Values | typeof SHOW_HELP;
  try {
    values = parse();
  } catch (cause) {
    if (isFlagFailure(cause)) {
      return { ok: false, result: commandFailure(command, "usage", cause) };
    }
    throw cause;
  }

  if (values === SHOW_HELP) {
    return {
      ok: false,
      result: { exitCode: 0, stdout: command.help, stderr: "" },
    };
  }
  const { sourceDir } = values;
  if (sourceDir === undefined) {
    return {
      ok: false,
      result: commandFailure(command, "usage", "--source-dir is required"),
    };
  }
  return { ok: true, values: { ...values, sourceDir } };
}
