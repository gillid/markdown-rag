import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const HELP = `Usage: md-rag <command> [options]

Commands:
  (none yet)

Options:
  -h, --help  Show this help message
`;

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function run(argv: readonly string[]): CliResult {
  const { values } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help || argv.length === 0) {
    return { exitCode: 0, stdout: HELP, stderr: "" };
  }

  return { exitCode: 1, stdout: "", stderr: `Unknown command\n\n${HELP}` };
}

function main(): void {
  const result = run(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
