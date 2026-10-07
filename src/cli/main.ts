import { pathToFileURL } from "node:url";
import { runCheck } from "./check.ts";
import { runEmbed } from "./embed.ts";
import { runGet } from "./get.ts";
import { runList } from "./list.ts";
import { runOverview } from "./overview.ts";
import type { CliResult } from "./result.ts";
import { runSearch } from "./search.ts";

export const HELP = `Usage: md-rag <command> [options]

Commands:
  check     Validate the knowledge base contract
  embed     Chunk and embed documents into sidecars
  overview  Count documents and list the sources, tags and signals
  search    Ranked, cited search
  list      List documents, unranked
  get       Print one document or section

Options:
  -h, --help  Show this help message
`;

export async function run(argv: readonly string[]): Promise<CliResult> {
  const [command, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h") {
    return { exitCode: 0, stdout: HELP, stderr: "" };
  }

  if (command === "check") {
    return runCheck(rest);
  }

  if (command === "embed") {
    return runEmbed(rest);
  }

  if (command === "overview") {
    return runOverview(rest);
  }

  if (command === "search") {
    return runSearch(rest);
  }

  if (command === "list") {
    return runList(rest);
  }

  if (command === "get") {
    return runGet(rest);
  }

  return { exitCode: 1, stdout: "", stderr: `Unknown command\n\n${HELP}` };
}

async function main(): Promise<void> {
  const result = await run(process.argv.slice(2));
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
