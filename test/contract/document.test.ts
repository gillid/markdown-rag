import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseFrontmatterMetadata } from "../../src/contract/document.ts";

describe("parseFrontmatterMetadata", () => {
  it("accepts the required fields alone", () => {
    const metadata = parseFrontmatterMetadata({
      title: "Minimal",
      source: "docs",
      updated_at: "2026-01-15",
    });
    expect(metadata).toEqual({
      title: "Minimal",
      source: "docs",
      updatedAt: new Date("2026-01-15").getTime(),
      url: undefined,
      tags: [],
      signals: {},
      meta: {},
    });
  });

  it("reads every optional field and passes unknown keys through as meta", () => {
    const metadata = parseFrontmatterMetadata({
      title: "Full",
      source: "docs",
      updated_at: "2026-02-20",
      url: "https://example.com/full",
      tags: ["runbook", "payments"],
      signals: { authority: 0.8, curated: 1 },
      source_id: "ext-123",
    });
    expect(metadata.url).toBe("https://example.com/full");
    expect(metadata.tags).toEqual(["runbook", "payments"]);
    expect(metadata.signals).toEqual({ authority: 0.8, curated: 1 });
    expect(metadata.meta).toEqual({ source_id: "ext-123" });
  });

  it("rejects a missing required field", () => {
    expect(() =>
      parseFrontmatterMetadata({ source: "docs", updated_at: "2026-01-15" }),
    ).toThrow(z.ZodError);
  });

  it("rejects an empty required field", () => {
    expect(() =>
      parseFrontmatterMetadata({
        title: "",
        source: "docs",
        updated_at: "2026-01-15",
      }),
    ).toThrow(z.ZodError);
  });

  it("rejects a signal value above 1", () => {
    expect(() =>
      parseFrontmatterMetadata({
        title: "T",
        source: "docs",
        updated_at: "2026-01-15",
        signals: { authority: 1.5 },
      }),
    ).toThrow(z.ZodError);
  });

  it("rejects a signal value below 0", () => {
    expect(() =>
      parseFrontmatterMetadata({
        title: "T",
        source: "docs",
        updated_at: "2026-01-15",
        signals: { authority: -0.1 },
      }),
    ).toThrow(z.ZodError);
  });

  it("rejects the reserved 'recency' signal name", () => {
    expect(() =>
      parseFrontmatterMetadata({
        title: "T",
        source: "docs",
        updated_at: "2026-01-15",
        signals: { recency: 0.5 },
      }),
    ).toThrow(z.ZodError);
  });

  it("rejects an upper-case signal name", () => {
    expect(() =>
      parseFrontmatterMetadata({
        title: "T",
        source: "docs",
        updated_at: "2026-01-15",
        signals: { Authority: 0.5 },
      }),
    ).toThrow(z.ZodError);
  });

  it("rejects frontmatter that isn't a mapping", () => {
    expect(() => parseFrontmatterMetadata("just a string")).toThrow(z.ZodError);
  });
});
