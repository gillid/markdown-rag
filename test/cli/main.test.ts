import { describe, expect, it } from "vitest";
import { HELP, run } from "../../src/cli/main.ts";

describe("mdrag CLI", () => {
  it("prints help and exits 0 with --help", () => {
    expect(run(["--help"])).toEqual({ exitCode: 0, stdout: HELP, stderr: "" });
  });

  it("prints help and exits 0 with -h", () => {
    expect(run(["-h"])).toEqual({ exitCode: 0, stdout: HELP, stderr: "" });
  });

  it("prints help and exits 0 with no arguments", () => {
    expect(run([])).toEqual({ exitCode: 0, stdout: HELP, stderr: "" });
  });

  it("exits 1 on an unknown command", () => {
    const result = run(["bogus"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command");
  });
});
