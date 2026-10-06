import type { PreTrainedTokenizer } from "@huggingface/transformers";
import { describe, expect, it } from "vitest";
import { EmbedderError } from "../../src/models/embedder.ts";
import type { ModelPreset } from "../../src/models/presets.ts";
import { assertFitsWindow } from "../../src/models/token-window.ts";

const preset: ModelPreset = {
  id: "test-model",
  repository: "org/test-model",
  revision: "abc123",
  dtype: "q8",
  maxTokens: 5,
};

/** One token per word, which is all the check needs from a tokenizer. */
const wordTokenizer = ((text: string) => ({
  input_ids: { dims: [1, text.split(" ").length] },
})) as unknown as PreTrainedTokenizer;

describe("assertFitsWindow", () => {
  it("accepts texts up to the window, boundary included", () => {
    expect(() =>
      assertFitsWindow(wordTokenizer, ["a b c", "a b c d e"], preset, "chunk"),
    ).not.toThrow();
  });

  it("rejects a chunk past the window instead of letting it be truncated, naming it", () => {
    const check = () =>
      assertFitsWindow(
        wordTokenizer,
        ["short", "a b c d e f"],
        preset,
        "chunk",
      );

    expect(check).toThrow(EmbedderError);
    expect(check).toThrow(
      'A chunk of 6 tokens (starting "a b c d e f") exceeds the 5-token window of test-model. The chunker never splits code blocks or tables, so shorten or split that part of the document.',
    );
  });

  it("rejects a query past the window with advice about the query, not the chunker", () => {
    const check = () =>
      assertFitsWindow(wordTokenizer, ["a b c d e f"], preset, "query");

    expect(check).toThrow(RangeError);
    expect(check).toThrow(
      "The query is 6 tokens, over the 5-token window of test-model (its instruction prefix included); shorten it.",
    );
  });
});
