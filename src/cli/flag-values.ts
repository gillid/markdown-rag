import { z } from "zod";
import { FlagError } from "./flag-error.ts";

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

// The engine would reject these too, but only after the index is built and the models are loaded.
export function checkAgainstSchema(schema: z.ZodType, request: unknown): void {
  const result = schema.safeParse(request);
  if (!result.success) {
    throw new FlagError(z.prettifyError(result.error));
  }
}

export function parseEnumFlag<Value extends string>(
  flag: string,
  allowed: readonly Value[],
  text: string | undefined,
): Value | undefined {
  if (text === undefined) return undefined;
  const value = allowed.find((candidate) => candidate === text);
  if (value === undefined) {
    throw new FlagError(
      `--${flag} must be one of ${allowed.join(", ")}, got "${text}"`,
    );
  }
  return value;
}

/** `Number("")` is 0 and `Number("0x10")` is 16, so the text is checked before it is converted. */
export function parseNumberFlag(flag: string, text: string): number {
  if (!NUMBER.test(text)) {
    throw new FlagError(`--${flag} must be a number, got "${text}"`);
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    throw new FlagError(`--${flag} must be a finite number, got "${text}"`);
  }
  return value;
}

export function parseIntegerFlag(flag: string, text: string): number {
  const value = parseNumberFlag(flag, text);
  if (!Number.isInteger(value)) {
    throw new FlagError(`--${flag} must be an integer, got "${text}"`);
  }
  return value;
}

export function parseNamedNumbers(
  flag: string,
  entries: readonly string[],
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    const name = entry.slice(0, separator);
    if (separator === -1 || name === "") {
      throw new FlagError(
        `--${flag} must look like name=value, got "${entry}"`,
      );
    }
    // Assigning `__proto__` is a no-op, and zod's record drops that key too, so it would vanish without an error.
    if (name === "__proto__") {
      throw new FlagError(`--${flag} cannot name "__proto__"`);
    }
    if (Object.hasOwn(result, name)) {
      throw new FlagError(`--${flag} names "${name}" more than once`);
    }
    result[name] = parseNumberFlag(flag, entry.slice(separator + 1));
  }
  return result;
}

export function optionalNumber(
  flag: string,
  text: string | undefined,
): number | undefined {
  return text === undefined ? undefined : parseNumberFlag(flag, text);
}

export function optionalInteger(
  flag: string,
  text: string | undefined,
): number | undefined {
  return text === undefined ? undefined : parseIntegerFlag(flag, text);
}
