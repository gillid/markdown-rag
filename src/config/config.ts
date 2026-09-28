import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";

const ENGINE_DIR_NAME = ".md-rag";

// Every optional field gets a default here, so Config is always complete.
const configSchema = z
  .strictObject({
    sourceDir: z.string().min(1, "must not be empty"),
    targetDir: z.string().min(1, "must not be empty").optional(),
  })
  .transform((input, ctx) => {
    const sourceDir = resolve(input.sourceDir);
    const targetDir =
      input.targetDir === undefined
        ? join(sourceDir, ENGINE_DIR_NAME)
        : resolve(input.targetDir);
    if (isSameOrAncestor(targetDir, sourceDir)) {
      ctx.issues.push({
        code: "custom",
        message: "must not be sourceDir or one of its parent directories",
        path: ["targetDir"],
        input: input.targetDir,
      });
      return z.NEVER;
    }
    return { sourceDir, targetDir };
  });

export type ConfigInput = z.input<typeof configSchema>;
export type Config = z.output<typeof configSchema>;

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

export function loadConfig(input: ConfigInput): Config {
  const result = configSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigError(
      `Invalid configuration:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

function isSameOrAncestor(dir: string, of: string): boolean {
  const path = relative(dir, of);
  return path === "" || (!isAbsolute(path) && path.split(sep)[0] !== "..");
}
