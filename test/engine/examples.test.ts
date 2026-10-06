import { beforeAll, describe, expect, it } from "vitest";
import {
  DocumentNotFoundError,
  documentListSchema,
  documentSchema,
  InvalidRequestError,
  overviewSchema,
  searchResponseSchema,
} from "../../src/engine/index.ts";
import type { Engine } from "../../src/engine/start-engine.ts";
import {
  EXAMPLES,
  engineOver,
  scratchKnowledgeBases,
} from "../support/engine-fixtures.ts";

describe("engine over examples/docs", () => {
  const kbs = scratchKnowledgeBases("md-rag-engine-examples-");
  let engine: Engine;

  beforeAll(async () => {
    engine = await engineOver(kbs.root(), EXAMPLES);
  });

  it("finds the document holding an exact error code, with scores, a chunk ref and the index version", async () => {
    const response = searchResponseSchema.parse(
      await engine.search({
        query: "ERR_WEBHOOK_TIMEOUT_504",
        mode: "keyword",
      }),
    );

    const top = response.results[0];
    expect(["api/webhooks.md", "api/errors-reference.md"]).toContain(top?.path);
    expect(top?.ref.startsWith(`${top?.path}`)).toBe(true);
    expect(top?.scores.rerank).not.toBeNull();
    expect(response.index_version).toBe(
      (await engine.overview()).index_version,
    );
  });

  it("counts the whole knowledge base in its overview", async () => {
    const overview = overviewSchema.parse(await engine.overview());

    expect(overview.documents).toBe(30);
    expect(overview.embedding_model).toBe("bge-small-en-v1.5-q8");
    expect(overview.sources).toEqual([
      { name: "api", documents: 7 },
      { name: "decision", documents: 6 },
      { name: "runbook", documents: 9 },
      { name: "slack", documents: 7 },
      { name: "team", documents: 1 },
    ]);
    expect(overview.tags.find((tag) => tag.name === "api")).toEqual({
      name: "api",
      documents: 15,
    });
    expect(overview.signals).toEqual([]);
  });

  it("counts only what matches the filter", async () => {
    const overview = await engine.overview({ sources: ["runbook"] });

    expect(overview.documents).toBe(9);
    expect(overview.sources).toEqual([{ name: "runbook", documents: 9 }]);
    expect(overview.tags).toEqual([
      { name: "api", documents: 2 },
      { name: "database", documents: 2 },
      { name: "disaster-recovery", documents: 1 },
      { name: "incidents", documents: 2 },
      { name: "infra", documents: 2 },
      { name: "on-call", documents: 6 },
      { name: "payments", documents: 1 },
      { name: "process", documents: 3 },
      { name: "security", documents: 1 },
    ]);
  });

  it("narrows a search with the shared filter", async () => {
    const { results } = await engine.search({
      query: "rotate signing keys",
      limit: 10,
      filter: { sources: ["slack"] },
    });

    expect(results.length).toBeGreaterThan(0);
    expect(new Set(results.map((r) => r.source))).toEqual(new Set(["slack"]));
  });

  it("lists documents by path, with paging", async () => {
    const list = documentListSchema.parse(
      await engine.listDocuments({
        filter: { sources: ["runbook"] },
        offset: 2,
        limit: 2,
      }),
    );

    expect(list.total).toBe(9);
    expect(list.documents.map((d) => d.ref)).toEqual([
      "runbooks/incident-response-payment-gateway-timeouts.md",
      "runbooks/legacy-ack-window-policy.md",
    ]);
  });

  it("lists documents newest first, ties by path", async () => {
    const list = await engine.listDocuments({
      filter: { updated_after: Date.parse("2026-08-19T00:00:00Z") },
      sort: "updated_at",
    });

    expect(list.documents.map((d) => d.ref)).toEqual([
      "api/changelog.md",
      "api/errors-reference.md",
      "slack/thread-decide-on-graphql.md",
    ]);
  });

  it("lists newest first across a source", async () => {
    const list = await engine.listDocuments({
      filter: { sources: ["decision"] },
      sort: "updated_at",
    });

    expect(list.documents.map((d) => d.ref)).toEqual([
      "decisions/0002-revised-rate-limits.md",
      "decisions/deprecate-v1-rest-api.md",
      "decisions/use-graphql-for-public-api.md",
      "decisions/adopt-postgres-over-dynamodb.md",
      "decisions/choose-stripe-for-billing.md",
      "decisions/0001-initial-rate-limits.md",
    ]);
  });

  it("restricts a listing to a directory", async () => {
    const list = await engine.listDocuments({ filter: { dir: "runbooks" } });
    expect(list.total).toBe(9);
  });

  it("returns a document with its outline, body and pass-through metadata", async () => {
    const ref = "runbooks/rotating-api-signing-keys.md";
    const document = documentSchema.parse(await engine.getDocument(ref));

    expect(document.ref).toBe(ref);
    expect(document).toMatchObject({
      title: "Rotating API Signing Keys",
      source: "runbook",
      tags: ["security", "api", "on-call"],
      updated_at: Date.parse("2026-01-20T00:00:00Z"),
    });
    expect(document.outline.map((heading) => heading.text)).toEqual([
      "Rotating API Signing Keys",
      "Generate the new key pair",
      "Dual-sign during the overlap window",
      "Promote and retire",
      "If a key has leaked",
    ]);
    expect(document.body).toContain("## If a key has leaked");
  });

  it("returns only the summary and outline with body: false", async () => {
    const document = await engine.getDocument(
      "runbooks/rotating-api-signing-keys.md",
      { body: false },
    );

    expect("body" in document).toBe(false);
    expect(document.outline).toHaveLength(5);
  });

  it("returns one section of a document", async () => {
    const ref = "runbooks/rotating-api-signing-keys.md#promote-and-retire";
    const document = await engine.getDocument(ref);

    expect(document.ref).toBe(ref);
    expect(document.body?.startsWith("## Promote and retire")).toBe(true);
    expect(document.body).not.toContain("If a key has leaked");
  });

  it.each([
    ["an unknown path", "runbooks/nope.md"],
    ["a path outside the knowledge base", "../package.json"],
    ["an unknown section", "runbooks/rotating-api-signing-keys.md#nope"],
    ["an empty section", "runbooks/rotating-api-signing-keys.md#"],
  ])("refuses %s", async (_name, ref) => {
    await expect(engine.getDocument(ref)).rejects.toThrow(
      DocumentNotFoundError,
    );
  });

  it.each([
    ["an unknown mode", { query: "keys", mode: "fuzzy" }],
    ["a blank query", { query: "  " }],
    ["a limit above the maximum", { query: "keys", limit: 11 }],
    ["an expand above the maximum", { query: "keys", expand: 3 }],
    ["a misspelt field", { query: "keys", limt: 2 }],
    ["a parent-directory filter", { query: "keys", filter: { dir: "../x" } }],
    ["a backslash directory", { query: "keys", filter: { dir: "a\\b" } }],
    [
      "a non-finite date",
      { query: "keys", filter: { updated_after: Number.NaN } },
    ],
    ["an empty tag", { query: "keys", filter: { tags: [""] } }],
    ["a non-array tag list", { query: "keys", filter: { tags_any: "api" } }],
    // The schema accepts these; the retriever judges them against the signals the documents declare.
    [
      "a weight for an undeclared signal",
      { query: "keys", weights: { nonexistent: 0.1 } },
    ],
    ["weights above the cap", { query: "keys", weights: { recency: 0.6 } }],
    ["a weight above 1", { query: "keys", weights: { recency: 2 } }],
  ])("rejects a search with %s", async (_name, request) => {
    // Untrusted input arrives untyped.
    await expect(engine.search(request as never)).rejects.toThrow(
      InvalidRequestError,
    );
  });

  it("rejects a bad listing request and a bad overview filter", async () => {
    await expect(engine.listDocuments({ limit: 501 })).rejects.toThrow(
      InvalidRequestError,
    );
    await expect(
      engine.listDocuments({ sort: "title" } as never),
    ).rejects.toThrow(InvalidRequestError);
    await expect(engine.overview({ source: ["api"] } as never)).rejects.toThrow(
      InvalidRequestError,
    );
  });

  it.each([
    ["a missing ref", undefined],
    ["a number", 42],
    ["an empty ref", ""],
  ])("rejects %s as the ref of getDocument", async (_name, ref) => {
    await expect(engine.getDocument(ref as never)).rejects.toThrow(
      InvalidRequestError,
    );
  });

  it("hands out documents that a caller can't use to change what later calls see", async () => {
    const ref = "runbooks/rotating-api-signing-keys.md";
    const document = await engine.getDocument(ref);

    // The types forbid these edits; the cast is how an untyped caller would make them.
    const mutable = document as unknown as {
      tags: string[];
      outline: { text: string }[];
    };
    expect(() => mutable.tags.push("injected")).toThrow(TypeError);
    expect(() => mutable.outline.pop()).toThrow(TypeError);
    const [heading] = mutable.outline;
    expect(() => {
      if (heading) heading.text = "injected";
    }).toThrow(TypeError);
    const again = await engine.getDocument(ref);
    expect(again.tags).toEqual(["security", "api", "on-call"]);
    expect(again.outline[0]?.text).toBe("Rotating API Signing Keys");
  });

  it("reports its own version", () => {
    expect(engine.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
