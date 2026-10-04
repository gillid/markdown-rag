import { describe, expect, it } from "vitest";
import { parseDocument } from "../../src/contract/tree.ts";
import { buildOutline } from "../../src/index/outline.ts";

function outlineOf(body: string) {
  const { tree } = parseDocument(`---\ntitle: T\n---\n${body}`);
  return buildOutline(tree);
}

describe("buildOutline", () => {
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

  it("skips empty and HTML-only headings", () => {
    expect(outlineOf("## Real\n\n##\n\n## <br>\n\ntext\n")).toEqual([
      { depth: 2, text: "Real", anchor: "real" },
    ]);
  });
});
