import { describe, expect, it } from "vitest";
import {
  chunkText,
  hashChunk,
  type SidecarChunk,
} from "../../src/sidecars/chunk.ts";
import { SidecarError } from "../../src/sidecars/sidecar.ts";
import { verifyChunks } from "../../src/sidecars/verify-chunks.ts";

const BODY = "\n\nalpha\n\nbeta\n";
const ALPHA = { start: 2, end: 7 };
const BETA = { start: 9, end: 13 };

function chunk(range: { start: number; end: number }): SidecarChunk {
  return {
    ...range,
    breadcrumb: "Doc",
    anchor: "",
    hash: hashChunk("Doc", chunkText(BODY, range)),
    vector: new Float32Array(0),
  };
}

describe("verifyChunks", () => {
  it("accepts chunks that cover all the text, with only whitespace between them", () => {
    expect(() =>
      verifyChunks({ body: BODY }, { chunks: [chunk(ALPHA), chunk(BETA)] }),
    ).not.toThrow();
  });

  it("accepts no chunks for a body with no text", () => {
    expect(() => verifyChunks({ body: "\n\n" }, { chunks: [] })).not.toThrow();
  });

  it("rejects a sidecar that records no chunks for a document with text", () => {
    expect(() => verifyChunks({ body: BODY }, { chunks: [] })).toThrow(
      "the document text between offsets 0 and 14 is in no chunk",
    );
  });

  it("rejects a sidecar that dropped its last chunk", () => {
    expect(() =>
      verifyChunks({ body: BODY }, { chunks: [chunk(ALPHA)] }),
    ).toThrow("the document text between offsets 7 and 14 is in no chunk");
  });

  it("rejects text left uncovered between two chunks", () => {
    const head = { start: 2, end: 4 };
    expect(() =>
      verifyChunks({ body: BODY }, { chunks: [chunk(head), chunk(BETA)] }),
    ).toThrow("the document text between offsets 4 and 9 is in no chunk");
  });

  it("rejects a chunk whose text differs from its recorded hash", () => {
    const damaged = { ...chunk(ALPHA), hash: "0".repeat(64) };
    expect(() =>
      verifyChunks({ body: BODY }, { chunks: [damaged, chunk(BETA)] }),
    ).toThrow(new SidecarError("chunk 0 does not match the document text"));
  });

  it("rejects a chunk that ends past the document", () => {
    const past = { ...chunk(BETA), end: 99 };
    expect(() =>
      verifyChunks({ body: BODY }, { chunks: [chunk(ALPHA), past] }),
    ).toThrow("chunk 1 ends at 99, past the end of the document (14)");
  });
});
