import { describe, expect, it } from "vitest";
import { HELP, run } from "../../src/cli/main.ts";

describe("md-rag CLI", () => {
  it("prints help and exits 0 with --help", async () => {
    expect(await run(["--help"])).toEqual({
      exitCode: 0,
      stdout: HELP,
      stderr: "",
    });
  });

  it("names the md-rag binary in the usage line", () => {
    expect(HELP).toMatch(/^Usage: md-rag <command>/);
  });

  it("prints help and exits 0 with -h", async () => {
    expect(await run(["-h"])).toEqual({
      exitCode: 0,
      stdout: HELP,
      stderr: "",
    });
  });

  it("prints help and exits 0 with no arguments", async () => {
    expect(await run([])).toEqual({ exitCode: 0, stdout: HELP, stderr: "" });
  });

  it("exits 1 on an unknown command", async () => {
    const result = await run(["bogus"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command");
  });
});
