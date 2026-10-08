import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { runGet } from "../../src/cli/get.ts";
import { runList } from "../../src/cli/list.ts";
import { runOverview } from "../../src/cli/overview.ts";
import { defaultQueryDeps, type QueryDeps } from "../../src/cli/run-query.ts";
import { runSearch } from "../../src/cli/search.ts";
import { startEngine } from "../../src/engine/start-engine.ts";
import { embedTestSidecars, MODEL } from "../support/build-test-index.ts";
import { createCountingEmbedder } from "../support/embed-fakes.ts";
import {
  NOW,
  overlapReranker,
  scratchKnowledgeBases,
  writeMarkdown,
} from "../support/engine-fixtures.ts";

const scratch = scratchKnowledgeBases("md-rag-query-cli-");

interface Started {
  input: unknown;
  options: unknown;
}

function fakeDeps(started: Started[] = []): QueryDeps {
  return {
    createEngine(input, options) {
      started.push({ input, options });
      return startEngine(input, {
        ...options,
        embedder: createCountingEmbedder(MODEL),
        reranker: overlapReranker,
        now: () => NOW,
      });
    },
  };
}

describe("query commands", () => {
  let flags: string[];

  beforeAll(async () => {
    const sourceDir = await scratch.fresh("kb");
    await writeMarkdown(
      sourceDir,
      "ops/db.md",
      [
        "title: Database runbook",
        'updated_at: "2026-01-15"',
        "tags: [ops, db]",
      ],
      [
        "## Failover",
        "",
        "Promote the replica when the primary fails.",
        "",
        "## Contacts",
        "",
        "Page the data team.",
      ].join("\n"),
    );
    await writeMarkdown(
      sourceDir,
      "chat/thread.md",
      ["title: Deploy thread", 'updated_at: "2026-03-01"', "tags: [chat]"],
      "Someone asked about the deploy freeze.",
    );
    const targetDir = join(scratch.workDir("kb"), "engine");
    await embedTestSidecars(sourceDir, targetDir);
    flags = ["--source-dir", sourceDir, "--target-dir", targetDir];
  });

  describe("overview", () => {
    it("prints the counts and the counted lists", async () => {
      const result = await runOverview(flags, fakeDeps());

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("- documents: 2\n");
      expect(result.stdout).toContain("- db (1)\n");
    });

    it("counts within the filter", async () => {
      const result = await runOverview([...flags, "--tag", "chat"], fakeDeps());

      expect(result.stdout).toContain("- documents: 1\n");
    });

    it("prints the schema's JSON with --json", async () => {
      const result = await runOverview([...flags, "--json"], fakeDeps());

      expect(JSON.parse(result.stdout)).toMatchObject({
        documents: 2,
        tags: [
          { name: "chat", documents: 1 },
          { name: "db", documents: 1 },
          { name: "ops", documents: 1 },
        ],
      });
    });

    it("loads no model", async () => {
      const started: Started[] = [];
      await runOverview(flags, fakeDeps(started));

      expect(started.map((s) => s.options)).toEqual([{ loadModels: false }]);
    });
  });

  describe("list", () => {
    it("lists documents by path, with the range shown", async () => {
      const result = await runList(flags, fakeDeps());

      expect(result.stdout).toMatch(
        /^- chat\/thread\.md · Deploy thread · 2026-03-01 · chat\n- ops\/db\.md · Database runbook · 2026-01-15 · ops, db\n\nShowing 1–2 of 2 document\(s\)\./,
      );
    });

    it("sorts by updated_at, newest first, and pages", async () => {
      const first = await runList(
        [...flags, "--sort", "updated_at", "--limit", "1"],
        fakeDeps(),
      );
      const second = await runList(
        [...flags, "--sort", "updated_at", "--limit", "1", "--offset", "1"],
        fakeDeps(),
      );

      expect(first.stdout).toContain("- chat/thread.md");
      expect(first.stdout).toContain("Showing 1–1 of 2 document(s).");
      expect(second.stdout).toContain("- ops/db.md");
      expect(second.stdout).toContain("Showing 2–2 of 2 document(s).");
    });

    it("applies the filter flags", async () => {
      const result = await runList(
        [...flags, "--tag", "db", "--dir", "ops", "--since", "2026-01-01"],
        fakeDeps(),
      );

      expect(result.stdout).toContain("- ops/db.md");
      expect(result.stdout).not.toContain("chat/thread.md");
    });

    it("rejects an unknown sort before starting the engine", async () => {
      const started: Started[] = [];
      const result = await runList(
        [...flags, "--sort", "size"],
        fakeDeps(started),
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--sort must be one of path, updated_at");
      expect(started).toEqual([]);
    });
  });

  describe("get", () => {
    it("prints the summary, the outline and the body", async () => {
      const result = await runGet(["ops/db.md", ...flags], fakeDeps());

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("# Database runbook\n");
      expect(result.stdout).toContain("- Failover (#failover)");
      expect(result.stdout).toContain("Page the data team.");
    });

    it("prints only the named section", async () => {
      const result = await runGet(["ops/db.md#failover", ...flags], fakeDeps());

      expect(result.stdout).toContain("Promote the replica");
      expect(result.stdout).not.toContain("Page the data team.");
    });

    it("leaves the body out with --no-body", async () => {
      const result = await runGet(
        ["ops/db.md", "--no-body", ...flags],
        fakeDeps(),
      );

      expect(result.stdout).toContain("- Contacts (#contacts)");
      expect(result.stdout).not.toContain("Promote the replica");
    });

    it("reports a missing document", async () => {
      const result = await runGet(["nope.md", ...flags], fakeDeps());

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('get: no document at "nope.md"\n');
    });

    it("needs exactly one ref", async () => {
      const none = await runGet(flags, fakeDeps());
      const two = await runGet(["a.md", "b.md", ...flags], fakeDeps());

      expect(none.exitCode).toBe(1);
      expect(none.stderr).toContain("expected exactly one ref, got 0");
      expect(two.stderr).toContain("expected exactly one ref, got 2");
    });
  });

  describe("search", () => {
    it("prints cited results", async () => {
      const result = await runSearch(
        ["replica primary", "--mode", "keyword", ...flags],
        fakeDeps(),
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("ref: ops/db.md#failover");
      expect(result.stdout).toContain(
        "Promote the replica when the primary fails.",
      );
      expect(result.stdout).toMatch(/index_version: [0-9a-f]+\n$/);
    });

    it("says so when the filter leaves nothing relevant", async () => {
      const result = await runSearch(
        ["replica", "--mode", "keyword", "--tag", "chat", ...flags],
        fakeDeps(),
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/^No relevant context found\./);
    });

    it("prints the response's JSON with --json", async () => {
      const result = await runSearch(
        ["replica", "--mode", "keyword", "--json", ...flags],
        fakeDeps(),
      );

      expect(JSON.parse(result.stdout).results[0]).toMatchObject({
        ref: "ops/db.md#failover",
      });
    });

    it("passes the model flags to the engine", async () => {
      const started: Started[] = [];
      await runSearch(
        ["replica", "--models-dir", "cache", "--offline", ...flags],
        fakeDeps(started),
      );

      expect(started).toMatchObject([
        {
          input: { modelsDir: "cache", allowRemoteModels: false },
          options: { loadModels: true },
        },
      ]);
    });

    it.each([
      ["--limit", "99", "limit"],
      ["--expand", "9", "expand"],
      ["--tag", "", "tags"],
      ["--dir", "ops\\db", "dir"],
    ])(
      "rejects %s %j before starting the engine",
      async (flag, value, field) => {
        const started: Started[] = [];
        const result = await runSearch(
          ["replica", flag, value, ...flags],
          fakeDeps(started),
        );

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(field);
        expect(result.stderr).toContain("Usage: md-rag search");
        expect(started).toEqual([]);
      },
    );

    it("rejects a blank query before starting the engine", async () => {
      const started: Started[] = [];
      const result = await runSearch(["  ", ...flags], fakeDeps(started));

      expect(result.stderr).toContain("must not be blank");
      expect(started).toEqual([]);
    });

    it("turns a weight for an unknown signal into an error naming it", async () => {
      const result = await runSearch(
        ["replica", "--weight", "nosuch=0.1", ...flags],
        fakeDeps(),
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("nosuch");
    });

    it("rejects an unknown mode, a bad weight and a missing query before starting the engine", async () => {
      const started: Started[] = [];
      const deps = fakeDeps(started);

      const mode = await runSearch(["q", "--mode", "fuzzy", ...flags], deps);
      const weight = await runSearch(
        ["q", "--weight", "recency", ...flags],
        deps,
      );
      const query = await runSearch(flags, deps);

      for (const result of [mode, weight, query]) {
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("Usage: md-rag search");
      }
      expect(mode.stderr).toContain(
        "--mode must be one of hybrid, keyword, semantic",
      );
      expect(weight.stderr).toContain("--weight must look like name=value");
      expect(query.stderr).toContain("expected exactly one query");
      expect(started).toEqual([]);
    });
  });

  describe.each([
    ["overview", runOverview, []],
    ["search", runSearch, ["a query"]],
    ["list", runList, []],
    ["get", runGet, ["a.md"]],
  ])("%s", (name, runCommand, positionals) => {
    it("prints its help for --help without a knowledge base", async () => {
      const result = await runCommand(["--help"], fakeDeps());

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`Usage: md-rag ${name}`);
    });

    it("requires --source-dir", async () => {
      const result = await runCommand(positionals, fakeDeps());

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`${name}: --source-dir is required`);
    });

    it("rejects an unknown flag with the usage text", async () => {
      const result = await runCommand(["--bogus", ...flags], fakeDeps());

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`Usage: md-rag ${name}`);
    });
  });

  it("rejects a single-value flag given twice before starting the engine", async () => {
    const started: Started[] = [];
    const deps = fakeDeps(started);

    const list = await runList(
      [...flags, "--limit", "1", "--limit", "2"],
      deps,
    );
    const search = await runSearch(
      ["q", ...flags, "--dir", "a", "--dir", "b"],
      deps,
    );

    expect(list.stderr).toContain("--limit was given more than once");
    expect(search.stderr).toContain("--dir was given more than once");
    expect(started).toEqual([]);
  });

  it("accepts repeated list flags", async () => {
    const result = await runList(
      [...flags, "--tag-any", "chat", "--tag-any", "ops"],
      fakeDeps(),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Showing 1–2 of 2 document(s).");
  });

  it("reads a query that starts with a dash after --", async () => {
    const result = await runSearch([...flags, "--", "-v"], fakeDeps());

    expect(result.exitCode).toBe(0);
  });

  describe("failures with --json", () => {
    function errorOf(result: {
      stdout: string;
      stderr: string;
      exitCode: number;
    }) {
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toContain("Usage:");
      return JSON.parse(result.stderr);
    }

    it("reports a bad flag as a usage error", async () => {
      const result = await runList(
        [...flags, "--sort", "size", "--json"],
        fakeDeps(),
      );

      expect(errorOf(result)).toEqual({
        error: {
          kind: "usage",
          message: 'list: --sort must be one of path, updated_at, got "size"',
        },
      });
    });

    it("reports a flag the parser rejects, and a missing --source-dir", async () => {
      const unknown = await runList(["--bogus", "--json"], fakeDeps());
      const missing = await runList(["--json"], fakeDeps());

      expect(errorOf(unknown).error.kind).toBe("usage");
      expect(errorOf(missing).error).toEqual({
        kind: "usage",
        message: "list: --source-dir is required",
      });
    });

    it("reports a setting the engine rejects as usage, not startup", async () => {
      const sourceDir = flags[1] ?? "";
      const result = await runList(
        ["--source-dir", sourceDir, "--target-dir", sourceDir, "--json"],
        defaultQueryDeps,
      );

      const { error } = errorOf(result);
      expect(error.kind).toBe("usage");
      expect(error.message).toContain("targetDir");
    });

    it("prints the usage text for that setting in text mode", async () => {
      const sourceDir = flags[1] ?? "";
      const result = await runList(
        ["--source-dir", sourceDir, "--target-dir", sourceDir],
        defaultQueryDeps,
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Usage: md-rag list");
    });

    it("reports a missing document as not_found", async () => {
      const result = await runGet(["nope.md", "--json", ...flags], fakeDeps());

      expect(errorOf(result)).toEqual({
        error: { kind: "not_found", message: 'get: no document at "nope.md"' },
      });
    });

    it("reports a value out of range as a usage error", async () => {
      const result = await runSearch(
        ["q", "--limit", "99", "--json", ...flags],
        fakeDeps(),
      );

      const { error } = errorOf(result);
      expect(error.kind).toBe("usage");
      expect(error.message).toContain("limit");
    });

    it("reports a request the engine rejects as invalid_request", async () => {
      const result = await runSearch(
        ["q", "--weight", "nosuch=0.1", "--json", ...flags],
        fakeDeps(),
      );

      const { error } = errorOf(result);
      expect(error.kind).toBe("invalid_request");
      expect(error.message).toContain("search: Invalid search request");
    });

    it("reports an engine that cannot start as startup", async () => {
      const deps: QueryDeps = {
        async createEngine() {
          throw new Error("the sidecars are stale");
        },
      };

      expect(errorOf(await runOverview([...flags, "--json"], deps))).toEqual({
        error: { kind: "startup", message: "overview: the sidecars are stale" },
      });
    });

    it("reports any other failure of the operation as internal", async () => {
      const deps: QueryDeps = {
        async createEngine(input, options) {
          const engine = await fakeDeps().createEngine(input, options);
          return {
            ...engine,
            async search() {
              throw new Error("the reranker died");
            },
          };
        },
      };

      expect(errorOf(await runSearch(["q", "--json", ...flags], deps))).toEqual(
        {
          error: { kind: "internal", message: "search: the reranker died" },
        },
      );
    });

    it("keeps plain text on stderr without --json", async () => {
      const result = await runGet(["nope.md", ...flags], fakeDeps());

      expect(result.stderr).toBe('get: no document at "nope.md"\n');
    });
  });

  it.each([
    ["overview", runOverview, ["--help", "--since", "junk"]],
    ["list", runList, ["--help", "--sort", "size"]],
    ["search", runSearch, ["--help", "--limit", "abc"]],
  ])(
    "%s prints its help even beside an invalid flag value",
    async (name, runCommand, args) => {
      const result = await runCommand(args, fakeDeps());

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`Usage: md-rag ${name}`);
    },
  );

  it("includes a document dated exactly at --since", async () => {
    const onDate = await runList(
      [...flags, "--since", "2026-01-15"],
      fakeDeps(),
    );
    const dayAfter = await runList(
      [...flags, "--since", "2026-01-16"],
      fakeDeps(),
    );

    expect(onDate.stdout).toContain("- ops/db.md");
    expect(dayAfter.stdout).not.toContain("- ops/db.md");
  });

  it("prints help even when a flag is repeated", async () => {
    const result = await runList(
      ["--limit", "1", "--limit", "2", "--help"],
      fakeDeps(),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: md-rag list");
  });

  it("rejects negated flags other than --no-body", async () => {
    const noJson = await runGet(
      ["ops/db.md", "--no-json", ...flags],
      fakeDeps(),
    );
    const noHelp = await runGet(
      ["ops/db.md", "--no-help", ...flags],
      fakeDeps(),
    );
    const body = await runGet(["ops/db.md", "--body", ...flags], fakeDeps());

    for (const result of [noJson, noHelp, body]) {
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Usage: md-rag get");
    }
  });

  it("rejects a weight named __proto__ with a usage error", async () => {
    const result = await runSearch(
      ["q", "--weight", "__proto__=0.5", ...flags],
      fakeDeps(),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--weight cannot name "__proto__"');
    expect(result.stderr).toContain("Usage: md-rag search");
  });

  it("reads a negative number written with an equals sign", async () => {
    const result = await runSearch(
      ["replica", "--mode", "keyword", "--min-score=-0.5", ...flags],
      fakeDeps(),
    );

    expect(result.exitCode).toBe(0);
  });

  it("explains a negative number written as a separate argument", async () => {
    const result = await runSearch(
      ["replica", "--min-score", "-0.5", ...flags],
      fakeDeps(),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--min-score=-XYZ");
  });

  it("rejects a malformed --since before starting the engine", async () => {
    const started: Started[] = [];
    const result = await runOverview(
      [...flags, "--since", "soon"],
      fakeDeps(started),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--since");
    expect(started).toEqual([]);
  });
});
