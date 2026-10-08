import type { ServerResponse } from "node:http";
import type { FailureKind } from "../engine/failure-kind.ts";
import { sendJson } from "./send-json.ts";

const STATUS: Record<FailureKind, number> = {
  usage: 400,
  invalid_request: 400,
  not_found: 404,
  startup: 503,
  internal: 500,
};

interface FailureResponse {
  status?: number;
  headers?: Readonly<Record<string, string>>;
}

/** A failure the HTTP layer raises itself: an unknown route, a wrong method, an engine that is not ready. */
export class HttpFailure extends Error {
  override readonly name = "HttpFailure";
  readonly kind: FailureKind;
  readonly response: FailureResponse;

  constructor(
    kind: FailureKind,
    message: string,
    response: FailureResponse = {},
  ) {
    super(message);
    this.kind = kind;
    this.response = response;
  }
}

/** The error object of ADR-041. */
export function sendFailure(
  res: ServerResponse,
  kind: FailureKind,
  message: string,
  { status = STATUS[kind], headers }: FailureResponse = {},
): void {
  sendJson(res, status, { error: { kind, message } }, headers);
}
