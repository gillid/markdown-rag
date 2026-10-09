import type { Engine } from "../engine/start-engine.ts";
import { errorMessage } from "../errors.ts";

export type EngineState =
  | { status: "pending" }
  | { status: "ready"; engine: Engine }
  | { status: "failed"; cause: unknown };

// Handles the rejection too, so a handler mounted before startup finishes never leaves it unhandled.
export function trackEngine(
  engine: Promise<Engine>,
  log: (message: string) => void,
): () => EngineState {
  let state: EngineState = { status: "pending" };
  engine.then(
    (ready) => {
      state = { status: "ready", engine: ready };
      log("markdown-rag: ready");
    },
    (cause: unknown) => {
      state = { status: "failed", cause };
      log(`markdown-rag: the engine failed to start: ${errorMessage(cause)}`);
    },
  );
  return () => state;
}
