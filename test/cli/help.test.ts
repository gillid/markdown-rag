import { describe, expect, it } from "vitest";
import { runCheck } from "../../src/cli/check.ts";
import { runEmbed } from "../../src/cli/embed.ts";
import { runGet } from "../../src/cli/get.ts";
import { runList } from "../../src/cli/list.ts";
import { runOverview } from "../../src/cli/overview.ts";
import type { CliResult } from "../../src/cli/result.ts";
import { runSearch } from "../../src/cli/search.ts";
import { runServe, type ServeDeps } from "../../src/cli/serve.ts";

const neverStarted = () => {
  throw new Error("--help must not start anything");
};
const queryDeps = { createEngine: neverStarted };
const serveDeps: ServeDeps = {
  createEngine: neverStarted,
  shutdown: new AbortController().signal,
  log: neverStarted,
};

const commands: [string, (argv: string[]) => Promise<CliResult>][] = [
  ["check", (argv) => runCheck(argv)],
  ["embed", (argv) => runEmbed(argv, { createEmbedder: neverStarted })],
  ["serve", (argv) => runServe(argv, serveDeps)],
  ["overview", (argv) => runOverview(argv, queryDeps)],
  ["list", (argv) => runList(argv, queryDeps)],
  ["search", (argv) => runSearch(argv, queryDeps)],
  ["get", (argv) => runGet(argv, queryDeps)],
];

const badValues: Record<string, string[]> = {
  serve: ["--port", "abc"],
  overview: ["--since", "junk"],
  list: ["--sort", "size"],
  search: ["--limit", "abc"],
};

describe.each(commands)("%s --help", (name, run) => {
  const expectHelp = (result: CliResult) => {
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`Usage: md-rag ${name}`);
  };

  it("wins over a repeated flag", async () => {
    expectHelp(await run(["--source-dir", "a", "--source-dir", "b", "--help"]));
  });

  it("wins over a bad flag value", async () => {
    const bad = badValues[name];
    if (bad === undefined) return;
    expectHelp(await run([...bad, "--help"]));
  });
});
