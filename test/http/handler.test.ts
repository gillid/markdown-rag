import { Agent, get, request as httpRequest } from "node:http";
import { connect } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../../src/engine/index.ts";
import { startEngine } from "../../src/engine/start-engine.ts";
import { createHttpHandler } from "../../src/http/handler.ts";
import { listen, type RunningServer } from "../../src/http/server.ts";
import { embedTestSidecars, MODEL } from "../support/build-test-index.ts";
import { createCountingEmbedder } from "../support/embed-fakes.ts";
import {
  NOW,
  overlapReranker,
  scratchKnowledgeBases,
  writeMarkdown,
} from "../support/engine-fixtures.ts";

const scratch = scratchKnowledgeBases("markdown-rag-http-");

interface Served {
  url: string;
  port: number;
  logs: string[];
  close(): Promise<void>;
}

interface ServeOptions {
  allowedHosts?: readonly string[];
  shutdownGraceMs?: number;
}

async function serve(
  engine: Promise<Engine>,
  { allowedHosts, shutdownGraceMs }: ServeOptions = {},
): Promise<Served> {
  const logs: string[] = [];
  const server: RunningServer = await listen(
    createHttpHandler(engine, {
      log: (message) => logs.push(message),
      allowedHosts,
    }),
    { port: 0, host: "127.0.0.1", shutdownGraceMs },
    (message) => logs.push(message),
  );
  return {
    url: `http://127.0.0.1:${server.port}`,
    port: server.port,
    logs,
    close: () => server.close(),
  };
}

const JSON_TYPE = { "content-type": "application/json" };

// biome-ignore lint/suspicious/noExplicitAny: the tests probe arbitrary response shapes
type Body = any;

async function getJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body: Body = await response.json();
  return { status: response.status, headers: response.headers, body };
}

function postSearch(url: string, body: string) {
  return getJson(`${url}/search`, {
    method: "POST",
    headers: JSON_TYPE,
    body,
  });
}

