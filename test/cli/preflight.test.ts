import { describe, expect, it } from "vitest";
import { parseFlags } from "../../src/cli/parse-flags.ts";
import { preflight, SHOW_HELP } from "../../src/cli/preflight.ts";

const HELP = "Usage: md-rag demo\n";

function open(argv: string[], json?: boolean) {
  return preflight({ command: "demo", help: HELP, json }, () => {
    const { values } = parseFlags(
      argv,
      {
        "source-dir": { type: "string" },
        limit: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      false,
    );
    if (values.help) return SHOW_HELP;
    if (values.limit === "bad") throw new Error("not a flag failure");
    return { sourceDir: values["source-dir"] };
  });
}

describe("preflight", () => {
  it("returns the values with a defined sourceDir", () => {
    expect(open(["--source-dir", "docs"])).toEqual({
      ok: true,
      values: { sourceDir: "docs" },
    });
  });

  it("answers --help with the help text even when another flag value is bad", () => {
    expect(open(["--help", "--limit", "bad"])).toEqual({
      ok: false,
      result: { exitCode: 0, stdout: HELP, stderr: "" },
    });
  });

  it("answers --help even when a flag is repeated", () => {
    const outcome = open(["--source-dir", "a", "--source-dir", "b", "-h"]);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.result.exitCode).toBe(0);
  });

  it("reports a repeated flag as a usage failure with the help text", () => {
    const outcome = open(["--source-dir", "a", "--source-dir", "b"]);
    expect(outcome).toEqual({
      ok: false,
      result: {
        exitCode: 1,
        stdout: "",
        stderr: `demo: --source-dir was given more than once\n\n${HELP}`,
      },
    });
  });

  it("reports an unknown flag as a usage failure", () => {
    const outcome = open(["--nope"]);
    expect(!outcome.ok && outcome.result.stderr).toMatch(/^demo: .*--nope/);
  });

  it("requires --source-dir", () => {
    expect(open([])).toEqual({
      ok: false,
      result: {
        exitCode: 1,
        stdout: "",
        stderr: `demo: --source-dir is required\n\n${HELP}`,
      },
    });
  });

  it("prints a failure as a JSON error object when asked to", () => {
    const outcome = open([], true);
    expect(outcome).toEqual({
      ok: false,
      result: {
        exitCode: 1,
        stdout: "",
        stderr: `${JSON.stringify(
          {
            error: { kind: "usage", message: "demo: --source-dir is required" },
          },
          null,
          2,
        )}\n`,
      },
    });
  });

  it("lets a failure that is not a flag problem surface", () => {
    expect(() => open(["--limit", "bad"])).toThrow("not a flag failure");
  });
});
