import { ConfigError, type ConfigInput } from "../config/config.ts";
import {
  createEngine,
  type Engine,
  type EngineOptions,
} from "../engine/index.ts";
import { errorMessage, isErrnoException } from "../errors.ts";
import {
  type FailureKind,
  failure,
  operationFailureKind,
  wantsJson,
} from "./failure.ts";
import { FlagError } from "./flag-error.ts";
import type { CliResult } from "./result.ts";

// `argv` is kept raw because `--json` must be readable even when the arguments don't parse.
export interface QueryCommand {
  command: string;
  help: string;
  argv: readonly string[];
}

export interface QueryDeps {
  createEngine(input: ConfigInput, options: EngineOptions): Promise<Engine>;
}

export const defaultQueryDeps: QueryDeps = { createEngine };

export const COMMON_OPTIONS = {
  "source-dir": { type: "string" },
  "target-dir": { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

export const COMMON_HELP = `  --source-dir <dir>  The knowledge base to query (required)
  --target-dir <dir>  The engine folder (default: <source-dir>/.md-rag/)
  --json              Print JSON instead of Markdown; a failure is a JSON error on stderr
  -h, --help          Show this help message
`;

export interface CommonFlagValues {
  "source-dir"?: string;
  "target-dir"?: string;
}

// Returned instead of an invocation so that help wins over every flag value.
export const SHOW_HELP = "help";

export interface QueryInvocation {
  sourceDir?: string;
  targetDir?: string;
  modelsDir?: string;
  offline?: boolean;
  loadModels: boolean;
  operation(engine: Engine): Promise<string>;
}

export function commonInvocation(
  values: CommonFlagValues,
): Pick<QueryInvocation, "sourceDir" | "targetDir"> {
  return {
    sourceDir: values["source-dir"],
    targetDir: values["target-dir"],
  };
}

/** `parseArgs` reports a bad flag with an `ERR_PARSE_ARGS_*` code; any other failure is a bug and must surface. */
function isFlagFailure(cause: unknown): cause is Error {
  return (
    cause instanceof FlagError ||
    (isErrnoException(cause) &&
      cause.code?.startsWith("ERR_PARSE_ARGS") === true)
  );
}

export async function runQuery(
  { command, help, argv }: QueryCommand,
  deps: QueryDeps,
  parse: () => QueryInvocation | typeof SHOW_HELP,
): Promise<CliResult> {
  const fail = (kind: FailureKind, cause: unknown) =>
    failure(command, kind, errorMessage(cause), {
      json: wantsJson(argv),
      help,
    });

  let invocation: QueryInvocation | typeof SHOW_HELP;
  try {
    invocation = parse();
  } catch (cause) {
    if (isFlagFailure(cause)) return fail("usage", cause);
    throw cause;
  }

  if (invocation === SHOW_HELP) {
    return { exitCode: 0, stdout: help, stderr: "" };
  }
  if (invocation.sourceDir === undefined) {
    return fail("usage", "--source-dir is required");
  }

  let engine: Engine;
  try {
    engine = await deps.createEngine(
      {
        sourceDir: invocation.sourceDir,
        targetDir: invocation.targetDir,
        modelsDir: invocation.modelsDir,
        allowRemoteModels: invocation.offline ? false : undefined,
      },
      { loadModels: invocation.loadModels },
    );
  } catch (cause) {
    // A rejected setting is the caller's to fix; any other failure to start is not.
    return fail(cause instanceof ConfigError ? "usage" : "startup", cause);
  }

  try {
    return {
      exitCode: 0,
      stdout: await invocation.operation(engine),
      stderr: "",
    };
  } catch (cause) {
    return fail(operationFailureKind(cause), cause);
  }
}

export function onlyPositional(
  name: string,
  positionals: readonly string[],
): string {
  const [first, ...extra] = positionals;
  if (first === undefined || extra.length > 0) {
    throw new FlagError(
      `expected exactly one ${name}, got ${positionals.length} (quote it if it contains spaces)`,
    );
  }
  return first;
}
