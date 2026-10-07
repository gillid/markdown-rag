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

  it.each(["overview", "search", "list", "get"])(
    "dispatches %s to its own command",
    async (command) => {
      const result = await run([command, "--help"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`Usage: md-rag ${command}`);
    },
  );

  it.each(["check", "embed"])(
    "rejects a single-value flag given twice for %s",
    async (command) => {
      const result = await run([
        command,
        "--source-dir",
        "a",
        "--source-dir",
        "b",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--source-dir was given more than once");
    },
  );

  it("exits 1 on an unknown command", async () => {
    const result = await run(["bogus"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command");
  });
});
