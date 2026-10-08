import { describe, expect, it } from "vitest";
import type { IndexedDocument } from "../../src/index/knowledge-index.ts";
import { joinChunks, mergeAndExpand } from "../../src/retrieval/merge.ts";

function document(path: string, chunkCount: number): IndexedDocument {
  return {
    summary: {
      ref: path,
      path,
      title: path,
      updatedAt: 0,
      tags: [],
      meta: {},
    },
    outline: [],
    body: "",
    sections: new Map(),
    chunks: Array.from({ length: chunkCount }, (_, ordinal) => ({
      ordinal,
      breadcrumb: path,
      anchor: "",
      text: `${path}:${ordinal};`,
    })),
  };
}

const documents = new Map([
  ["a.md", document("a.md", 6)],
  ["b.md", document("b.md", 2)],
]);

const hit = (
  path: string,
  ordinal: number,
  final: number,
  reranked = true,
) => ({
  path,
  ordinal,
  final,
  reranked,
  scores: {
    retrieval: final,
    rerank: reranked ? final : null,
    relevance: final,
    signals: {},
    final,
  },
});

describe("mergeAndExpand", () => {
  it("merges consecutive hits of one document and keeps the higher score", () => {
    const [result, ...rest] = mergeAndExpand(
      [hit("a.md", 2, 0.4), hit("a.md", 3, 0.9)],
      documents,
      0,
    );

    expect(rest).toEqual([]);
    expect(result).toMatchObject({ from: 2, to: 3, best: { ordinal: 3 } });
  });

  it("ranks an unreranked hit after a reranked one whatever its final score", () => {
    const results = mergeAndExpand(
      [hit("b.md", 0, 0.4, false), hit("a.md", 0, 0.1)],
      documents,
      0,
    );

    expect(results.map((r) => r.path)).toEqual(["a.md", "b.md"]);
  });

  it("keeps the reranked hit as best when it merges with a higher-scoring unreranked neighbour", () => {
    const [result] = mergeAndExpand(
      [hit("a.md", 2, 0.1), hit("a.md", 3, 0.4, false)],
      documents,
      0,
    );

    expect(result?.best.ordinal).toBe(2);
  });

  it("keeps non-neighbouring hits of one document apart", () => {
    const results = mergeAndExpand(
      [hit("a.md", 0, 0.9), hit("a.md", 3, 0.5)],
      documents,
      0,
    );

    expect(results.map(({ from, to }) => [from, to])).toEqual([
      [0, 0],
      [3, 3],
    ]);
  });

  it("orders results by their best score", () => {
    const results = mergeAndExpand(
      [hit("a.md", 0, 0.2), hit("b.md", 1, 0.8)],
      documents,
      0,
    );

    expect(results.map((r) => r.path)).toEqual(["b.md", "a.md"]);
  });

  it("extends each hit by the expansion on both sides", () => {
    const [result] = mergeAndExpand([hit("a.md", 3, 1)], documents, 2);

    expect(result).toMatchObject({ from: 1, to: 5 });
  });

  it("stops the expansion at the document's first and last chunk", () => {
    expect(mergeAndExpand([hit("b.md", 0, 1)], documents, 2)[0]).toMatchObject({
      from: 0,
      to: 1,
    });
    expect(mergeAndExpand([hit("a.md", 5, 1)], documents, 1)[0]).toMatchObject({
      from: 4,
      to: 5,
    });
  });

  it("merges hits whose expanded ranges overlap, so no chunk is returned twice", () => {
    const results = mergeAndExpand(
      [hit("a.md", 1, 0.5), hit("a.md", 3, 0.6)],
      documents,
      1,
    );

    expect(results.map(({ from, to }) => [from, to])).toEqual([[0, 4]]);
  });
});

describe("joinChunks", () => {
  it("concatenates chunk text without trimming", () => {
    const chunks = documents.get("b.md")?.chunks ?? [];

    expect(joinChunks(chunks)).toBe("b.md:0;b.md:1;");
  });
});
