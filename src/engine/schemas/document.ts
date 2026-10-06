import { z } from "zod";
import type { DeepReadonly } from "./deep-readonly.ts";

/** The fields every operation shares for a document (ADR-035). */
export const documentSummarySchema = z.strictObject({
  ref: z.string(),
  path: z.string(),
  title: z.string(),
  source: z.string(),
  tags: z.array(z.string()),
  updated_at: z.number(),
  url: z.string().optional(),
  signals: z.record(z.string(), z.number()),
  meta: z.record(z.string(), z.unknown()),
});

export type DocumentSummaryOutput = DeepReadonly<
  z.infer<typeof documentSummarySchema>
>;

export const outlineEntrySchema = z.strictObject({
  depth: z.number(),
  text: z.string(),
  anchor: z.string(),
});

export const documentSchema = documentSummarySchema.extend({
  outline: z.array(outlineEntrySchema),
  /** Absent when the caller asked for `body: false`. */
  body: z.string().optional(),
});

export type DocumentOutput = DeepReadonly<z.infer<typeof documentSchema>>;

export const documentRefSchema = z.string().min(1, "must not be empty");

export const getDocumentOptionsSchema = z.strictObject({
  body: z.boolean().optional(),
});

export type GetDocumentOptions = z.infer<typeof getDocumentOptionsSchema>;
