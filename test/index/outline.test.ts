import { describe, expect, it } from "vitest";
import { parseDocument } from "../../src/contract/tree.ts";
import { buildHeadings } from "../../src/index/outline.ts";

function headingsOf(body: string) {
  const parsed = parseDocument(`---\ntitle: T\n---\n${body}`);
  return { parsed, ...buildHeadings(parsed.tree, parsed.body.length) };
}

function outlineOf(body: string) {
  return headingsOf(body).outline;
}

function sectionsOf(body: string) {
  const { parsed, sections } = headingsOf(body);
  return Object.fromEntries(
    [...sections].map(([anchor, { start, end }]) => [
      anchor,
      parsed.body.slice(start, end),
    ]),
  );
}

describe("buildHeadings", () => {
  it("lists headings in order with their depth, text and unique anchors", () => {
    expect(
      outlineOf(
        "# Intro\n\ntext\n\n## Setup\n\n## Setup\n\n### Deep dive\n\n## Wrap up\n",
      ),
    ).toEqual([
      { depth: 1, text: "Intro", anchor: "intro" },
      { depth: 2, text: "Setup", anchor: "setup" },
      { depth: 2, text: "Setup", anchor: "setup-1" },
      { depth: 3, text: "Deep dive", anchor: "deep-dive" },
      { depth: 2, text: "Wrap up", anchor: "wrap-up" },
    ]);
  });

  it("is empty for a document without headings", () => {
    expect(outlineOf("Just a paragraph.\n")).toEqual([]);
  });

  it("ends a section at the next heading of the same or a shallower depth", () => {
    expect(
      sectionsOf("# A\n\na\n\n## B\n\nb\n\n### C\n\nc\n\n## D\n\nd\n"),
    ).toEqual({
      a: "# A\n\na\n\n## B\n\nb\n\n### C\n\nc\n\n## D\n\nd\n",
      b: "## B\n\nb\n\n### C\n\nc\n\n",
      c: "### C\n\nc\n\n",
      d: "## D\n\nd\n",
    });
  });

  it("closes a deeper section when a shallower heading follows, whatever the levels skipped", () => {
    expect(sectionsOf("# A\n\n### C\n\nc\n\n## B\n\nb\n")).toEqual({
      a: "# A\n\n### C\n\nc\n\n## B\n\nb\n",
      c: "### C\n\nc\n\n",
      b: "## B\n\nb\n",
    });
  });

  it("gives a repeated heading its own section under its unique anchor", () => {
    expect(sectionsOf("## Setup\n\nfirst\n\n## Setup\n\nsecond\n")).toEqual({
      setup: "## Setup\n\nfirst\n\n",
      "setup-1": "## Setup\n\nsecond\n",
    });
  });

  it("skips empty and HTML-only headings", () => {
    expect(outlineOf("## Real\n\n##\n\n## <br>\n\ntext\n")).toEqual([
      { depth: 2, text: "Real", anchor: "real" },
    ]);
  });
});
