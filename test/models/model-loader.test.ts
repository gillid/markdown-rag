import { describe, expect, it } from "vitest";
import { lazyModel } from "../../src/models/model-loader.ts";
import type { ModelPreset } from "../../src/models/presets.ts";

class UnavailableError extends Error {}

const preset: ModelPreset = {
  id: "test-model",
  repository: "org/test-model",
  revision: "abc123",
  dtype: "q8",
  maxTokens: 512,
};

describe("lazyModel", () => {
  it("loads once and shares the result between calls", async () => {
    let loads = 0;
    const get = lazyModel(preset, UnavailableError, async () => ++loads);
    expect(await Promise.all([get(), get()])).toEqual([1, 1]);
    expect(await get()).toBe(1);
  });

  it("does not load until first used", () => {
    let loads = 0;
    lazyModel(preset, UnavailableError, async () => ++loads);
    expect(loads).toBe(0);
  });

  it("wraps a load failure, naming the model and keeping the cause", async () => {
    const cause = new Error("disk full");
    const get = lazyModel(preset, UnavailableError, async () => {
      throw cause;
    });
    const failure = get();
    await expect(failure).rejects.toThrow(UnavailableError);
    await expect(failure).rejects.toThrow(
      "Could not load test-model: disk full",
    );
    await expect(failure).rejects.toMatchObject({ cause });
  });

  it("passes an unavailable error through unchanged", async () => {
    const original = new UnavailableError("not cached");
    const get = lazyModel(preset, UnavailableError, async () => {
      throw original;
    });
    await expect(get()).rejects.toBe(original);
  });

  it("retries after a failed load", async () => {
    let attempts = 0;
    const get = lazyModel(preset, UnavailableError, async () => {
      if (++attempts === 1) throw new Error("network blip");
      return "loaded";
    });
    await expect(get()).rejects.toThrow(UnavailableError);
    expect(await get()).toBe("loaded");
    expect(attempts).toBe(2);
  });
});
