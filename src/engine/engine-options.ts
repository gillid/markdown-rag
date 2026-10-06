import { z } from "zod";

/** Strict, so a misspelt option is an error rather than the default quietly applying. */
export const engineOptionsSchema = z.strictObject({
  /** Load and warm up the query models at startup (default true). Without them `search` fails, and commands that only read documents skip the cost. */
  loadModels: z.boolean().optional(),
});

export type EngineOptions = z.infer<typeof engineOptionsSchema>;
