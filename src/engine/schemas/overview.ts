import { z } from "zod";

const countedNameSchema = z.strictObject({
  name: z.string(),
  documents: z.number(),
});

export const overviewSchema = z.strictObject({
  index_version: z.string(),
  /** Null for a knowledge base with no documents, which has no sidecar to name a model. */
  embedding_model: z.string().nullable(),
  documents: z.number(),
  chunks: z.number(),
  tags: z.array(countedNameSchema),
});

export type OverviewOutput = z.infer<typeof overviewSchema>;
