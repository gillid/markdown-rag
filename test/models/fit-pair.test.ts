import { describe, expect, it } from "vitest";
import { fitPair } from "../../src/models/fit-pair.ts";

const words = (count: number, prefix = "w") =>
  Array.from({ length: count }, (_, i) => `${prefix}${i}`).join(" ");

// One token per whitespace-separated word; `decode` joins ids back by their word index.
function wordTokenizer(joiner = " ") {
  const vocab: string[] = [];
  return {
    encode(text: string) {
      return text
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => {
          const known = vocab.indexOf(word);
          if (known >= 0) return known;
          vocab.push(word);
          return vocab.length - 1;
        });
    },
    decode(ids: number[] | bigint[]) {
      return ids.map((id) => vocab[Number(id)]).join(joiner);
    },
  };
}

describe("fitPair", () => {
  it("leaves pairs that already fit untouched", () => {
    const fitted = fitPair(wordTokenizer(), "a b c", ["d e", "f"], 512);
    expect(fitted).toEqual({ query: "a b c", passages: ["d e", "f"] });
  });

  it("gives a passage the budget left after the query and the 3 special tokens", () => {
    const fitted = fitPair(wordTokenizer(), "q1 q2", [words(100)], 20);
    // 20 - 3 special - 2 query tokens
    expect(fitted.passages[0]).toBe(words(15));
  });

  it("caps a long query at 128 tokens and still leaves room for the passage", () => {
    const fitted = fitPair(wordTokenizer(), words(400, "q"), [words(600)], 512);
    expect(fitted.query).toBe(words(128, "q"));
    // 512 - 3 - 128
    expect(fitted.passages[0]).toBe(words(381));
  });

  it("trims further when decoding re-encodes to more tokens than were kept", () => {
    // Joining with " - " makes n kept words re-encode to 2n - 1 tokens.
    const fitted = fitPair(wordTokenizer(" - "), "q", [words(50)], 14);
    const budget = 14 - 3 - 1;
    const reencoded = wordTokenizer().encode(fitted.passages[0] as string);
    expect(reencoded.length).toBeLessThanOrEqual(budget);
    expect(fitted.passages[0]).toBe(
      Array.from({ length: 5 }, (_, i) => `w${i}`).join(" - "),
    );
  });
});
