import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChunkerInput } from "../../src/chunking/chunker.ts";
import { createStructuralChunker } from "../../src/chunking/structural-chunker.ts";
import { loadConfig } from "../../src/config/config.ts";
import { loadKnowledgeBase } from "../../src/contract/loader.ts";
import { parseDocument } from "../../src/contract/tree.ts";

function input(title: string, body: string): ChunkerInput {
  const parsed = parseDocument(
    `---\ntitle: ${title}\nsource: docs\n---\n${body}`,
  );
  return { title, body: parsed.body, tree: parsed.tree };
}

async function chunkTexts(doc: ChunkerInput, targetChars?: number) {
  const spans = await createStructuralChunker({ targetChars }).chunk(doc);
  return spans.map((span) => ({
    ...span,
    text: doc.body.slice(span.start, span.end),
  }));
}

const SAMPLE = [
  "",
  "Intro paragraph before any heading.",
  "",
  "# Runbook",
  "",
  "Overview text.",
  "",
  "## Detection",
  "",
  "Watch the dashboard.",
  "",
  "### Alerts",
  "",
  "Page the on-call.",
  "",
  "## Contacts",
  "",
  "Ask in #payments.",
  "",
].join("\n");

describe("createStructuralChunker", () => {
  it("identifies itself for the sidecar", () => {
    expect(createStructuralChunker().id).toBe("structural@1");
  });

  it("starts a new chunk at every heading, even when the sections are tiny", async () => {
    const chunks = await chunkTexts(input("Runbook", SAMPLE));

    expect(
      chunks.map(({ breadcrumb, anchor }) => ({ breadcrumb, anchor })),
    ).toEqual([
      { breadcrumb: "Runbook", anchor: "" },
      { breadcrumb: "Runbook", anchor: "runbook" },
      { breadcrumb: "Runbook › Detection", anchor: "detection" },
      { breadcrumb: "Runbook › Detection › Alerts", anchor: "alerts" },
      { breadcrumb: "Runbook › Contacts", anchor: "contacts" },
    ]);
    expect(chunks[3]?.text).toBe("### Alerts\n\nPage the on-call.\n\n");
  });

  it("packs consecutive blocks of a section up to the target", async () => {
    const body = ["", "# Doc", "", "aaaa", "", "bbbb", "", "cccc", ""].join(
      "\n",
    );

    const roomy = await chunkTexts(input("Doc", body), 1000);
    expect(roomy).toHaveLength(1);

    const tight = await chunkTexts(input("Doc", body), 12);
    expect(tight.map((chunk) => chunk.text.trim())).toEqual([
      "# Doc\n\naaaa",
      "bbbb\n\ncccc",
    ]);
  });

  it("packs content with no heading by size alone", async () => {
    const body = ["", "aaaa", "", "bbbb", "", "cccc", ""].join("\n");
    const chunks = await chunkTexts(input("Thread", body), 10);

    expect(chunks.map((chunk) => chunk.text.trim())).toEqual([
      "aaaa\n\nbbbb",
      "cccc",
    ]);
    expect(chunks.every((chunk) => chunk.anchor === "")).toBe(true);
  });

  it("keeps an oversized code block whole in a chunk of its own", async () => {
    const code = `\`\`\`sh\n${"echo hello\n".repeat(10)}\`\`\``;
    const body = ["", "# Doc", "", "before", "", code, "", "after", ""].join(
      "\n",
    );
    const chunks = await chunkTexts(input("Doc", body), 40);

    expect(chunks.map((chunk) => chunk.text.trim())).toEqual([
      "# Doc\n\nbefore",
      code,
      "after",
    ]);
  });

  it("keeps a heading with an oversized block that follows it", async () => {
    const code = `\`\`\`sh\n${"echo hello\n".repeat(10)}\`\`\``;
    const body = ["", "## Setup", "", code, ""].join("\n");
    const chunks = await chunkTexts(input("Doc", body), 40);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text.trim()).toBe(`## Setup\n\n${code}`);
  });

  it("omits an H1 that repeats the title from the breadcrumb", async () => {
    const chunks = await chunkTexts(
      input("Guide", "\n# Other title\n\ntext\n"),
    );
    expect(chunks[0]?.breadcrumb).toBe("Guide › Other title");
  });

  it("truncates a long breadcrumb from the middle to about a quarter of the target", async () => {
    const heading = "Very long heading ".repeat(5).trim();
    const chunks = await chunkTexts(
      input("Doc", `\n## ${heading}\n\ntext\n`),
      80,
    );
    expect(chunks[0]?.breadcrumb).toBe("Doc › Very…g heading");
  });

  it("gives repeated headings distinct anchors", async () => {
    const chunks = await chunkTexts(
      input("Doc", "\n## Notes\n\none\n\n## Notes\n\ntwo\n"),
    );
    expect(chunks.map((chunk) => chunk.anchor)).toEqual(["notes", "notes-1"]);
  });

  it("carries consecutive headings forward onto the content that follows", async () => {
    const chunks = await chunkTexts(
      input("Doc", "\n# Doc\n\n## Setup\n\nInstall it.\n"),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.breadcrumb).toBe("Doc › Setup");
    expect(chunks[0]?.anchor).toBe("setup");
  });

  it("never cuts a surrogate pair when truncating a breadcrumb", async () => {
    const chunks = await chunkTexts(
      input("Doc", `\n## ${"😀".repeat(30)}\n\ntext\n`),
      40,
    );
    expect(chunks[0]?.breadcrumb).toBe(`Doc ›…${"😀".repeat(4)}`);
  });

  it("keeps anchors unique when a deduplicated slug matches a later heading", async () => {
    const chunks = await chunkTexts(
      input("Doc", "\n## Notes\n\na\n\n## Notes\n\nb\n\n## Notes 1\n\nc\n"),
    );
    expect(chunks.map((chunk) => chunk.anchor)).toEqual([
      "notes",
      "notes-1",
      "notes-1-1",
    ]);
  });

  it("ignores empty headings and inline HTML in heading text", async () => {
    const chunks = await chunkTexts(
      input("Doc", "\n## Intro\n\na\n\n##\n\nb\n\n## <b>Hi</b> there\n\nc\n"),
    );
    expect(
      chunks.map(({ breadcrumb, anchor }) => ({ breadcrumb, anchor })),
    ).toEqual([
      { breadcrumb: "Doc › Intro", anchor: "intro" },
      { breadcrumb: "Doc › Hi there", anchor: "hi-there" },
    ]);
    expect(chunks[0]?.text).toContain("##\n\nb");
  });

  it("folds a trailing heading into the chunk before it", async () => {
    const chunks = await chunkTexts(
      input("Doc", "\nintro\n\n## A\n\ntext\n\n## Appendix\n"),
    );
    expect(chunks.map((chunk) => chunk.anchor)).toEqual(["", "a"]);
    expect(chunks[1]?.text.trim()).toBe("## A\n\ntext\n\n## Appendix");
  });

  it("falls back to a placeholder anchor for a heading with no letters or digits", async () => {
    const chunks = await chunkTexts(
      input("Doc", "\n## 😀\n\na\n\n## 🎉\n\nb\n"),
    );
    expect(chunks.map((chunk) => chunk.anchor)).toEqual([
      "section",
      "section-1",
    ]);
  });

  it("splits a paragraph longer than the maximum at sentence boundaries", async () => {
    const doc = input(
      "Doc",
      "\nOne is here. Two is here. Three is here. Four is here.\n",
    );
    const spans = await createStructuralChunker({
      targetChars: 30,
      maxChars: 40,
    }).chunk(doc);
    expect(
      spans.map((span) => doc.body.slice(span.start, span.end).trim()),
    ).toEqual(["One is here. Two is here.", "Three is here. Four is here."]);
  });

  it("splits a list longer than the maximum at item boundaries", async () => {
    const doc = input(
      "Doc",
      "\n- alpha alpha\n- beta beta\n- gamma gamma\n- delta delta\n",
    );
    const spans = await createStructuralChunker({
      targetChars: 30,
      maxChars: 40,
    }).chunk(doc);
    expect(
      spans.map((span) => doc.body.slice(span.start, span.end).trim()),
    ).toEqual(["- alpha alpha\n- beta beta", "- gamma gamma\n- delta delta"]);
  });

  it("never splits a code block, whatever its length", async () => {
    const code = `\`\`\`sh\n${"echo hello\n".repeat(50)}\`\`\``;
    const chunks = await chunkTexts(input("Doc", `\n${code}\n`), 40);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text.trim()).toBe(code);
  });

  it("returns no chunks for an empty body", async () => {
    expect(await chunkTexts(input("Empty", "\n\n"))).toEqual([]);
  });
});

