import { describe, expect, it } from "vitest";
import {
  hashDocument,
  normalizeLineEndings,
  normalizeText,
} from "../../src/contract/hash.ts";

describe("normalizeLineEndings", () => {
  it("converts CRLF to LF", () => {
    expect(normalizeLineEndings("a\r\nb\r\nc")).toBe("a\nb\nc");
  });

  it("leaves LF-only text unchanged", () => {
    expect(normalizeLineEndings("a\nb\nc")).toBe("a\nb\nc");
  });
});

// Built from the code unit so no editor or formatter can strip it from the source.
const BOM = String.fromCharCode(0xfeff);

describe("normalizeText", () => {
  it("drops a leading byte order mark and normalises line endings", () => {
    expect(normalizeText(`${BOM}---\r\ntitle: A\r\n---\r\n`)).toBe(
      "---\ntitle: A\n---\n",
    );
  });

  it("leaves text without a byte order mark untouched", () => {
    expect(normalizeText("abc")).toBe("abc");
  });

  it("keeps a byte order mark that is not leading", () => {
    expect(normalizeText(`a${BOM}b`)).toBe(`a${BOM}b`);
  });
});

describe("hashDocument", () => {
  // Known SHA-256 vectors, computed independently with `sha256sum`.
  it("matches the known SHA-256 of an empty string", () => {
    expect(hashDocument("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches the known SHA-256 of 'hello'", () => {
    expect(hashDocument("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("gives CRLF and LF versions of a document the same hash once normalised", () => {
    const lf = "line one\nline two\n";
    const crlf = "line one\r\nline two\r\n";
    expect(hashDocument(normalizeLineEndings(crlf))).toBe(
      hashDocument(normalizeLineEndings(lf)),
    );
  });
});
