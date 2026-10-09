import { ConfigError, type ConfigInput, loadConfig } from "../config/config.ts";
import {
  createEngine,
  type Engine,
  type EngineOptions,
} from "../engine/index.ts";
import { createHttpHandler } from "../http/handler.ts";
import { loopbackNames } from "../http/loopback.ts";
import { listen } from "../http/server.ts";
import { RetrievalOptionError } from "../retrieval/errors.ts";
import { resolveDefaults } from "../retrieval/options.ts";
import { FlagError } from "./flag-error.ts";
import { parseIntegerFlag, parseNamedNumbers } from "./flag-values.ts";
import { commandFailure, type ParsedFlags, preflight } from "./preflight.ts";
import type { CliResult } from "./result.ts";

export const DEFAULT_PORT = 3000;
// No auth in the PoC, so the default keeps the server to this machine.
export const DEFAULT_HOST = "127.0.0.1";
const MAX_PORT = 65535;

export const SERVE_HELP = `Usage: markdown-rag serve --source-dir <dir> [options]

Serves the knowledge base over HTTP: GET /overview, POST /search,
GET /documents, GET /documents/{ref}, GET /healthz and GET /readyz. It starts
listening at once and answers 503 until the index is built and the models
are loaded (/readyz turns 200 then). Logs go to stderr. SIGTERM or SIGINT
stops it after the requests in flight finish.

Options:
  --port <n>          Port to listen on (default ${DEFAULT_PORT}; 0 picks a free one)
  --host <address>    Address to bind (default ${DEFAULT_HOST}, this machine only; a container
                      needs 0.0.0.0. There is no auth, so put network controls in front)
  --weight <name=x>   Default ranking weight, repeatable: recency=x, or tag:<tag>=x to boost
                      (x > 0) or penalise (x < 0) documents with that tag; a request can override it.
                      A tag containing "=" can only be weighted through the library
  --models-dir <dir>  The model cache (default: <target-dir>/models/)
  --offline           Never download models; fail if they are not cached
  --source-dir <dir>  The knowledge base to serve (required)
  --target-dir <dir>  The engine folder (default: <source-dir>/.markdown-rag/)
  -h, --help          Show this help message
`;

export interface ServeDeps {
  createEngine(input: ConfigInput, options: EngineOptions): Promise<Engine>;
  /** Aborted when the process should stop serving. */
  shutdown: AbortSignal;
  log(message: string): void;
}

/** Stops on SIGTERM (a deployment) or SIGINT (a terminal). */
export function processServeDeps(): ServeDeps {
  const controller = new AbortController();
  process.once("SIGTERM", () => controller.abort());
  process.once("SIGINT", () => controller.abort());
  return {
    createEngine,
    shutdown: controller.signal,
    log: (message) => process.stderr.write(`${message}\n`),
  };
}

/** Resolves true when the engine failed to start, false when the process was told to stop. */
function untilStoppedOrFailed(
  engine: Promise<Engine>,
  shutdown: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (shutdown.aborted) return resolve(false);
    shutdown.addEventListener("abort", () => resolve(false), { once: true });
    engine.catch(() => resolve(true));
  });
}

export async function runServe(
  argv: readonly string[],
  suppliedDeps?: ServeDeps,
): Promise<CliResult> {
  const descriptor = { command: "serve", help: SERVE_HELP };
  const opening = preflight(
    descriptor,
    { argv, options: SERVE_OPTIONS, allowPositionals: false },
    serveValues,
  );
  if (!opening.ok) return opening.result;
  const { values } = opening;

  const input: ConfigInput = {
    sourceDir: values.sourceDir,
    targetDir: values.targetDir,
    modelsDir: values.modelsDir,
    allowRemoteModels: values.offline ? false : undefined,
    retrieval: values.weights === undefined ? {} : { weights: values.weights },
  };
  // A rejected setting is the caller's to fix, so it is reported before the port opens or a model loads. A weight for a tag no document carries needs the index, so it fails at engine start instead.
  try {
    resolveDefaults(loadConfig(input).retrieval);
  } catch (cause) {
    if (cause instanceof ConfigError || cause instanceof RetrievalOptionError) {
      return commandFailure(descriptor, "usage", cause);
    }
    throw cause;
  }

  const deps = suppliedDeps ?? processServeDeps();
  // The engine starts only once the port is bound, so a taken port wastes no model load.
  let startEngine: () => void = () => {};
  const engine = new Promise<Engine>((resolve, reject) => {
    startEngine = () => {
      try {
        resolve(deps.createEngine(input, { loadModels: true }));
      } catch (cause) {
        reject(cause);
      }
    };
  });
  const ownNames = loopbackNames(values.host);
  let server: Awaited<ReturnType<typeof listen>>;
  try {
    server = await listen(
      createHttpHandler(engine, { log: deps.log, allowedHosts: ownNames }),
      { port: values.port, host: values.host },
      deps.log,
    );
  } catch (cause) {
    return commandFailure(descriptor, "startup", cause);
  }
  deps.log(`markdown-rag: listening on ${server.host}:${server.port}`);
  if (ownNames === undefined) {
    deps.log(
      "markdown-rag: reachable beyond this machine, with no auth and no Host check; put network controls in front",
    );
  }
  if (!deps.shutdown.aborted) startEngine();

  const startupFailed = await untilStoppedOrFailed(engine, deps.shutdown);
  await server.close();
  // Exits at once because a model load in flight must not keep a stopped server alive; the cache is written via temp file and rename, so that is safe.
  return {
    exitCode: startupFailed ? 1 : 0,
    stdout: "",
    stderr: "",
    stopProcess: true,
  };
}

const SERVE_OPTIONS = {
  "source-dir": { type: "string" },
  "target-dir": { type: "string" },
  "models-dir": { type: "string" },
  offline: { type: "boolean" },
  port: { type: "string" },
  host: { type: "string" },
  weight: { type: "string", multiple: true },
} as const;

function serveValues({ values }: ParsedFlags<typeof SERVE_OPTIONS>) {
  const port =
    values.port === undefined
      ? DEFAULT_PORT
      : parseIntegerFlag("port", values.port);
  if (port < 0 || port > MAX_PORT) {
    throw new FlagError(
      `--port must be between 0 and ${MAX_PORT}, got ${port}`,
    );
  }
  if (values.host === "") throw new FlagError("--host must not be empty");
  return {
    sourceDir: values["source-dir"],
    targetDir: values["target-dir"],
    modelsDir: values["models-dir"],
    offline: values.offline === true,
    port,
    host: values.host ?? DEFAULT_HOST,
    weights:
      values.weight === undefined
        ? undefined
        : parseNamedNumbers("weight", values.weight),
  };
}
