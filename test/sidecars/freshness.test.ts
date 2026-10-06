import { describe, expect, it } from "vitest";
import type { Document, KnowledgeBase } from "../../src/contract/loader.ts";
import {
  checkFreshness,
  type SidecarEntry,
} from "../../src/sidecars/freshness.ts";

const MODEL = "bge-small-en-v1.5-q8";

function doc(path: string, docHash: string): Document {
  // Freshness reads only the path and hash.
  return { path, docHash } as Document;
}

function fresh(
  docHash: string,
  overrides: { model?: string; dims?: number; chunker?: string } = {},
): SidecarEntry {
  return {
    header: {
      docHash,
      chunker: overrides.chunker ?? "paragraphs@1",
      model: overrides.model ?? MODEL,
      dims: overrides.dims ?? 384,
    },
  };
}

function knowledgeBase(
  documents: Document[],
  errors: KnowledgeBase["errors"] = [],
): KnowledgeBase {
  return { documents, errors };
}

describe("checkFreshness", () => {
  it("returns the one shared model when every sidecar matches its document", () => {
    const result = checkFreshness(
      knowledgeBase([doc("a.md", "h-a"), doc("b/c.md", "h-c")]),
      new Map([
        ["a.md", fresh("h-a")],
        ["b/c.md", fresh("h-c")],
      ]),
    );

    expect(result).toMatchObject({
      ok: true,
      model: { modelId: MODEL, dims: 384 },
    });
  });

  it("reports every current sidecar when they record different chunkers", () => {
    const result = checkFreshness(
      knowledgeBase([doc("a.md", "h-a"), doc("b.md", "h-b")]),
      new Map([
        [
          "a.md",
          fresh("h-a", { chunker: "structural@2;target=1000;max=2000" }),
        ],
        ["b.md", fresh("h-b", { chunker: "structural@2;target=500;max=1000" })],
      ]),
    );

    expect(result).toEqual({
      ok: false,
      problems: [
        {
          path: "a.md",
          reason:
            "sidecars record different chunkers (structural@2;target=1000;max=2000, structural@2;target=500;max=1000) and this one has structural@2;target=1000;max=2000; run md-rag embed",
        },
        {
          path: "b.md",
          reason:
            "sidecars record different chunkers (structural@2;target=1000;max=2000, structural@2;target=500;max=1000) and this one has structural@2;target=500;max=1000; run md-rag embed",
        },
      ],
    });
  });

  it("reports a document with no sidecar", () => {
    const result = checkFreshness(
      knowledgeBase([doc("a.md", "h-a"), doc("b.md", "h-b")]),
      new Map([["a.md", fresh("h-a")]]),
    );

    expect(result).toEqual({
      ok: false,
      problems: [{ path: "b.md", reason: "sidecar missing; run md-rag embed" }],
    });
  });

  it("reports a sidecar whose doc_hash differs from the document", () => {
    const result = checkFreshness(
      knowledgeBase([doc("a.md", "h-new")]),
      new Map([["a.md", fresh("h-old")]]),
    );

    expect(result).toEqual({
      ok: false,
      problems: [
        {
          path: "a.md",
          reason:
            "stale sidecar: its doc_hash does not match the document; run md-rag embed",
        },
      ],
    });
  });

  it("reports a sidecar with no document as an orphan", () => {
    const result = checkFreshness(
      knowledgeBase([doc("a.md", "h-a")]),
      new Map([
        ["a.md", fresh("h-a")],
        ["gone.md", fresh("h-gone")],
      ]),
    );

    expect(result).toMatchObject({
      ok: false,
      problems: [
        { path: "gone.md", reason: expect.stringMatching(/^orphaned/) },
      ],
    });
  });

  it("does not treat the sidecar of a document that failed the contract as an orphan", () => {
    const result = checkFreshness(
      knowledgeBase([doc("a.md", "h-a")], [{ path: "bad.md", reason: "x" }]),
      new Map([
        ["a.md", fresh("h-a")],
        ["bad.md", fresh("h-bad")],
      ]),
    );

    expect(result).toMatchObject({
      ok: true,
      model: { modelId: MODEL, dims: 384 },
    });
  });

  it("reports every current sidecar when they record different models, without naming a majority", () => {
    const result = checkFreshness(
      knowledgeBase([doc("a.md", "h-a"), doc("b.md", "h-b")]),
      new Map([
        ["a.md", fresh("h-a", { model: "new-model" })],
        ["b.md", fresh("h-b")],
      ]),
    );

    expect(result).toEqual({
      ok: false,
      problems: [
        {
          path: "a.md",
          reason: `sidecars record different models (${MODEL}, new-model) and this one has new-model; run md-rag embed`,
        },
        {
          path: "b.md",
          reason: `sidecars record different models (${MODEL}, new-model) and this one has ${MODEL}; run md-rag embed`,
        },
      ],
    });
  });

  it("lets a stale sidecar's model neither vote nor count as a second problem, but names it", () => {
    const result = checkFreshness(
      knowledgeBase([doc("a.md", "h-new"), doc("b.md", "h-b")]),
      new Map([
        ["a.md", fresh("h-old", { model: "old-model" })],
        ["b.md", fresh("h-b")],
      ]),
    );

    expect(result).toEqual({
      ok: false,
      problems: [
        {
          path: "a.md",
          reason: `stale sidecar: its doc_hash does not match the document and was built with model old-model, not ${MODEL}; run md-rag embed`,
        },
      ],
    });
  });

  it("does not tell the user to run embed for the corrupt sidecar of a document that failed the contract", () => {
    const result = checkFreshness(
      knowledgeBase([doc("a.md", "h-a")], [{ path: "bad.md", reason: "x" }]),
      new Map<string, SidecarEntry>([
        ["a.md", fresh("h-a")],
        ["bad.md", { failure: "invalid", message: "invalid JSON" }],
      ]),
    );

    expect(result).toEqual({
      ok: false,
      problems: [
        {
          path: "bad.md",
          reason:
            "invalid sidecar: invalid JSON; embed skips documents that fail the contract",
        },
      ],
    });
  });

  it("reports a rejected sidecar path without suggesting embed", () => {
    const result = checkFreshness(
      knowledgeBase([doc("a.md", "h-a")]),
      new Map<string, SidecarEntry>([
        ["a.md", { failure: "rejected", message: "bad path" }],
      ]),
    );

    expect(result).toEqual({
      ok: false,
      problems: [
        {
          path: "a.md",
          reason:
            "rejected sidecar path: bad path; remove or rename the file by hand",
        },
      ],
    });
  });

  it("ignores the model of a sidecar whose document failed the contract", () => {
    const result = checkFreshness(
      knowledgeBase([doc("a.md", "h-a")], [{ path: "bad.md", reason: "x" }]),
      new Map([
        ["a.md", fresh("h-a")],
        ["bad.md", fresh("h-bad", { model: "other-model" })],
      ]),
    );

    expect(result).toMatchObject({
      ok: true,
      model: { modelId: MODEL, dims: 384 },
    });
  });

  it("fails when the shared model has no preset", () => {
    const result = checkFreshness(
      knowledgeBase([doc("a.md", "h-a")]),
      new Map([["a.md", fresh("h-a", { model: "unknown-model" })]]),
    );

    expect(result).toEqual({
      ok: false,
      problems: [
        {
          path: "a.md",
          reason:
            "the engine has no preset for the recorded model unknown-model; run md-rag embed to re-embed with the engine's model",
        },
      ],
    });
  });

  it("fails when the recorded dims differ from the model's", () => {
    const result = checkFreshness(
      knowledgeBase([doc("a.md", "h-a")]),
      new Map([["a.md", fresh("h-a", { dims: 8 })]]),
    );

    expect(result).toEqual({
      ok: false,
      problems: [
        {
          path: "a.md",
          reason: `sidecar vectors have 8 dims, but model ${MODEL} has 384; run md-rag embed`,
        },
      ],
    });
  });

  it("reports an unreadable sidecar and still checks the rest", () => {
    const result = checkFreshness(
      knowledgeBase([doc("a.md", "h-a"), doc("b.md", "h-b")]),
      new Map<string, SidecarEntry>([
        ["a.md", { failure: "invalid", message: "invalid JSON" }],
        ["b.md", fresh("h-b")],
      ]),
    );

    expect(result).toEqual({
      ok: false,
      problems: [
        {
          path: "a.md",
          reason: "invalid sidecar: invalid JSON; run md-rag embed",
        },
      ],
    });
  });

  it("reports every missing sidecar when none exist at all", () => {
    const result = checkFreshness(
      knowledgeBase([doc("a.md", "h-a"), doc("b.md", "h-b")]),
      new Map(),
    );

    expect(result).toMatchObject({
      ok: false,
      problems: [{ path: "a.md" }, { path: "b.md" }],
    });
  });

  it("passes an empty knowledge base, which has no model to load", () => {
    const result = checkFreshness(knowledgeBase([]), new Map());

    expect(result).toMatchObject({ ok: true, model: undefined });
  });

  it("does not suggest embed for an unreadable sidecar, which embed cannot rebuild", () => {
    const result = checkFreshness(
      knowledgeBase([doc("a.md", "h-a")]),
      new Map<string, SidecarEntry>([
        ["a.md", { failure: "unreadable", message: "EACCES" }],
      ]),
    );

    expect(result).toEqual({
      ok: false,
      problems: [
        {
          path: "a.md",
          reason: "unreadable sidecar: EACCES; check the file's permissions",
        },
      ],
    });
  });
});
