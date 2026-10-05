import { describe, expect, it } from "vitest";
import { capPerDocument } from "../../src/retrieval/candidates.ts";
import {
  blend,
  normaliseScores,
  recencyScore,
  sigmoid,
  validateWeights,
} from "../../src/retrieval/signals.ts";

const DAY = 86_400_000;

describe("recencyScore", () => {
  it("halves every half-life", () => {
    expect(recencyScore(0, 90 * DAY, 90)).toBeCloseTo(0.5, 12);
    expect(recencyScore(0, 180 * DAY, 90)).toBeCloseTo(0.25, 12);
  });

  it("is 1 for a document updated now or in the future", () => {
    expect(recencyScore(5 * DAY, 5 * DAY, 90)).toBe(1);
    expect(recencyScore(9 * DAY, 5 * DAY, 90)).toBe(1);
  });
});

describe("blend", () => {
  it("gives (1 - sum of weights) to relevance and each weight to its signal", () => {
    // 0.65 * 0.8 + 0.15 * 0.5 + 0.2 * 1
    expect(
      blend(
        0.8,
        { recency: 0.15, authority: 0.2 },
        { recency: 0.5, authority: 1 },
      ),
    ).toBeCloseTo(0.795, 12);
  });

  it("is the relevance alone with no weights", () => {
    expect(blend(0.42, {}, {})).toBe(0.42);
  });
});

describe("validateWeights", () => {
  const declared = new Set(["authority"]);

  it("accepts recency, a declared signal, and a total of exactly 0.5", () => {
    expect(() =>
      validateWeights({ recency: 0.3, authority: 0.2 }, declared),
    ).not.toThrow();
  });

  it("accepts weights whose floating-point sum is a rounding error above 0.5", () => {
    expect(() =>
      validateWeights(
        { recency: 0.1, authority: 0.2, reviewed: 0.2 },
        new Set(["authority", "reviewed"]),
      ),
    ).not.toThrow();
  });

  it.each([
    [{ recency: -0.1 }, "[0, 1]"],
    [{ recency: 1.5 }, "[0, 1]"],
    [{ recency: Number.NaN }, "[0, 1]"],
    [{ recency: 0.3, authority: 0.3 }, "at most 0.5"],
    [{ reviewed: 0.1 }, "no document declares"],
  ])("rejects %j", (weights, message) => {
    expect(() => validateWeights(weights, declared)).toThrow(message);
  });
});

describe("capPerDocument", () => {
  it("keeps each document's best two candidates in order", () => {
    const candidates = [
      { path: "a.md", ordinal: 0, score: 9 },
      { path: "a.md", ordinal: 1, score: 8 },
      { path: "b.md", ordinal: 0, score: 7 },
      { path: "a.md", ordinal: 2, score: 6 },
      { path: "b.md", ordinal: 3, score: 5 },
    ];

    expect(capPerDocument(candidates, 2).map((c) => c.score)).toEqual([
      9, 8, 7, 5,
    ]);
  });
});

describe("sigmoid", () => {
  it("maps logits to (0, 1) around 0.5", () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(1)).toBeCloseTo(0.7310585786, 10);
    expect(sigmoid(-1)).toBeCloseTo(0.2689414214, 10);
  });
});

describe("normaliseScores", () => {
  it("scales the best candidate to 1", () => {
    expect(normaliseScores([4, 2, 1])).toEqual([1, 0.5, 0.25]);
  });

  it("maps non-positive scores to 0", () => {
    expect(normaliseScores([0, 0])).toEqual([0, 0]);
    expect(normaliseScores([2, -1])).toEqual([1, 0]);
  });
});
