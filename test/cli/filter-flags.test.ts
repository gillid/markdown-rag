import { describe, expect, it } from "vitest";
import { filterFromFlags } from "../../src/cli/filter-flags.ts";
import { FlagError } from "../../src/cli/flag-error.ts";
import {
  parseIntegerFlag,
  parseNamedNumbers,
  parseNumberFlag,
} from "../../src/cli/flag-values.ts";

describe("filterFromFlags", () => {
  it("maps each flag onto its filter field", () => {
    expect(
      filterFromFlags({
        tag: ["a", "b"],
        "tag-any": ["c"],
        dir: "ops/db",
        since: "2026-01-05",
      }),
    ).toEqual({
      tags: ["a", "b"],
      tags_any: ["c"],
      dir: "ops/db",
      updated_after: Date.parse("2026-01-05T00:00:00Z") - 1,
    });
  });

  it("gives an empty filter when no flag is set", () => {
    expect(filterFromFlags({})).toEqual({});
  });

  it("reads a date-time with a zone", () => {
    expect(filterFromFlags({ since: "2026-01-05T10:00:00+02:00" })).toEqual({
      updated_after: Date.parse("2026-01-05T08:00:00Z") - 1,
    });
  });

  it("rejects text that is not an ISO 8601 date or a zoned date-time", () => {
    expect(() => filterFromFlags({ since: "yesterday" })).toThrow(FlagError);
    expect(() => filterFromFlags({ since: "2026-02-30" })).toThrow(
      /not a real date/,
    );
    expect(() => filterFromFlags({ since: "2026-01-05T10:00:00" })).toThrow(
      FlagError,
    );
  });
});

describe("flag values", () => {
  it("parses numbers and integers", () => {
    expect(parseNumberFlag("min-score", "-0.5")).toBe(-0.5);
    expect(parseIntegerFlag("limit", "7")).toBe(7);
  });

  it.each(["", " ", "abc", "0x10", "Infinity", "1,5"])(
    "rejects %j as a number",
    (text) => {
      expect(() => parseNumberFlag("min-score", text)).toThrow(
        /--min-score must be a number/,
      );
    },
  );

  it("rejects a number too large to be finite", () => {
    expect(() => parseNumberFlag("min-score", "1e999")).toThrow(
      /--min-score must be a finite number/,
    );
  });

  it("rejects a fraction where an integer is needed", () => {
    expect(() => parseIntegerFlag("limit", "2.5")).toThrow(
      /--limit must be an integer/,
    );
  });

  it("parses repeated name=value pairs", () => {
    expect(
      parseNamedNumbers("weight", ["recency=0.2", "authority=0.1"]),
    ).toEqual({ recency: 0.2, authority: 0.1 });
  });

  it.each(["recency", "=0.2", "recency=", "recency=high"])(
    "rejects the pair %j",
    (entry) => {
      expect(() => parseNamedNumbers("weight", [entry])).toThrow(FlagError);
    },
  );

  it("rejects __proto__ rather than dropping it", () => {
    expect(() => parseNamedNumbers("weight", ["__proto__=0.5"])).toThrow(
      /cannot name "__proto__"/,
    );
  });

  it("keeps other Object.prototype names as ordinary keys", () => {
    const weights = parseNamedNumbers("weight", ["constructor=0.5"]);

    expect(Object.hasOwn(weights, "constructor")).toBe(true);
  });

  it("rejects a name given twice", () => {
    expect(() =>
      parseNamedNumbers("weight", ["recency=0.2", "recency=0.3"]),
    ).toThrow(/more than once/);
  });
});