describe("structural chunks of examples/docs", () => {
  const sourceDir = join(import.meta.dirname, "..", "..", "examples", "docs");

  it("tile every body with no gaps or overlaps, and never split a code fence", async () => {
    const { documents } = await loadKnowledgeBase(loadConfig({ sourceDir }));
    const chunker = createStructuralChunker();

    for (const doc of documents) {
      const spans = await chunker.chunk(doc);
      expect(spans.length, doc.path).toBeGreaterThan(0);
      expect(spans[0]?.start, doc.path).toBe(0);
      expect(spans.at(-1)?.end, doc.path).toBe(doc.body.length);
      spans.forEach((span, i) => {
        const previous = spans[i - 1];
        if (previous) expect(span.start, doc.path).toBe(previous.end);
        const text = doc.body.slice(span.start, span.end);
        const fences = text.split("\n").filter((line) => /^\s*```/.test(line));
        expect(fences.length % 2, `${doc.path} @${span.start}`).toBe(0);
      });
    }
  });
});

describe("structural chunker headings and tables", () => {
  it("joins the lines of a multi-line setext heading with a space", async () => {
    const chunks = await chunkTexts(
      input("Doc", "\nFoo bar\nbaz\n===\n\ntext\n"),
    );
    expect(chunks[0]?.breadcrumb).toBe("Doc › Foo bar baz");
    expect(chunks[0]?.anchor).toBe("foo-bar-baz");
  });

  it("treats an HTML-only heading as a boundary that names nothing", async () => {
    const chunks = await chunkTexts(
      input("Doc", '\n## Intro\n\na\n\n## <a name="x"></a>\n\nb\n'),
    );
    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.anchor)).toEqual(["intro", ""]);
  });

  it("still covers a body whose only block is an empty heading", async () => {
    const chunks = await chunkTexts(input("Doc", "\n##\n"));
    expect(chunks).toEqual([
      { start: 0, end: 5, breadcrumb: "Doc", anchor: "", text: "\n\n##\n" },
    ]);
  });
});

describe("structural chunker tables, HTML headings and titles", () => {
  it("keeps a table whole even when it is over the maximum", async () => {
    const table = [
      "| Step | Action |",
      "| --- | --- |",
      "| 1 | Restart the service. Then wait. |",
      "| 2 | Check the logs. Then retry. |",
    ].join("\n");
    const doc = input("Doc", `\n${table}\n`);
    const spans = await createStructuralChunker({
      targetChars: 30,
      maxChars: 40,
    }).chunk(doc);
    expect(spans).toHaveLength(1);
    expect(doc.body.slice(spans[0]?.start, spans[0]?.end).trim()).toBe(table);
  });

  it("resets the heading path after an HTML-only heading", async () => {
    const chunks = await chunkTexts(
      input("Doc", '\n# A\n\n## B\n\nx\n\n# <a name="y"></a>\n\nz\n'),
    );
    expect(chunks.map((chunk) => chunk.breadcrumb)).toEqual([
      "Doc › A › B",
      "Doc",
    ]);
  });

  it("drops an H1 that matches the title up to whitespace", async () => {
    const doc = input("Payment  Runbook", "\n# Payment Runbook\n\ntext\n");
    const chunks = await chunkTexts(doc);
    expect(chunks[0]?.breadcrumb).toBe("Payment Runbook");
  });
});
