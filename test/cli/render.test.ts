import { describe, expect, it } from "vitest";
import { renderGet } from "../../src/cli/render/render-get.ts";
import { renderList } from "../../src/cli/render/render-list.ts";
import { renderOverview } from "../../src/cli/render/render-overview.ts";
import { renderSearch } from "../../src/cli/render/render-search.ts";
import type {
  Document,
  DocumentList,
  Overview,
  SearchResponse,
} from "../../src/engine/index.ts";

const JAN_15 = Date.parse("2026-01-15T00:00:00Z");

const summary = {
  ref: "ops/db.md",
  path: "ops/db.md",
  title: "Database runbook",
  tags: ["ops", "db"],
  updated_at: JAN_15,
  meta: { owner: "data" },
};

describe("renderOverview", () => {
  it("prints the counts, then each counted list", () => {
    const overview: Overview = {
      index_version: "abc",
      embedding_model: "bge-small-en-v1.5-q8",
      documents: 2,
      chunks: 5,
      tags: [
        { name: "db", documents: 1 },
        { name: "ops", documents: 2 },
      ],
    };

    expect(renderOverview(overview)).toBe(`# Overview

- documents: 2
- chunks: 5
- embedding model: bge-small-en-v1.5-q8
- index_version: abc

## Tags

- db (1)
- ops (2)
`);
  });
});

describe("renderSearch", () => {
  const response: SearchResponse = {
    results: [
      {
        ...summary,
        ref: "ops/db.md#failover",
        breadcrumb: "Database runbook › Failover",
        text: "Promote the replica.",
        scores: {
          retrieval: 3,
          rerank: 1.2,
          relevance: 0.77,
          signals: { recency: 0.5 },
          final: 0.8125,
        },
      },
    ],
    timings: { embed_ms: 1, search_ms: 1, rerank_ms: 1, total_ms: 3 },
    index_version: "abc",
  };

  it("prints a heading, a facts line and the snippet for each result", () => {
    expect(renderSearch(response)).toBe(`## Database runbook › Failover

updated: 2026-01-15 · ref: ops/db.md#failover · score: 0.813

> Promote the replica.

index_version: abc
`);
  });

  it("quotes every snippet line, so a heading inside a chunk is not a result heading", () => {
    const [first] = response.results;
    const withHeadings = {
      ...response,
      results: first
        ? [{ ...first, text: "# Runbook\n\n## Symptoms\n\n- p99 above 8s" }]
        : [],
    };

    expect(renderSearch(withHeadings)).toContain(
      "\n> # Runbook\n>\n> ## Symptoms\n>\n> - p99 above 8s\n",
    );
  });

  it("trims the blank lines a chunk carries around its text", () => {
    const [first] = response.results;
    const padded = {
      ...response,
      results: first
        ? [{ ...first, text: "\n\nPromote the replica.\n\n" }]
        : [],
    };

    expect(renderSearch(padded)).toBe(renderSearch(response));
  });

  it("keeps the first line's indentation while dropping the blank lines around the text", () => {
    const [first] = response.results;
    const indented = {
      ...response,
      results: first
        ? [{ ...first, text: "\n\n    indented();\nnext();\n\n" }]
        : [],
    };

    expect(renderSearch(indented)).toContain(
      "\n>     indented();\n> next();\n",
    );
  });

  it("says so explicitly when nothing is relevant", () => {
    expect(renderSearch({ ...response, results: [] })).toBe(
      "No relevant context found.\n\nindex_version: abc\n",
    );
  });
});

describe("renderList", () => {
  const list: DocumentList = {
    total: 12,
    offset: 10,
    limit: 50,
    documents: [
      summary,
      { ...summary, ref: "ops/net.md", title: "Network", tags: [] },
    ],
    index_version: "abc",
  };

  it("prints one line per document and the range shown", () => {
    expect(
      renderList(list),
    ).toBe(`- ops/db.md · Database runbook · 2026-01-15 · ops, db
- ops/net.md · Network · 2026-01-15

Showing 11–12 of 12 document(s).

index_version: abc
`);
  });

  it("reports an empty page", () => {
    expect(renderList({ ...list, total: 3, offset: 50, documents: [] })).toBe(
      "Showing none of 3 document(s).\n\nindex_version: abc\n",
    );
  });
});

describe("renderGet", () => {
  const document: Document = {
    ...summary,
    outline: [
      { depth: 2, text: "Failover", anchor: "failover" },
      { depth: 3, text: "Steps", anchor: "steps" },
      { depth: 2, text: "Contacts", anchor: "contacts" },
    ],
    body: "Promote the replica.",
  };

  it("prints the header block, the outline and the body", () => {
    expect(renderGet(document)).toBe(`# Database runbook

- ref: ops/db.md
- updated: 2026-01-15
- tags: ops, db
- meta.owner: "data"

## Outline

- Failover (#failover)
  - Steps (#steps)
- Contacts (#contacts)

---

Promote the replica.
`);
  });

  it("leaves out the tags line when there are none", () => {
    const text = renderGet({ ...document, tags: [] });

    expect(text).not.toContain("- tags:");
  });

  it("renders an outline too large to spread into function arguments", () => {
    const outline = Array.from({ length: 300_000 }, (_, i) => ({
      depth: 2,
      text: `H${i}`,
      anchor: `h${i}`,
    }));

    expect(renderGet({ ...document, outline })).toContain(
      "- H299999 (#h299999)",
    );
  });

  it("marks an empty body, so it is not mistaken for a truncated one", () => {
    expect(renderGet({ ...document, body: "" })).toMatch(/---\n\n\(empty\)\n$/);
  });

  it("omits the body when there is none", () => {
    const { body: _body, ...withoutBody } = document;

    expect(renderGet(withoutBody)).not.toContain("---");
  });
});
