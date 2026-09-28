import { describe, expect, it } from "vitest";
import { FrontmatterError, parseDocument } from "../../src/contract/tree.ts";

describe("parseDocument", () => {
  it("returns the frontmatter, and a body that excludes it", () => {
    const doc = [
      "---",
      "title: Sample",
      "source: docs",
      "---",
      "",
      "# Heading",
      "",
    ].join("\n");
    const { frontmatter, body } = parseDocument(doc);
    expect(frontmatter).toEqual({ title: "Sample", source: "docs" });
    expect(body).toBe("\n\n# Heading\n");
  });

  it("gives the body tree offsets that resolve back to the expected text", () => {
    const doc = [
      "---",
      "title: Sample",
      "source: docs",
      "---",
      "",
      "# Heading",
      "",
      "Body text.",
    ].join("\n");
    const { body, tree } = parseDocument(doc);
    const heading = tree.children[0];
    expect(heading?.type).toBe("heading");
    expect(heading?.position).toBeDefined();
    const start = heading?.position?.start.offset;
    const end = heading?.position?.end.offset;
    expect(typeof start).toBe("number");
    expect(typeof end).toBe("number");
    expect(body.slice(start, end)).toBe("# Heading");

    const paragraph = tree.children[1];
    const pStart = paragraph?.position?.start.offset;
    const pEnd = paragraph?.position?.end.offset;
    expect(body.slice(pStart, pEnd)).toBe("Body text.");
  });

  it("throws FrontmatterError when there is no frontmatter block", () => {
    expect(() => parseDocument("# No frontmatter\n")).toThrow(FrontmatterError);
  });

  it("throws FrontmatterError on malformed YAML", () => {
    const doc = [
      "---",
      'title: "Unterminated',
      "source: docs",
      "---",
      "",
      "# Heading",
    ].join("\n");
    expect(() => parseDocument(doc)).toThrow(FrontmatterError);
  });
});
