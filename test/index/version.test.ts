import { describe, expect, it } from "vitest";
import {
  computeIndexVersion,
  type VersionedDocument,
} from "../../src/index/version.ts";

const a: VersionedDocument = {
  path: "a.md",
  docHash: "h1",
  chunker: "structural@1",
  model: "m",
  dims: 4,
  chunkHashes: ["c1", "c2"],
};
const b: VersionedDocument = {
  ...a,
  path: "b.md",
  docHash: "h2",
  chunkHashes: [],
};

describe("computeIndexVersion", () => {
  it("hashes the documents' fields in path order", () => {
    // sha256 of the JSON below, computed with sha256sum.
    // [["a.md","h1","structural@1","m",4,["c1","c2"]],["b.md","h2","structural@1","m",4,[]]]
    expect(computeIndexVersion([b, a])).toBe(
      "cb74c10e5aaad6931564365e9d2dfb76cd71e37c30c8f9f4117b9880aa3f6a27",
    );
  });

  it("does not depend on the order the documents are given in", () => {
    expect(computeIndexVersion([a, b])).toBe(computeIndexVersion([b, a]));
  });

  it.each([
    ["is edited", { ...a, docHash: "h1-edited" }],
    ["is renamed", { ...a, path: "c.md" }],
    ["is re-chunked", { ...a, chunkHashes: ["c1", "c3"] }],
    ["gets another chunker", { ...a, chunker: "structural@2" }],
    ["is embedded with another model", { ...a, model: "other" }],
    ["is embedded with other dims", { ...a, dims: 8 }],
  ])("changes when a document %s", (_, changed) => {
    expect(computeIndexVersion([changed, b])).not.toBe(
      computeIndexVersion([a, b]),
    );
  });

  it("changes when a document is removed", () => {
    expect(computeIndexVersion([a])).not.toBe(computeIndexVersion([a, b]));
  });

  it("tells apart paths that would collide in a delimited concatenation", () => {
    expect(
      computeIndexVersion([{ ...a, path: "x\ty", docHash: "z" }]),
    ).not.toBe(computeIndexVersion([{ ...a, path: "x", docHash: "y\tz" }]));
  });
});
