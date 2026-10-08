import { describe, expect, it } from "vitest";
import { runQuery } from "../../src/cli/run-query.ts";

describe("runQuery", () => {
  it("does not typecheck a command that redeclares a common flag", async () => {
    const result = await runQuery(
      {
        command: "demo",
        help: "Usage: md-rag demo\n",
        argv: ["--help"],
        // @ts-expect-error `json` is a common flag
        options: { json: { type: "string" } },
        allowPositionals: false,
      },
      { createEngine: () => Promise.reject(new Error("unused")) },
      () => ({ loadModels: false, operation: async () => "" }),
    );
    expect(result.exitCode).toBe(0);
  });
});
