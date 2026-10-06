import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  type ConfigInput,
  loadConfig,
} from "../../src/config/config.ts";
import { DEFAULT_RETRIEVAL } from "../../src/retrieval/types.ts";

const cwd = process.cwd();

describe("loadConfig", () => {
  it("defaults targetDir to .md-rag inside sourceDir", () => {
    expect(loadConfig({ sourceDir: "examples/docs" })).toEqual({
      sourceDir: join(cwd, "examples", "docs"),
      targetDir: join(cwd, "examples", "docs", ".md-rag"),
      modelsDir: join(cwd, "examples", "docs", ".md-rag", "models"),
      allowRemoteModels: true,
      retrieval: {},
    });
  });

  it("resolves a relative targetDir against the current directory", () => {
    expect(
      loadConfig({ sourceDir: "space/docs", targetDir: ".md-rag/handbook" }),
    ).toEqual({
      sourceDir: join(cwd, "space", "docs"),
      targetDir: join(cwd, ".md-rag", "handbook"),
      modelsDir: join(cwd, ".md-rag", "handbook", "models"),
      allowRemoteModels: true,
      retrieval: {},
    });
  });

  it("lets several knowledge bases share one models cache", () => {
    const shared = loadConfig({
      sourceDir: "a",
      targetDir: ".md-rag/a",
      modelsDir: ".md-rag/models",
    });
    expect(shared.modelsDir).toBe(join(cwd, ".md-rag", "models"));
  });

  it("can disallow remote models", () => {
    expect(
      loadConfig({ sourceDir: "docs", allowRemoteModels: false })
        .allowRemoteModels,
    ).toBe(false);
  });

  it.each(["docs", "."])(
    "rejects a modelsDir that is sourceDir or one of its parents (%s)",
    (modelsDir) => {
      expect(() =>
        loadConfig({ sourceDir: "docs", targetDir: "elsewhere", modelsDir }),
      ).toThrow(/must not be sourceDir.*at modelsDir/s);
    },
  );

  it("rejects a modelsDir inside sourceDir but outside targetDir", () => {
    expect(() =>
      loadConfig({ sourceDir: "docs", modelsDir: "docs/models" }),
    ).toThrow(/must not be inside sourceDir.*at modelsDir/s);
  });

  it("accepts a modelsDir inside targetDir even when targetDir is inside sourceDir", () => {
    expect(
      loadConfig({ sourceDir: "docs", modelsDir: "docs/.md-rag/cache" })
        .modelsDir,
    ).toBe(join(cwd, "docs", ".md-rag", "cache"));
  });

  it("accepts a modelsDir shared by several engine folders", () => {
    expect(
      loadConfig({
        sourceDir: "docs",
        targetDir: ".md-rag/a",
        modelsDir: ".md-rag",
      }).modelsDir,
    ).toBe(join(cwd, ".md-rag"));
  });

  it.each([".md-rag/vectors", ".md-rag/vectors/cache"])(
    "rejects a modelsDir that is the sidecar folder or inside it (%s)",
    (modelsDir) => {
      expect(() =>
        loadConfig({ sourceDir: "docs", targetDir: ".md-rag", modelsDir }),
      ).toThrow(/sidecar folder.*at modelsDir/s);
    },
  );

  it("rejects an empty modelsDir", () => {
    expect(() => loadConfig({ sourceDir: "docs", modelsDir: "" })).toThrow(
      /modelsDir/,
    );
  });

  it("keeps absolute directories as given", () => {
    const sourceDir = join(import.meta.dirname, "docs");
    const targetDir = join(import.meta.dirname, "index");
    expect(loadConfig({ sourceDir, targetDir })).toEqual({
      sourceDir,
      targetDir,
      modelsDir: join(targetDir, "models"),
      allowRemoteModels: true,
      retrieval: {},
    });
  });

  it("passes retrieval defaults through", () => {
    const retrieval = { limit: 5, rerank: false, weights: { recency: 0.1 } };
    expect(loadConfig({ sourceDir: "docs", retrieval }).retrieval).toEqual(
      retrieval,
    );
  });

  it("accepts every retrieval default the engine has", () => {
    expect(
      loadConfig({ sourceDir: "docs", retrieval: DEFAULT_RETRIEVAL }).retrieval,
    ).toEqual(DEFAULT_RETRIEVAL);
  });

  it("rejects an unknown or mistyped retrieval default", () => {
    const withRetrieval = (retrieval: unknown) =>
      ({ sourceDir: "docs", retrieval }) as ConfigInput;
    expect(() => loadConfig(withRetrieval({ limt: 5 }))).toThrow(/limt/);
    expect(() => loadConfig(withRetrieval({ mode: "fuzzy" }))).toThrow(/mode/);
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
