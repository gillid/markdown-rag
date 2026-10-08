import type { FailureKind } from "../engine/failure-kind.ts";
import { type CliResult, toJson, usageError } from "./result.ts";

interface FailureOptions {
  json: boolean;
  help: string;
}

export function failure(
  command: string,
  kind: FailureKind,
  message: string,
  { json, help }: FailureOptions,
): CliResult {
  const text = `${command}: ${message}`;
  if (json) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: toJson({ error: { kind, message: text } }),
    };
  }
  return kind === "usage"
    ? usageError(text, help)
    : { exitCode: 1, stdout: "", stderr: `${text}\n` };
}

/** Reads `--json` straight from the arguments, because a usage failure happens before they are parsed. */
export function wantsJson(argv: readonly string[]): boolean {
  const end = argv.indexOf("--");
  return (end === -1 ? argv : argv.slice(0, end)).includes("--json");
}