describe("HTTP handler", () => {
  let engine: Engine;
  let served: Served;

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
    engine = await startEngine(
      { sourceDir, targetDir },
      {
        embedder: createCountingEmbedder(MODEL),
        reranker: overlapReranker,
        now: () => NOW,
      },
    );
    served = await serve(Promise.resolve(engine));
  });

  afterAll(() => served.close());

  describe("operations", () => {
    it("answers /overview with the counts within the filter", async () => {
      const all = await getJson(`${served.url}/overview`);
      const runbooks = await getJson(`${served.url}/overview?tag=ops`);

      expect(all.status).toBe(200);
      expect(all.body.documents).toBe(2);
      expect(runbooks.body.documents).toBe(1);
    });

    it("answers POST /search with cited results", async () => {
      const { status, body } = await postSearch(
        served.url,
        JSON.stringify({ query: "replica primary", mode: "keyword" }),
      );

      expect(status).toBe(200);
      expect(body.results[0].ref).toBe("ops/db.md#failover");
      expect(body.results[0].text).toContain("Promote the replica");
    });

    it("answers /documents with the page the engine applied", async () => {
      const { status, body } = await getJson(
        `${served.url}/documents?sort=updated_at&limit=1&offset=1`,
      );

      expect(status).toBe(200);
      expect(body.total).toBe(2);
      expect(body.offset).toBe(1);
      expect(body.limit).toBe(1);
      expect(body.documents.map((d: { ref: string }) => d.ref)).toEqual([
        "ops/db.md",
      ]);
    });

    it("answers /documents/{ref} with a whole document and with a section", async () => {
      const whole = await getJson(`${served.url}/documents/ops/db.md`);
      const section = await getJson(
        `${served.url}/documents/ops/db.md%23contacts`,
      );
      const outline = await getJson(
        `${served.url}/documents/ops/db.md?body=false`,
      );

      expect(whole.body.body).toContain("Promote the replica");
      expect(whole.body.body).toContain("Page the data team.");
      expect(section.body.body).toContain("Page the data team.");
      expect(section.body.body).not.toContain("Promote the replica");
      expect(outline.body.body).toBeUndefined();
      expect(
        outline.body.outline.map((e: { anchor: string }) => e.anchor),
      ).toEqual(["failover", "contacts"]);
    });
  });

  describe("filters", () => {
    it("reads repeated parameters as the same filter as the JSON body", async () => {
      const viaParams = await getJson(
        `${served.url}/documents?tag=ops&tag=db&updated_after=1`,
      );
      const direct = await engine.listDocuments({
        filter: {
          tags: ["ops", "db"],
          updated_after: 1,
        },
      });
      const viaBody = await postSearch(
        served.url,
        JSON.stringify({
          query: "deploy freeze",
          mode: "keyword",
          filter: { tags: ["chat"] },
        }),
      );
      const viaParamsOverview = await getJson(
        `${served.url}/overview?tag=chat`,
      );

      expect(viaParams.body).toEqual(JSON.parse(JSON.stringify(direct)));
      expect(viaBody.body.results.map((r: { path: string }) => r.path)).toEqual(
        ["chat/thread.md"],
      );
      expect(viaParamsOverview.body.documents).toBe(1);
    });

    it("rejects an unknown or malformed parameter instead of ignoring it", async () => {
      const unknown = await getJson(`${served.url}/documents?tags=ops`);
      const notNumber = await getJson(
        `${served.url}/overview?updated_after=soon`,
      );
      const twice = await getJson(`${served.url}/documents?dir=a&dir=b`);
      const badBody = await getJson(
        `${served.url}/documents/ops/db.md?body=no`,
      );

      for (const response of [unknown, notNumber, twice, badBody]) {
        expect(response.status).toBe(400);
        expect(response.body.error.kind).toBe("invalid_request");
      }
      expect(unknown.body.error.message).toContain(
        'Unknown query parameter "tags"',
      );
    });
  });

  describe("errors", () => {
    it("answers 400 invalid_request for a body that breaks the schema", async () => {
      const missingQuery = await postSearch(served.url, "{}");
      const notJson = await postSearch(served.url, "{");
      const badLimit = await postSearch(
        served.url,
        JSON.stringify({ query: "x", limit: 1000 }),
      );

      for (const response of [missingQuery, notJson, badLimit]) {
        expect(response.status).toBe(400);
        expect(response.body.error.kind).toBe("invalid_request");
      }
      expect(notJson.body.error.message).toContain("not valid JSON");
    });

    it("rejects a __proto__ weight instead of ignoring it", async () => {
      const { status, body } = await postSearch(
        served.url,
        '{"query":"replica","weights":{"__proto__":1}}',
      );

      expect(status).toBe(400);
      expect(body.error.kind).toBe("invalid_request");
      expect(body.error.message).toContain("__proto__");
    });

    it("answers 404 not_found for a missing document, section and route", async () => {
      const document = await getJson(`${served.url}/documents/nope.md`);
      const section = await getJson(`${served.url}/documents/ops/db.md%23nope`);
      const route = await getJson(`${served.url}/nope`);

      for (const response of [document, section, route]) {
        expect(response.status).toBe(404);
        expect(response.body.error.kind).toBe("not_found");
      }
    });

    it("takes the ref as sent, so dot segments and backslashes never name another document", async () => {
      const status = (path: string) =>
        new Promise<number>((resolve, reject) => {
          get({ host: "127.0.0.1", port: served.port, path }, (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          }).on("error", reject);
        });

      expect(await status("/documents/ops/db.md")).toBe(200);
      expect(await status("/documents/ops/%2e%2e/ops/db.md")).toBe(404);
      expect(await status("/documents/ops/../ops/db.md")).toBe(404);
      expect(await status("/documents/ops%5Cdb.md")).toBe(404);
    });

    it("answers a HEAD probe on the liveness and readiness routes", async () => {
      const health = await fetch(`${served.url}/healthz`, { method: "HEAD" });
      const ready = await fetch(`${served.url}/readyz`, { method: "HEAD" });
      const other = await fetch(`${served.url}/overview`, { method: "HEAD" });

      expect([health.status, ready.status]).toEqual([200, 200]);
      expect(other.status).toBe(405);
    });

    it("answers 405 usage with the allowed method for a wrong method", async () => {
      const { status, headers, body } = await getJson(`${served.url}/search`);

      expect(status).toBe(405);
      expect(headers.get("allow")).toBe("POST");
      expect(body.error.kind).toBe("usage");
    });

    it("answers 400 for a ref that is not valid percent-encoding", async () => {
      const { status, body } = await getJson(
        `${served.url}/documents/%E0%A4%A`,
      );

      expect(status).toBe(400);
      expect(body.error.kind).toBe("invalid_request");
    });

    it("answers 400 to a body over 1 MiB, declared or streamed, before the connection closes", async () => {
      const declared = await postSearch(
        served.url,
        "x".repeat(2 * 1024 * 1024),
      );
      const chunk = new TextEncoder().encode("x".repeat(512 * 1024));
      const streamed = await getJson(`${served.url}/search`, {
        method: "POST",
        headers: JSON_TYPE,
        duplex: "half",
        body: new ReadableStream({
          async pull(controller) {
            controller.enqueue(chunk);
            await new Promise((resolve) => setTimeout(resolve, 5));
          },
        }),
      });

      for (const response of [declared, streamed]) {
        expect(response.status).toBe(400);
        expect(response.body.error.kind).toBe("invalid_request");
        expect(response.body.error.message).toContain("larger than");
      }
    });

    it("delivers the answer to a POST it never reads, whatever the size of the body", async () => {
      const { status, body } = await getJson(`${served.url}/nope`, {
        method: "POST",
        body: "x".repeat(4 * 1024 * 1024),
      });

      expect(status).toBe(404);
      expect(body.error.kind).toBe("not_found");
    });

    it("drops a client that disconnects mid-body without logging or answering", async () => {
      const server = await serve(Promise.resolve(engine));
      try {
        await new Promise<void>((resolve) => {
          const upload = httpRequest(`${server.url}/search`, {
            method: "POST",
            headers: { ...JSON_TYPE, "content-length": "100" },
          });
          upload.on("error", () => {});
          upload.write('{"query":', () => {
            upload.destroy();
            resolve();
          });
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(server.logs).toEqual(["markdown-rag: ready"]);
      } finally {
        await server.close();
      }
    });

    it("closes a keep-alive connection that finishes its request during shutdown", async () => {
      const slow: Engine = {
        ...engine,
        overview: async (filter) => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return engine.overview(filter);
        },
      };
      const server = await serve(Promise.resolve(slow));
      const agent = new Agent({ keepAlive: true });
      try {
        await getJson(`${server.url}/healthz`);
        const answered = new Promise<number>((resolve) => {
          get(`${server.url}/overview`, { agent }, (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode ?? 0));
          });
        });
        await new Promise((resolve) => setTimeout(resolve, 30));
        const started = Date.now();

        await server.close();

        expect(await answered).toBe(200);
        expect(Date.now() - started).toBeLessThan(2000);
      } finally {
        agent.destroy();
      }
    });

    it("refuses a search whose body is not declared as JSON", async () => {
      const textPlain = await getJson(`${served.url}/search`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: '{"query":"replica"}',
      });
      const none = await getJson(`${served.url}/search`, {
        method: "POST",
        body: new Uint8Array(Buffer.from('{"query":"replica"}')),
      });
      const withCharset = await getJson(`${served.url}/search`, {
        method: "POST",
        headers: { "content-type": "Application/JSON; charset=utf-8" },
        body: '{"query":"replica","mode":"keyword"}',
      });

      for (const response of [textPlain, none]) {
        expect(response.status).toBe(400);
        expect(response.body.error.kind).toBe("invalid_request");
        expect(response.body.error.message).toContain("application/json");
      }
      expect(withCharset.status).toBe(200);
    });

    it("answers a response it cannot serialise with 500 internal, not a broken 200", async () => {
      const server = await serve(
        Promise.resolve({
          ...engine,
          overview: async () => ({ n: 1n }) as never,
        }),
      );
      try {
        await getJson(`${server.url}/healthz`);
        const { status, body } = await getJson(`${server.url}/overview`);

        expect(status).toBe(500);
        expect(body.error.kind).toBe("internal");
      } finally {
        await server.close();
      }
    });

    it("answers 500 internal without leaking the cause, and logs it", async () => {
      const broken: Engine = {
        ...engine,
        overview: () => Promise.reject(new Error("disk on fire")),
      };
      const server = await serve(Promise.resolve(broken));
      try {
        // The engine promise resolves on a later tick than the handler is mounted.
        await getJson(`${server.url}/healthz`);
        const { status, body } = await getJson(`${server.url}/overview`);

        expect(status).toBe(500);
        expect(body).toEqual({
          error: { kind: "internal", message: "Internal error" },
        });
        expect(server.logs.join("\n")).toContain("disk on fire");
      } finally {
        await server.close();
      }
    });
  });

  describe("allowed hosts", () => {
    function getWithHost(server: Served, host: string): Promise<number> {
      return new Promise((resolve, reject) => {
        get(`${server.url}/documents`, { headers: { host } }, (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        }).on("error", reject);
      });
    }

    it("answers only to the names it was given, on every route and whatever the port", async () => {
      const server = await serve(Promise.resolve(engine), {
        allowedHosts: ["localhost", "127.0.0.1", "[::1]"],
      });
      try {
        await getJson(`${server.url}/healthz`);
        const own = await getWithHost(server, `localhost:${server.port}`);
        const bare = await getWithHost(server, "127.0.0.1");
        const ipv6 = await getWithHost(server, `[::1]:${server.port}`);
        const rebound = await getWithHost(
          server,
          `evil.example:${server.port}`,
        );
        const health = await new Promise<number>((resolve) => {
          get(
            `${server.url}/healthz`,
            { headers: { host: "evil.example" } },
            (res) => {
              res.resume();
              resolve(res.statusCode ?? 0);
            },
          );
        });

        expect([own, bare, ipv6]).toEqual([200, 200, 200]);
        expect([rebound, health]).toEqual([400, 400]);
      } finally {
        await server.close();
      }
    });

    it("accepts a trailing dot and a request with no Host header", async () => {
      const server = await serve(Promise.resolve(engine), {
        allowedHosts: ["localhost", "127.0.0.1", "[::1]"],
      });
      try {
        const dotted = await getWithHost(server, "localhost.");
        const noHost = await new Promise<string>((resolve) => {
          const socket = connect(server.port, "127.0.0.1", () =>
            socket.write("GET /healthz HTTP/1.0\r\n\r\n"),
          );
          let text = "";
          socket.on("data", (data) => {
            text += data;
          });
          socket.on("close", () => resolve(text));
        });

        expect(dotted).toBe(200);
        expect(noHost).toMatch(/^HTTP\/1\.1 200 /);
      } finally {
        await server.close();
      }
    });

    it("accepts any host when none are listed", async () => {
      const server = await serve(Promise.resolve(engine));
      try {
        await getJson(`${server.url}/healthz`);
        const status = await new Promise<number>((resolve) => {
          get(
            `${server.url}/healthz`,
            { headers: { host: "kb.internal" } },
            (res) => {
              res.resume();
              resolve(res.statusCode ?? 0);
            },
          );
        });

        expect(status).toBe(200);
      } finally {
        await server.close();
      }
    });
  });

  describe("shutdown", () => {
    it("drops a connection that is still open when the grace period ends", async () => {
      const server = await serve(Promise.resolve(engine), {
        shutdownGraceMs: 100,
      });
      const stuck = connect(server.port, "127.0.0.1");
      stuck.on("error", () => {});
      await new Promise<void>((resolve) => stuck.once("connect", resolve));
      stuck.write(
        "POST /search HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{",
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      const started = Date.now();

      await server.close();

      expect(Date.now() - started).toBeLessThan(3000);
      expect(server.logs.join("\n")).toContain("grace period");
      stuck.destroy();
    });
  });

  describe("readiness", () => {
    it("is alive at once, ready only when the engine has resolved, and answers 503 until then", async () => {
      let resolveEngine: (engine: Engine) => void = () => {};
      const pending = new Promise<Engine>((resolve) => {
        resolveEngine = resolve;
      });
      const server = await serve(pending);
      try {
        const health = await getJson(`${server.url}/healthz`);
        const readyBefore = await getJson(`${server.url}/readyz`);
        const overviewBefore = await getJson(`${server.url}/overview`);

        expect(health).toMatchObject({ status: 200, body: { status: "ok" } });
        expect(readyBefore.status).toBe(503);
        expect(readyBefore.body.error.kind).toBe("startup");
        expect(overviewBefore.status).toBe(503);
        expect(overviewBefore.body.error.kind).toBe("startup");

        resolveEngine(engine);
        await pending;
        const readyAfter = await getJson(`${server.url}/readyz`);
        const overviewAfter = await getJson(`${server.url}/overview`);

        expect(readyAfter).toMatchObject({
          status: 200,
          body: { status: "ready" },
        });
        expect(overviewAfter.status).toBe(200);
      } finally {
        await server.close();
      }
    });

    it("answers 503 once the engine has failed, keeps the reason in the log and stays alive", async () => {
      const failing = Promise.reject(new Error("stale sidecars"));
      const server = await serve(failing);
      try {
        await failing.catch(() => {});
        const health = await getJson(`${server.url}/healthz`);
        const ready = await getJson(`${server.url}/readyz`);
        const list = await getJson(`${server.url}/documents`);

        expect(health.status).toBe(200);
        for (const response of [ready, list]) {
          expect(response.status).toBe(503);
          expect(response.body.error.kind).toBe("startup");
          expect(response.body.error.message).not.toContain("stale sidecars");
        }
        expect(server.logs.join("\n")).toContain("stale sidecars");
      } finally {
        await server.close();
      }
    });
  });
});
