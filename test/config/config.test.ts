import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  type ConfigInput,
  loadConfig,
} from "../../src/config/config.ts";

const cwd = process.cwd();

describe("loadConfig", () => {
  it("defaults targetDir to .md-rag inside sourceDir", () => {
    expect(loadConfig({ sourceDir: "examples/docs" })).toEqual({
      sourceDir: join(cwd, "examples", "docs"),
      targetDir: join(cwd, "examples", "docs", ".md-rag"),
    });
  });

  it("resolves a relative targetDir against the current directory", () => {
    expect(
      loadConfig({ sourceDir: "space/docs", targetDir: ".md-rag/handbook" }),
    ).toEqual({
      sourceDir: join(cwd, "space", "docs"),
      targetDir: join(cwd, ".md-rag", "handbook"),
    });
  });

  it("keeps absolute directories as given", () => {
    const sourceDir = join(import.meta.dirname, "docs");
    const targetDir = join(import.meta.dirname, "index");
    expect(loadConfig({ sourceDir, targetDir })).toEqual({
      sourceDir,
      targetDir,
    });
  });

  it("accepts a sibling targetDir whose name starts with sourceDir's", () => {
    expect(
      loadConfig({ sourceDir: "docs", targetDir: "docs-index" }).targetDir,
    ).toBe(join(cwd, "docs-index"));
  });

  it("requires sourceDir", () => {
    const input = {} as ConfigInput;
    expect(() => loadConfig(input)).toThrow(ConfigError);
    expect(() => loadConfig(input)).toThrow(/sourceDir/);
  });

  it("rejects an empty sourceDir", () => {
    expect(() => loadConfig({ sourceDir: "" })).toThrow(/sourceDir/);
  });

  it("rejects an empty targetDir", () => {
    expect(() => loadConfig({ sourceDir: "docs", targetDir: "" })).toThrow(
      /targetDir/,
    );
  });

  it("rejects a sourceDir that is not a string", () => {
    const input = { sourceDir: 42 } as unknown as ConfigInput;
    expect(() => loadConfig(input)).toThrow(ConfigError);
  });

  it("rejects a targetDir equal to sourceDir", () => {
    expect(() => loadConfig({ sourceDir: "docs", targetDir: "docs" })).toThrow(
      /targetDir/,
    );
  });

  it("rejects a targetDir that contains sourceDir", () => {
    expect(() =>
      loadConfig({ sourceDir: "space/docs", targetDir: "." }),
    ).toThrow(/targetDir/);
  });

  it("rejects an unknown key, naming it", () => {
    const input = { sourceDir: "docs", sourcedir: "docs" } as ConfigInput;
    expect(() => loadConfig(input)).toThrow(/sourcedir/);
  });
});
