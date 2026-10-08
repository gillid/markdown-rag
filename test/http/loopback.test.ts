import { describe, expect, it } from "vitest";
import { loopbackNames } from "../../src/http/loopback.ts";

describe("loopbackNames", () => {
  it("names this machine for every spelling of a loopback address", () => {
    expect(loopbackNames("127.0.0.1")).toEqual([
      "localhost",
      "127.0.0.1",
      "[::1]",
    ]);
    expect(loopbackNames("LOCALHOST")).toEqual([
      "localhost",
      "127.0.0.1",
      "[::1]",
    ]);
    expect(loopbackNames("::1")).toEqual(["localhost", "127.0.0.1", "[::1]"]);
    expect(loopbackNames("0:0:0:0:0:0:0:1")).toEqual([
      "localhost",
      "127.0.0.1",
      "[::1]",
    ]);
    expect(loopbackNames("127.0.0.2")).toEqual([
      "localhost",
      "127.0.0.1",
      "[::1]",
      "127.0.0.2",
    ]);
  });

  it("sees through shorthand, brackets, a trailing dot and a mapped IPv4 address", () => {
    const own = ["localhost", "127.0.0.1", "[::1]"];

    expect(loopbackNames("127.1")).toEqual(own);
    expect(loopbackNames("[::1]")).toEqual(own);
    expect(loopbackNames("localhost.")).toEqual(own);
    expect(loopbackNames("::ffff:127.0.0.1")).toEqual([
      ...own,
      "[::ffff:7f00:1]",
    ]);
  });

  it("returns undefined for an address that is reachable from elsewhere", () => {
    for (const host of [
      "0.0.0.0",
      "::",
      "10.0.0.5",
      "kb.internal",
      "128.0.0.1",
    ]) {
      expect(loopbackNames(host)).toBeUndefined();
    }
  });
});
