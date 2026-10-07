import { describe, expect, it } from "vitest";
import { wantsJson } from "../../src/cli/failure.ts";

describe("wantsJson", () => {
  it("is true when --json is among the arguments", () => {
    expect(wantsJson(["list", "--source-dir", "kb", "--json"])).toBe(true);
  });

  it("is false without it", () => {
    expect(wantsJson(["--source-dir", "kb"])).toBe(false);
  });

  it("ignores a query that happens to read --json after the separator", () => {
    expect(wantsJson(["--source-dir", "kb", "--", "--json"])).toBe(false);
  });
});
