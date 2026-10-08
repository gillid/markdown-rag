import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseFrontmatterMetadata } from "../../src/contract/document.ts";

describe("parseFrontmatterMetadata", () => {
  it("accepts the required fields alone, with no tags", () => {
    const metadata = parseFrontmatterMetadata({
      title: "Minimal",
      updated_at: "2026-01-15",
      tags: [],
    });
    expect(metadata).toEqual({
      title: "Minimal",
      updatedAt: new Date("2026-01-15").getTime(),
      tags: [],
      meta: {},
    });
  });

  describe("updated_at", () => {
    const parse = (updated_at: unknown) =>
      parseFrontmatterMetadata({ title: "T", tags: [], updated_at });

    it.each([
      ["2026-01-15", 1768435200000],
      ["2026-01-15T08:00:00Z", 1768464000000],
      ["2026-01-15T10:00:00+02:00", 1768464000000],
      ["2026-01-15 10:30:00-00:00", 1768473000000],
      ["2026-01-15T10:30Z", 1768473000000],
      ["0000-02-29", -62162121600000],
    ])("reads %s as a fixed instant", (value, expected) => {
      expect(parse(value).updatedAt).toBe(expected);
    });

    it.each([
      ["a date-time with no zone", "2026-01-15T10:00:00"],
      ["a non-ISO date", "15 January 2026"],
      ["a day that doesn't exist", "2026-02-30"],
      ["a leap day in a year that has none", "2026-02-29"],
      ["a month that doesn't exist", "2026-13-01"],
      ["an hour that doesn't exist", "2026-01-15T25:00:00Z"],
      [
        "24:00, which some parsers roll to the next day",
        "2026-01-15T24:00:00Z",
      ],
      ["a minute that doesn't exist", "2026-01-15T23:60:00Z"],
      ["an offset hour that doesn't exist", "2026-01-15T10:00:00+24:00"],
      ["an empty value", null],
      ["a number", 2026],
      ["a boolean", true],
      ["a date object", new Date("2026-01-15")],
    ])("rejects %s", (_, value) => {
      expect(() => parse(value)).toThrow(z.ZodError);
    });
  });

  it("reads the tags and passes unknown keys through as meta", () => {
    const metadata = parseFrontmatterMetadata({
      title: "Full",
      updated_at: "2026-02-20",
      tags: ["runbook", "payments"],
      source: "docs",
      url: "https://example.com/full",
      source_id: "ext-123",
    });
    expect(metadata.tags).toEqual(["runbook", "payments"]);
    expect(metadata.meta).toEqual({
      source: "docs",
      url: "https://example.com/full",
      source_id: "ext-123",
    });
  });

  it("rejects a missing required field", () => {
    expect(() =>
      parseFrontmatterMetadata({ updated_at: "2026-01-15", tags: [] }),
    ).toThrow(z.ZodError);
    expect(() => parseFrontmatterMetadata({ title: "T", tags: [] })).toThrow(
      z.ZodError,
    );
    expect(() =>
      parseFrontmatterMetadata({ title: "T", updated_at: "2026-01-15" }),
    ).toThrow(z.ZodError);
  });

  it("rejects an empty title", () => {
    expect(() =>
      parseFrontmatterMetadata({
        title: "",
        updated_at: "2026-01-15",
        tags: [],
      }),
    ).toThrow(z.ZodError);
  });

  it("rejects tags that are not a list of strings", () => {
    expect(() =>
      parseFrontmatterMetadata({
        title: "T",
        updated_at: "2026-01-15",
        tags: "runbook",
      }),
    ).toThrow(z.ZodError);
  });
});
