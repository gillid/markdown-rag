import { z } from "zod";

/** The request broke its schema; the message lists every problem. */
export class InvalidRequestError extends Error {
  override readonly name = "InvalidRequestError";
}

/** The `ref` names no indexed document or section. */
export class DocumentNotFoundError extends Error {
  override readonly name = "DocumentNotFoundError";
}

/** `search` was called on an engine created with `loadModels: false`. */
export class ModelsNotLoadedError extends Error {
  override readonly name = "ModelsNotLoadedError";
}

export function parseRequest<Output>(
  schema: z.ZodType<Output>,
  input: unknown,
  operation: string,
): Output {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new InvalidRequestError(
      `Invalid ${operation} request:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
