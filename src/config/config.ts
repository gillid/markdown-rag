import { join, resolve } from "node:path";
import { z } from "zod";
import {
  ENGINE_DIR_NAME,
  MODELS_DIR_NAME,
  VECTORS_DIR_NAME,
} from "./layout.ts";
import { isSameOrAncestor, isStrictlyInside } from "./paths.ts";

// Every optional field gets a default here, so Config is always complete.
const configSchema = z
  .strictObject({
    sourceDir: z.string().min(1, "must not be empty"),
    targetDir: z.string().min(1, "must not be empty").optional(),
    modelsDir: z.string().min(1, "must not be empty").optional(),
    allowRemoteModels: z.boolean().default(true),
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
    const modelsDir =
      input.modelsDir === undefined
        ? join(targetDir, MODELS_DIR_NAME)
        : resolve(input.modelsDir);
    if (isSameOrAncestor(modelsDir, sourceDir)) {
      ctx.issues.push({
        code: "custom",
        message: "must not be sourceDir or one of its parent directories",
        path: ["modelsDir"],
        input: input.modelsDir,
      });
      return z.NEVER;
    }
    if (
      isStrictlyInside(modelsDir, sourceDir) &&
      !isSameOrAncestor(targetDir, modelsDir)
    ) {
      ctx.issues.push({
        code: "custom",
        message:
          "must not be inside sourceDir, unless it is inside targetDir (the engine writes nothing else into a knowledge base)",
        path: ["modelsDir"],
        input: input.modelsDir,
      });
      return z.NEVER;
    }
    const vectorsDir = join(targetDir, VECTORS_DIR_NAME);
    if (isSameOrAncestor(vectorsDir, modelsDir)) {
      ctx.issues.push({
        code: "custom",
        message:
          "must not be the sidecar folder (targetDir/vectors) or inside it",
        path: ["modelsDir"],
        input: input.modelsDir,
      });
      return z.NEVER;
    }
    return {
      sourceDir,
      targetDir,
      modelsDir,
      allowRemoteModels: input.allowRemoteModels,
    };
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
