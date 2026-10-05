import { describe, expect, it } from "vitest";
import { createPairFitter } from "../../src/models/fit-pair.ts";

const words = (count: number, prefix = "w") =>
  Array.from({ length: count }, (_, i) => `${prefix}${i}`).join(" ");

// One token per whitespace-separated word; a pair gets `specials` extra tokens; `decode` joins words by `joiner`.
function wordTokenizer({ joiner = " ", specials = 3 } = {}) {
  const vocab: string[] = [];
  return {
    encode(
      text: string,
      options: { text_pair?: string | null; add_special_tokens?: boolean } = {},
    ) {
      const idsOf = (value: string) =>
        value
          .split(/\s+/)
          .filter(Boolean)
          .map((word) => {
            const known = vocab.indexOf(word);
            if (known >= 0) return known;
            vocab.push(word);
            return vocab.length - 1;
          });
      // Like transformers.js, an empty text_pair is no pair.
      const pair = options.text_pair ? idsOf(options.text_pair) : undefined;
      const ids = [...idsOf(text), ...(pair ?? [])];
      if (options.add_special_tokens === false) return ids;
      return [...ids, ...Array<number>(pair ? specials : 2).fill(-1)];
    },
    decode(ids: number[] | bigint[]) {
      return ids.map((id) => vocab[Number(id)]).join(joiner);
    },
  };
}

describe("createPairFitter", () => {
  it("leaves pairs that already fit untouched", () => {
    const fitter = createPairFitter(wordTokenizer(), "a b c", 512);
    expect(fitter.query).toBe("a b c");
    expect(fitter.fitPassage("d e")).toBe("d e");
  });

  it("gives a passage the budget left after the query and the pair's special tokens", () => {
    const fitter = createPairFitter(wordTokenizer(), "q1 q2", 20);
    // 20 - 3 special - 2 query tokens
    expect(fitter.fitPassage(words(100))).toBe(words(15));
  });

  it("takes the special-token count from the tokenizer", () => {
    const fitter = createPairFitter(
      wordTokenizer({ specials: 4 }),
      "q1 q2",
      20,
    );
    // 20 - 4 special - 2 query tokens
    expect(fitter.fitPassage(words(100))).toBe(words(14));
  });

  it("caps a long query at 128 tokens and still leaves room for the passage", () => {
    const fitter = createPairFitter(wordTokenizer(), words(400, "q"), 512);
    expect(fitter.query).toBe(words(128, "q"));
    // 512 - 3 - 128
    expect(fitter.fitPassage(words(600))).toBe(words(381));
  });

  it("scales the query cap down for a small window so passages keep room", () => {
    const fitter = createPairFitter(wordTokenizer(), words(400, "q"), 40);
    // a quarter of the window
    expect(fitter.query).toBe(words(10, "q"));
    // 40 - 3 special - 10 query tokens
    expect(fitter.fitPassage(words(100))).toBe(words(27));
  });

  it("has no fitted passage when the tokenizer finds no token in it", () => {
    const fitter = createPairFitter(wordTokenizer(), "q", 512);
    // The fake tokenizer drops whitespace, as a real one drops characters it strips.
    expect(fitter.fitPassage("  ")).toBeUndefined();
  });

  it("refuses a query the tokenizer finds no token in", () => {
    expect(() => createPairFitter(wordTokenizer(), " ", 512)).toThrow(
      /no token/,
    );
  });

  it("refuses a window with no room for a passage", () => {
    expect(() => createPairFitter(wordTokenizer(), "q", 3)).toThrow(
      /no room for a passage/,
    );
  });

  it("trims further when decoding re-encodes to more tokens than were kept", () => {
    // Joining with " - " makes n kept words re-encode to 2n - 1 tokens.
    const tokenizer = wordTokenizer({ joiner: " - " });
    const fitter = createPairFitter(tokenizer, "q", 14);
    const fitted = fitter.fitPassage(words(50)) ?? "";
    // 14 - 3 special - 1 query token
    expect(
      tokenizer.encode(fitted, { add_special_tokens: false }),
    ).toHaveLength(9);
    expect(fitted).toBe(words(5).split(" ").join(" - "));
  });
});
