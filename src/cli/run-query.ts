import { ConfigError, type ConfigInput } from "../config/config.ts";
import { operationFailureKind } from "../engine/failure-kind.ts";
import {
  createEngine,
  type Engine,
  type EngineOptions,
} from "../engine/index.ts";
import { wantsJson } from "./failure.ts";
import { FlagError } from "./flag-error.ts";
import { commandFailure, preflight, type SHOW_HELP } from "./preflight.ts";
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

export async function runQuery(
  { command, help, argv }: QueryCommand,
  deps: QueryDeps,
  parse: () => QueryInvocation | typeof SHOW_HELP,
): Promise<CliResult> {
  const descriptor = { command, help, json: wantsJson(argv) };
  const opening = preflight(descriptor, parse);
  if (!opening.ok) return opening.result;
  const invocation = opening.values;

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
    return commandFailure(
      descriptor,
      cause instanceof ConfigError ? "usage" : "startup",
      cause,
    );
  }

  try {
    return {
      exitCode: 0,
      stdout: await invocation.operation(engine),
      stderr: "",
    };
  } catch (cause) {
    return commandFailure(descriptor, operationFailureKind(cause), cause);
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
