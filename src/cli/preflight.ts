import type { FailureKind } from "../engine/failure-kind.ts";
import { errorMessage, isErrnoException } from "../errors.ts";
import { failure } from "./failure.ts";
import { FlagError } from "./flag-error.ts";
import { type FlagOptions, parseFlags } from "./parse-flags.ts";
import type { CliResult } from "./result.ts";

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

export interface FlagSpec<Options extends FlagOptions> {
  argv: readonly string[];
  /** The command's own flags; `--help` is added by `parseFlags`. */
  options: Options;
  allowPositionals: boolean;
}

// `help` is left out: a command's step only runs when it was not requested.
export type ParsedFlags<Options extends FlagOptions> = Omit<
  ReturnType<typeof parseFlags<Options>>,
  "help"
>;

/** The opening every command shares: parse the flags, let `--help` win over every flag value, and require `--source-dir`. */
export function preflight<
  Options extends FlagOptions,
  Values extends { sourceDir?: string },
>(
  command: PreflightCommand,
  { argv, options, allowPositionals }: FlagSpec<Options>,
  toValues: (parsed: ParsedFlags<NoInfer<Options>>) => Values,
): Preflight<Values> {
  let values: Values;
  try {
    const parsed = parseFlags(argv, options, allowPositionals);
    if (parsed.help) {
      return {
        ok: false,
        result: { exitCode: 0, stdout: command.help, stderr: "" },
      };
    }
    values = toValues(parsed);
  } catch (cause) {
    if (isFlagFailure(cause)) {
      return { ok: false, result: commandFailure(command, "usage", cause) };
    }
    throw cause;
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
