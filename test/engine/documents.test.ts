import { describe, expect, it } from "vitest";
import {
  engineOver,
  frontmatter,
  scratchKnowledgeBases,
  writeMarkdown,
} from "../support/engine-fixtures.ts";

describe("engine over bespoke knowledge bases", () => {
  const kbs = scratchKnowledgeBases("md-rag-engine-documents-");
  const freshKnowledgeBase = kbs.fresh;
  it("counts documents, chunks and tags within a filter", async () => {
    const dir = await freshKnowledgeBase("counts");
    await writeMarkdown(dir, "a.md", frontmatter(), "Alpha text.");
    await writeMarkdown(
      dir,
      "b.md",
      frontmatter(["tags: [x, x]"]),
      "Beta text.",
    );
    await writeMarkdown(
      dir,
      "sub/c.md",
      frontmatter(["tags: [x]"]),
      "Gamma text.",
    );
    const engine = await engineOver(kbs.workDir("counts"), dir);

    expect(await engine.overview()).toMatchObject({
      documents: 3,
      chunks: 3,
      tags: [{ name: "x", documents: 2 }],
    });
    expect(await engine.overview({ dir: "sub" })).toMatchObject({
      documents: 1,
      chunks: 1,
      tags: [{ name: "x", documents: 1 }],
    });
    expect(await engine.overview({ tags: ["missing"] })).toMatchObject({
      documents: 0,
      chunks: 0,
      tags: [],
    });
  });

  it("passes unknown frontmatter through as meta", async () => {
    const dir = await freshKnowledgeBase("meta");
    await writeMarkdown(dir, "a.md", frontmatter(["owner: gateway"]), "Alpha.");
    const engine = await engineOver(kbs.workDir("meta"), dir);

    const [summary] = (await engine.listDocuments()).documents;
    expect(summary).toMatchObject({
      meta: { owner: "gateway" },
    });
  });

  it("reads a whole document, a section and a nested section", async () => {
    const dir = await freshKnowledgeBase("sections");
    const body = [
      "# Guide",
      "",
      "Intro text.",
      "",
      "## Setup",
      "",
      "Install it.",
      "",
      "### Details",
      "",
      "More detail.",
      "",
      "## Wrap up",
      "",
      "Done.",
    ].join("\n");
    await writeMarkdown(dir, "guide.md", frontmatter(), body);
    const engine = await engineOver(kbs.workDir("sections"), dir);

    expect((await engine.getDocument("guide.md")).body).toBe(body);
    expect((await engine.getDocument("guide.md#setup")).body).toBe(
      "## Setup\n\nInstall it.\n\n### Details\n\nMore detail.",
    );
    expect((await engine.getDocument("guide.md#details")).body).toBe(
      "### Details\n\nMore detail.",
    );
    expect((await engine.getDocument("guide.md#wrap-up")).body).toBe(
      "## Wrap up\n\nDone.",
    );
  });

  it("applies the configured retrieval defaults, which a request overrides", async () => {
    const dir = await freshKnowledgeBase("defaults");
    for (const name of ["a", "b", "c"]) {
      await writeMarkdown(dir, `${name}.md`, frontmatter(), `Keys ${name}.`);
    }
    const engine = await engineOver(kbs.workDir("defaults"), dir, { limit: 1 });

    expect((await engine.search({ query: "keys" })).results).toHaveLength(1);
    expect(
      (await engine.search({ query: "keys", limit: 3 })).results,
    ).toHaveLength(3);
  });

  it("describes an empty knowledge base", async () => {
    const dir = await freshKnowledgeBase("empty");
    const engine = await engineOver(kbs.workDir("empty"), dir);

    expect(await engine.overview()).toMatchObject({
      documents: 0,
      chunks: 0,
      embedding_model: null,
    });
    expect((await engine.listDocuments()).total).toBe(0);
  });
});
