import { createServer, get } from "node:http";
import { describe, expect, it } from "vitest";
import { runServe, type ServeDeps } from "../../src/cli/serve.ts";
import type { Engine } from "../../src/engine/index.ts";

function deps(overrides: Partial<ServeDeps> = {}): ServeDeps & {
  logs: string[];
  stop(): void;
  /** Resolves with the address from the "listening on" log line. */
  listening(): Promise<{ host: string; port: number }>;
} {
  const logs: string[] = [];
  const controller = new AbortController();
  return {
    createEngine: () => new Promise<Engine>(() => {}),
    shutdown: controller.signal,
    log: (message) => logs.push(message),
    ...overrides,
    logs,
    stop: () => controller.abort(),
    async listening() {
      for (let waited = 0; waited < 5000; waited += 5) {
        const match = logs.join("\n").match(/listening on (\S+):(\d+)/);
        if (match?.[1] && match[2]) {
          return { host: match[1], port: Number(match[2]) };
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error("the server never logged that it was listening");
    },
  };
}

describe("md-rag serve", () => {
  it("prints help even next to a bad port", async () => {
    const result = await runServe(["--port", "abc", "--help"], deps());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: md-rag serve");
  });

  it("rejects a missing source dir and a bad port before listening", async () => {
    const noSource = await runServe([], deps());
    const badPort = await runServe(
      ["--source-dir", "kb", "--port", "70000"],
      deps(),
    );
    const notNumber = await runServe(
      ["--source-dir", "kb", "--port", "http"],
      deps(),
    );

    expect(noSource.exitCode).toBe(1);
    expect(noSource.stderr).toContain("--source-dir is required");
    expect(badPort.stderr).toContain("--port must be between 0 and 65535");
    expect(notNumber.stderr).toContain("--port must be a number");
  });

  it("listens before the engine is ready and exits 0 once told to stop", async () => {
    const d = deps();
    const running = runServe(["--source-dir", "kb", "--port", "0"], d);
    const { port } = await d.listening();

    const ready = await fetch(`http://127.0.0.1:${port}/readyz`);
    expect(ready.status).toBe(503);

    d.stop();
    await expect(running).resolves.toMatchObject({
      exitCode: 0,
      stopProcess: true,
    });
  });

  it("refuses a request addressed to another name while bound to this machine", async () => {
    const d = deps();
    const running = runServe(["--source-dir", "kb", "--port", "0"], d);
    const { port } = await d.listening();
    const status = await new Promise<number>((resolve, reject) => {
      get(
        `http://127.0.0.1:${port}/healthz`,
        { headers: { host: `rebound.example:${port}` } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      ).on("error", reject);
    });

    expect(status).toBe(400);
    d.stop();
    await running;
  });

  it("reports a rejected setting before it opens the port or starts the engine", async () => {
    let started = 0;
    const d = deps({
      createEngine: () => {
        started++;
        return new Promise<Engine>(() => {});
      },
    });

    const result = await runServe(
      ["--source-dir", "kb", "--target-dir", "kb", "--port", "0"],
      d,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("targetDir");
    expect(started).toBe(0);
    expect(d.logs).toEqual([]);
  });

  it("binds this machine only by default, and the address given by --host", async () => {
    const byDefault = deps();
    const wide = deps();
    const running = [
      runServe(["--source-dir", "kb", "--port", "0"], byDefault),
      runServe(
        ["--source-dir", "kb", "--port", "0", "--host", "0.0.0.0"],
        wide,
      ),
    ];
    const defaultAddress = await byDefault.listening();
    const wideAddress = await wide.listening();

    expect(defaultAddress.host).toBe("127.0.0.1");
    expect(wideAddress.host).toBe("0.0.0.0");
    expect(byDefault.logs.join("\n")).not.toContain("no Host check");
    expect(wide.logs.join("\n")).toContain(
      "reachable beyond this machine, with no auth and no Host check",
    );

    byDefault.stop();
    wide.stop();
    await Promise.all(running);
  });

  it("does not start the engine when it was told to stop while the port was binding", async () => {
    let started = 0;
    const d = deps({
      createEngine: () => {
        started++;
        return new Promise<Engine>(() => {});
      },
    });
    d.stop();

    const result = await runServe(["--source-dir", "kb", "--port", "0"], d);

    expect(result.exitCode).toBe(0);
    expect(started).toBe(0);
  });

  it("rejects an empty --host", async () => {
    const result = await runServe(["--source-dir", "kb", "--host", ""], deps());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--host must not be empty");
  });

  it("does not start the engine when the port is taken", async () => {
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, "127.0.0.1", resolve));
    const address = taken.address();
    const port = typeof address === "object" && address ? address.port : 0;
    let started = 0;
    const d = deps({
      createEngine: () => {
        started++;
        return new Promise<Engine>(() => {});
      },
    });
    try {
      const result = await runServe(
        ["--source-dir", "kb", "--port", String(port)],
        d,
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("EADDRINUSE");
      expect(started).toBe(0);
    } finally {
      await new Promise<void>((resolve) => taken.close(() => resolve()));
    }
  });

  it("installs no signal handlers when it only prints help or rejects flags", async () => {
    const before = process.listenerCount("SIGINT");

    await runServe(["--help"]);
    await runServe(["--port", "abc"]);

    expect(process.listenerCount("SIGINT")).toBe(before);
  });

  it("logs a startup failure once and exits non-zero", async () => {
    const d = deps({
      createEngine: () => Promise.reject(new Error("stale sidecars")),
    });

    const result = await runServe(["--source-dir", "kb", "--port", "0"], d);

    expect(result.exitCode).toBe(1);
    expect(
      d.logs.filter((message) => message.includes("stale sidecars")),
    ).toHaveLength(1);
  });

  it("treats a createEngine that throws at once as a startup failure and frees the port", async () => {
    const d = deps({
      createEngine: () => {
        throw new Error("bad argument");
      },
    });

    const result = await runServe(["--source-dir", "kb", "--port", "0"], d);

    const port = d.logs.join("\n").match(/listening on \S+:(\d+)/)?.[1];
    expect(result.exitCode).toBe(1);
    expect(d.logs.join("\n")).toContain("bad argument");
    await expect(fetch(`http://127.0.0.1:${port}/healthz`)).rejects.toThrow();
  });
});
