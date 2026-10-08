import { DocumentNotFoundError, InvalidRequestError } from "./errors.ts";

/** The stable codes of the error object shared by the CLI and the HTTP API (ADR-041). */
export type FailureKind =
  | "usage"
  | "invalid_request"
  | "not_found"
  | "startup"
  | "internal";

export function operationFailureKind(cause: unknown): FailureKind {
  if (cause instanceof InvalidRequestError) return "invalid_request";
  if (cause instanceof DocumentNotFoundError) return "not_found";
  return "internal";
}
