import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { count, search } from "@orama/orama";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Filter, matchesFilter, toWhere } from "../../src/index/filter.ts";
import type { KnowledgeIndex } from "../../src/index/knowledge-index.ts";
import { buildTestIndex } from "../support/build-test-index.ts";

describe("filter", () => {
  let root: string;
  let index: KnowledgeIndex;

  async function writeDoc(
    path: string,
    frontmatter: { tags: string[]; updated: string },
  ) {
    const file = join(root, "kb", path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
      file,
      [
        "---",
        `title: "${path}"`,
        `tags: [${frontmatter.tags.join(", ")}]`,
        `updated_at: "${frontmatter.updated}"`,
        "---",
        "",
        `Body of ${path}.`,
        "",
      ].join("\n"),
      "utf8",
    );
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "md-rag-filter-"));
    await writeDoc("a.md", {
      tags: ["x"],
      updated: "2026-01-01",
    });
    await writeDoc("ops/b.md", {
      tags: ["x", "y"],
      updated: "2026-02-01",
    });
    await writeDoc("ops/db/c.md", {
      tags: ["y"],
      updated: "2026-03-01",
    });
    await writeDoc("opsy/d.md", {
      tags: [],
      updated: "2026-04-01",
    });
    index = await buildTestIndex(join(root, "kb"), join(root, "engine"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function pathsInWhere(filter: Filter) {
    const { hits } = await search(index.orama, {
      term: "",
      limit: count(index.orama),
      where: toWhere(filter),
    });
    return [...new Set(hits.map((hit) => String(hit.document.path)))].sort();
  }

  function pathsInPredicate(filter: Filter) {
    return [...index.documents.values()]
      .filter(({ summary }) => matchesFilter(summary, filter))
      .map(({ summary }) => summary.path)
      .sort();
  }

  it.each<[string, Filter, string[]]>([
    ["no constraint", {}, ["a.md", "ops/b.md", "ops/db/c.md", "opsy/d.md"]],
    [
      "empty lists",
      { tags: [], tags_any: [] },
      ["a.md", "ops/b.md", "ops/db/c.md", "opsy/d.md"],
    ],
    ["all of the tags", { tags: ["x", "y"] }, ["ops/b.md"]],
    [
      "any of the tags",
      { tags_any: ["x", "y"] },
      ["a.md", "ops/b.md", "ops/db/c.md"],
    ],
    [
      "a directory and its subdirectories, not a name prefix",
      { dir: "ops" },
      ["ops/b.md", "ops/db/c.md"],
    ],
    ["a nested directory", { dir: "ops/db" }, ["ops/db/c.md"]],
    [
      "a directory with a trailing slash",
      { dir: "ops/" },
      ["ops/b.md", "ops/db/c.md"],
    ],
    [
      "a directory with a leading slash",
      { dir: "/ops" },
      ["ops/b.md", "ops/db/c.md"],
    ],
    ["a directory with a leading ./", { dir: "./ops/db/" }, ["ops/db/c.md"]],
    [
      "a directory with empty and . segments",
      { dir: "ops//./db" },
      ["ops/db/c.md"],
    ],
    ...["", "/", ".", "./"].map((dir): [string, Filter, string[]] => [
      `the root directory (${JSON.stringify(dir)}), which is everything`,
      { dir },
      ["a.md", "ops/b.md", "ops/db/c.md", "opsy/d.md"],
    ]),
    [
      "strictly after a date",
      { updated_after: Date.UTC(2026, 1, 1) },
      ["ops/db/c.md", "opsy/d.md"],
    ],
    [
      "every field together",
      {
        tags: ["x"],
        tags_any: ["y"],
        dir: "ops",
        updated_after: Date.UTC(2026, 0, 15),
      },
      ["ops/b.md"],
    ],
  ])("%s", async (_name, filter, expected) => {
    expect(await pathsInWhere(filter)).toEqual(expected);
    expect(pathsInPredicate(filter)).toEqual(expected);
  });
});
