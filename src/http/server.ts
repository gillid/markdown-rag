import { createServer } from "node:http";
import { errorMessage } from "../errors.ts";
import type { HttpHandler } from "./handler.ts";

export interface RunningServer {
  readonly host: string;
  readonly port: number;
  /** Stops accepting connections and resolves once the requests in flight have finished, or the grace period is over. */
  close(): Promise<void>;
}

export interface ListenOptions {
  port: number;
  host: string;
  /** How long `close` waits for requests in flight before it drops their connections. */
  shutdownGraceMs?: number;
}

const DEFAULT_SHUTDOWN_GRACE_MS = 10_000;

export function listen(
  handler: HttpHandler,
  { port, host, shutdownGraceMs = DEFAULT_SHUTDOWN_GRACE_MS }: ListenOptions,
  log: (message: string) => void,
): Promise<RunningServer> {
  let closing = false;
  const server = createServer((req, res) => {
    // A keep-alive connection that finishes its request after shutdown began must not linger as an idle one.
    if (closing) res.setHeader("connection", "close");
    res.once("finish", () => {
      if (closing) req.socket.end();
    });
    handler(req, res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      server.on("error", (error) =>
        log(`server error: ${errorMessage(error)}`),
      );
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("The server has no TCP address"));
        return;
      }
      resolve({
        host,
        port: address.port,
        close: () =>
          new Promise((done, fail) => {
            closing = true;
            // A stuck or slow client must not outlast the orchestrator's grace period.
            const deadline = setTimeout(() => {
              log(
                "server: closing connections still open after the grace period",
              );
              server.closeAllConnections();
            }, shutdownGraceMs);
            server.close((error) => {
              clearTimeout(deadline);
              if (error) fail(error);
              else done();
            });
            server.closeIdleConnections();
          }),
      });
    });
  });
}
