import { describe, expect, it } from "vitest";
import { decodeVector, encodeVector } from "../../src/sidecars/vector-codec.ts";

describe("vector codec", () => {
  it("encodes to a known base64 literal", () => {
    expect(encodeVector(new Float32Array([1, 0.5, -2, 0.25]), 4)).toBe(
      "ADwAOADAADQ=",
    );
  });

  it("decodes a known base64 literal", () => {
    expect([...decodeVector("ADwAOADAADQ=", 4)]).toEqual([1, 0.5, -2, 0.25]);
  });

  it("round-trips within float16 precision", () => {
    const vector = new Float32Array([
      0.123456, -0.654321, 0.0421, 0.999, -0.001,
    ]);

    const decoded = decodeVector(
      encodeVector(vector, vector.length),
      vector.length,
    );

    expect(decoded).toHaveLength(vector.length);
    for (const [i, value] of vector.entries()) {
      expect(Math.abs((decoded[i] as number) - value)).toBeLessThanOrEqual(
        Math.abs(value) * 2 ** -10,
      );
    }
  });

  it("accepts a value that float16 rounds down to its maximum", () => {
    expect([
      ...decodeVector(encodeVector(new Float32Array([65510]), 1), 1),
    ]).toEqual([65504]);
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a value above the float16 range", 70000],
  ])("refuses to encode %s", (_name, value) => {
    expect(() => encodeVector(new Float32Array([value]), 1)).toThrow(/float16/);
  });

  it("refuses to decode a non-finite value", () => {
    expect(() => decodeVector("AHwAAAAAAAA=", 4)).toThrow(/non-finite/);
  });

  it.each([
    "ADwA!OADAADQ=",
    "ADwAOADAADQ",
    " ADwAOADAADQ=",
    "ADwAOADAADQ==",
    "ADwAOADAADR=",
  ])("rejects non-canonical base64 %j", (encoded) => {
    expect(() => decodeVector(encoded, 4)).toThrow(/base64/);
  });

  it("refuses to encode a vector whose length does not match dims", () => {
    expect(() => encodeVector(new Float32Array([1, 2, 3]), 4)).toThrow(
      /3 dims, expected 4/,
    );
  });

  it("rejects a vector whose length does not match dims", () => {
    expect(() => decodeVector("ADwAOADAADQ=", 3)).toThrow(/expected 6/);
  });
});
