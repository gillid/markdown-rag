import type { IncomingMessage } from "node:http";
import { InvalidRequestError } from "../engine/errors.ts";
import { errorMessage } from "../errors.ts";
import { HttpFailure } from "./http-failure.ts";

export const MAX_BODY_BYTES = 1024 * 1024;
// Past this the client is not slow but abusive, and a reset is the answer.
const MAX_DISCARDED_BYTES = 16 * 1024 * 1024;

/** The client went away before it sent the whole body, so there is nobody to answer. */
export class ClientDisconnectedError extends Error {
  override readonly name = "ClientDisconnectedError";
}

function tooLarge(): HttpFailure {
  return new HttpFailure(
    "invalid_request",
    `The request body is larger than ${MAX_BODY_BYTES} bytes`,
  );
}

// An oversized upload is read and discarded: closing a socket with unread data makes the OS reset it and the client lose the answer.
export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      finish();
    };
    const declared = Number(req.headers["content-length"]);

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_DISCARDED_BYTES) {
        req.destroy();
        return;
      }
      if (size > MAX_BODY_BYTES || declared > MAX_BODY_BYTES) {
        chunks.length = 0;
        settle(() => reject(tooLarge()));
        return;
      }
      chunks.push(chunk);
    });
    if (declared > MAX_BODY_BYTES) settle(() => reject(tooLarge()));
    req.on("end", () =>
      settle(() => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (cause) {
          reject(
            new InvalidRequestError(
              `The request body is not valid JSON: ${errorMessage(cause)}`,
            ),
          );
        }
      }),
    );
    const disconnected = () =>
      settle(() => reject(new ClientDisconnectedError("aborted")));
    req.on("error", disconnected);
    req.on("close", disconnected);
  });
}
