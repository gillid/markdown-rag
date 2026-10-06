import { describe, expect, it } from "vitest";
import { deepFreeze } from "../../src/index/deep-freeze.ts";

describe("deepFreeze", () => {
  it("freezes nested objects and arrays", () => {
    const value = deepFreeze({ list: [{ name: "a" }], nested: { n: 1 } });

    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.list)).toBe(true);
    expect(Object.isFrozen(value.list[0])).toBe(true);
    expect(Object.isFrozen(value.nested)).toBe(true);
  });

  it("stops at a structure that refers back to itself", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(Object.isFrozen(deepFreeze(cyclic))).toBe(true);
  });

  it("leaves other objects and primitives alone", () => {
    const date = new Date(0);

    expect(deepFreeze(date)).toBe(date);
    expect(Object.isFrozen(date)).toBe(false);
    expect(deepFreeze("text")).toBe("text");
    expect(deepFreeze(null)).toBeNull();
  });
});
