import type { IncomingMessage, ServerResponse } from "node:http";
import { InvalidRequestError, parseRequest } from "../engine/errors.ts";
import { operationFailureKind } from "../engine/failure-kind.ts";
import { searchRequestSchema } from "../engine/schemas/search.ts";
import type { Engine } from "../engine/start-engine.ts";
import { errorMessage } from "../errors.ts";
import { type EngineState, trackEngine } from "./engine-state.ts";
import { HttpFailure, sendFailure } from "./http-failure.ts";
import {
  bodyFlagFromParams,
  FILTER_PARAMS,
  filterFromParams,
  LIST_PARAMS,
  listRequestFromParams,
  rejectUnknownParams,
} from "./query-params.ts";
import { ClientDisconnectedError, readJsonBody } from "./read-json-body.ts";
import { sendJson } from "./send-json.ts";

export type HttpHandler = (req: IncomingMessage, res: ServerResponse) => void;

export interface HttpHandlerOptions {
  /** Where internal errors are reported; stderr by default. */
  log?: (message: string) => void;
  /** Refuses any other `Host`, which stops DNS rebinding; unset accepts every host. */
  allowedHosts?: readonly string[];
}

const DOCUMENTS_PREFIX = "/documents/";

function logToStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

function requireMethod(req: IncomingMessage, ...allowed: string[]): void {
  if (req.method === undefined || !allowed.includes(req.method)) {
    const list = allowed.join(", ");
    throw new HttpFailure("usage", `This route accepts ${list} only`, {
      status: 405,
      headers: { allow: list },
    });
  }
}

// `URL.pathname` collapses `..` segments, even percent-encoded, and turns `\` into `/`; a ref must reach the engine as sent.
function rawPath(req: IncomingMessage): string {
  const target = req.url ?? "/";
  const query = target.indexOf("?");
  return query === -1 ? target : target.slice(0, query);
}

function hostName(header: string): string {
  const value = header.toLowerCase();
  const end = value.startsWith("[")
    ? value.indexOf("]") + 1
    : value.indexOf(":");
  const name = end > 0 ? value.slice(0, end) : value;
  return name.endsWith(".") ? name.slice(0, -1) : name;
}

function requireAllowedHost(
  req: IncomingMessage,
  allowedHosts: readonly string[] | undefined,
): void {
  // A browser always sends `Host`, so only a non-browser client (HTTP/1.0) can omit it.
  if (allowedHosts === undefined || req.headers.host === undefined) return;
  const name = hostName(req.headers.host);
  if (!allowedHosts.includes(name)) {
    throw new HttpFailure(
      "usage",
      `This server answers only to ${allowedHosts.join(", ")}, not to "${name}"`,
    );
  }
}

// A browser sends any other type cross-origin without asking first; JSON needs a preflight, which is never granted.
function requireJson(req: IncomingMessage): void {
  const type = (req.headers["content-type"] ?? "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  if (type !== "application/json") {
    throw new HttpFailure(
      "invalid_request",
      "This route needs a body with Content-Type: application/json",
    );
  }
}

function readyEngine(state: EngineState): Engine {
  if (state.status === "ready") return state.engine;
  throw new HttpFailure(
    "startup",
    state.status === "pending"
      ? "The engine is still starting"
      : "The engine failed to start; the server log says why",
  );
}

function documentRef(pathname: string): string {
  try {
    return decodeURIComponent(pathname.slice(DOCUMENTS_PREFIX.length));
  } catch {
    throw new InvalidRequestError(
      "The document ref is not valid percent-encoding",
    );
  }
}

function parseUrl(req: IncomingMessage): URL {
  try {
    return new URL(`http://localhost${req.url ?? "/"}`);
  } catch {
    throw new InvalidRequestError("The request URL is malformed");
  }
}

/** Serves the four operations of ADR-035 plus liveness and readiness; mount it on `node:http` or wrap it. */
export function createHttpHandler(
  engine: Promise<Engine>,
  { log = logToStderr, allowedHosts }: HttpHandlerOptions = {},
): HttpHandler {
  const state = trackEngine(engine, log);

  async function respond(req: IncomingMessage, res: ServerResponse) {
    requireAllowedHost(req, allowedHosts);
    const { searchParams } = parseUrl(req);
    const pathname = rawPath(req);

    if (pathname === "/healthz") {
      requireMethod(req, "GET", "HEAD");
      return sendJson(res, 200, { status: "ok" });
    }
    if (pathname === "/readyz") {
      requireMethod(req, "GET", "HEAD");
      readyEngine(state());
      return sendJson(res, 200, { status: "ready" });
    }

    if (pathname === "/overview") {
      requireMethod(req, "GET");
      const ready = readyEngine(state());
      rejectUnknownParams(searchParams, FILTER_PARAMS);
      return sendJson(
        res,
        200,
        await ready.overview(filterFromParams(searchParams)),
      );
    }
    if (pathname === "/search") {
      requireMethod(req, "POST");
      const ready = readyEngine(state());
      requireJson(req);
      const request = parseRequest(
        searchRequestSchema,
        await readJsonBody(req),
        "search",
      );
      return sendJson(res, 200, await ready.search(request));
    }
    if (pathname === "/documents") {
      requireMethod(req, "GET");
      const ready = readyEngine(state());
      rejectUnknownParams(searchParams, LIST_PARAMS);
      return sendJson(
        res,
        200,
        await ready.listDocuments(listRequestFromParams(searchParams)),
      );
    }
    if (pathname.startsWith(DOCUMENTS_PREFIX)) {
      requireMethod(req, "GET");
      const ready = readyEngine(state());
      rejectUnknownParams(searchParams, ["body"]);
      const body = bodyFlagFromParams(searchParams);
      return sendJson(
        res,
        200,
        await ready.getDocument(documentRef(pathname), { body }),
      );
    }
    throw new HttpFailure("not_found", `No route for ${pathname}`);
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      await respond(req, res);
    } catch (cause) {
      if (cause instanceof ClientDisconnectedError) return;
      if (cause instanceof HttpFailure) {
        return sendFailure(res, cause.kind, cause.message, cause.response);
      }
      const kind = operationFailureKind(cause);
      if (kind !== "internal")
        return sendFailure(res, kind, errorMessage(cause));
      log(
        `internal error: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`,
      );
      sendFailure(res, "internal", "Internal error");
    }
  }

  return (req, res) => {
    handle(req, res).catch((cause: unknown) => {
      log(`failed to answer a request: ${errorMessage(cause)}`);
      res.destroy();
    });
  };
}
