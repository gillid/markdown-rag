import { type ParseArgsOptionsConfig, parseArgs } from "node:util";
import { FlagError } from "./flag-error.ts";

interface ParsedToken {
  kind: string;
  name?: string;
}

/** `parseArgs` keeps the last value of a repeated single-value flag; a second value is a mistake, not an override. */
function rejectRepeatedFlags(
  options: ParseArgsOptionsConfig,
  tokens: readonly ParsedToken[],
): void {
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== "option" || token.name === undefined) continue;
    if (options[token.name]?.multiple === true) continue;
    if (seen.has(token.name)) {
      throw new FlagError(`--${token.name} was given more than once`);
    }
    seen.add(token.name);
  }
}

/** The one place the commands call `parseArgs`, so none of them can forget to reject a repeated flag. */
export function parseFlags<Options extends ParseArgsOptionsConfig>(
  argv: readonly string[],
  options: Options,
  allowPositionals: boolean,
) {
  const { values, positionals, tokens } = parseArgs({
    args: argv,
    options,
    allowPositionals,
    tokens: true,
  });
  // `--help` is how a user recovers from a broken command line, so it wins over a repeated flag too.
  if (!tokens.some((t) => t.kind === "option" && t.name === "help")) {
    rejectRepeatedFlags(options, tokens);
  }
  return { values, positionals };
}
