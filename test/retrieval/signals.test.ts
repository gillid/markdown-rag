import { describe, expect, it } from "vitest";
import { capPerDocument } from "../../src/retrieval/candidates.ts";
import {
  blend,
  normaliseScores,
  recencyScore,
  sigmoid,
  signalValues,
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
        { recency: 0.15, "tag:runbook": 0.2 },
        { recency: 0.5, tags: 1 },
      ),
    ).toBeCloseTo(0.795, 12);
  });

  it("subtracts a penalty and still gives relevance 1 minus the largest tag weight", () => {
    // 0.9 * 0.8 + 0.1 * -1
    expect(blend(0.8, { "tag:slack": -0.1 }, { tags: -1 })).toBeCloseTo(
      0.62,
      12,
    );
  });

  it("is the relevance alone with no weights", () => {
    expect(blend(0.42, {}, {})).toBe(0.42);
  });
});

describe("signalValues", () => {
  const weights = { recency: 0.1, "tag:runbook": 0.2, "tag:slack": -0.1 };

  it("scales the largest matching tag weight by the largest weight, so tags is in [-1, 1]", () => {
    expect(signalValues(weights, 0.5, ["runbook"])).toEqual({
      recency: 0.5,
      tags: 1,
    });
    expect(signalValues(weights, 0.5, ["slack"])).toEqual({
      recency: 0.5,
      tags: -0.5,
    });
  });

  it("takes the matching tag of the largest magnitude, not the sum", () => {
    expect(signalValues(weights, 0.5, ["slack", "runbook"]).tags).toBe(1);
  });

  it("lets a penalty win a tie of magnitudes", () => {
    const tied = { "tag:a": 0.1, "tag:b": -0.1 };

    expect(signalValues(tied, 0, ["a", "b"]).tags).toBe(-1);
  });

  it("is 0 for a document with none of the weighted tags, and absent without tag weights", () => {
    expect(signalValues(weights, 0.5, ["other"]).tags).toBe(0);
    expect(signalValues({ recency: 0.1 }, 0.5, ["runbook"])).toEqual({
      recency: 0.5,
    });
  });
});

describe("validateWeights", () => {
  const known = new Set(["runbook", "slack"]);

  it("accepts recency up to exactly 0.5, and no weights at all", () => {
    expect(() => validateWeights({ recency: 0.5 })).not.toThrow();
    expect(() => validateWeights({})).not.toThrow();
  });

  it("accepts signed tag weights for tags that exist", () => {
    expect(() =>
      validateWeights({ "tag:runbook": 0.3, "tag:slack": -0.4 }, known),
    ).not.toThrow();
  });

  it("caps recency plus the largest tag weight by magnitude, not the sum of tag weights", () => {
    expect(() =>
      validateWeights({ recency: 0.2, "tag:runbook": 0.3 }),
    ).not.toThrow();
    expect(() =>
      validateWeights({ "tag:runbook": 0.5, "tag:slack": -0.5 }),
    ).not.toThrow();
  });

  it.each([
    [{ recency: -0.1 }, "[0, 1]"],
    [{ recency: 1.5 }, "[0, 1]"],
    [{ recency: Number.NaN }, "[0, 1]"],
    [{ recency: 0.6 }, "at most 0.5"],
    [{ "tag:runbook": -1.5 }, "[-1, 1]"],
    [{ "tag:slack": -0.6 }, "at most 0.5"],
    [{ recency: 0.3, "tag:runbook": 0.3 }, "at most 0.5"],
    [{ authority: 0.1 }, 'the signals are "recency" and "tag:<tag>"'],
    [{ "tag:": 0.1 }, 'the signals are "recency" and "tag:<tag>"'],
  ])("rejects %j", (weights, message) => {
    expect(() => validateWeights(weights)).toThrow(message);
  });

  it("hints at the default recency weight only when it is the one in use", () => {
    expect(() =>
      validateWeights({ recency: 0.15, "tag:runbook": 0.4 }),
    ).toThrow("the default; set recency to lower it");
    expect(() => validateWeights({ recency: 0.6 })).toThrow(
      /recency weight 0\.6 plus/,
    );
    expect(() => validateWeights({ recency: 0.3, "tag:runbook": 0.3 })).toThrow(
      /recency weight 0\.3 plus/,
    );
  });

  it("rejects a weight for a tag no document carries, when the tags are known", () => {
    expect(() => validateWeights({ "tag:runbok": 0.1 }, known)).toThrow(
      'no document has the tag "runbok"',
    );
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
