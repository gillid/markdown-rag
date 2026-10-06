import { describe, expect, it } from "vitest";
import { withDefaults } from "../../src/retrieval/options.ts";

describe("withDefaults", () => {
  it("keeps the built-in recency weight when a weight for another signal is configured", () => {
    expect(withDefaults({ weights: { authority: 0.3 } }).weights).toEqual({
      recency: 0.15,
      authority: 0.3,
    });
  });

  it("lets a configured weight replace the built-in one, so recency is switched off with 0", () => {
    expect(withDefaults({ weights: { recency: 0 } }).weights).toEqual({
      recency: 0,
    });
    expect(withDefaults({ weights: { recency: 0.4 } }).weights).toEqual({
      recency: 0.4,
    });
  });

  it("keeps the built-in weights when none are configured or one is undefined", () => {
    expect(withDefaults().weights).toEqual({ recency: 0.15 });
    expect(
      withDefaults({ weights: { recency: undefined } as never }).weights,
    ).toEqual({ recency: 0.15 });
  });

  it("does not share its weights with the module's defaults", () => {
    const first = withDefaults();
    (first.weights as Record<string, number>).recency = 0.5;

    expect(withDefaults().weights).toEqual({ recency: 0.15 });
  });
});
