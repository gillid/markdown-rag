import { z } from "zod";
import { filterSchema } from "../../index/filter.ts";
import type { DeepReadonly } from "./deep-readonly.ts";
import { documentSummarySchema } from "./document.ts";

export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 500;
export const LIST_SORTS = ["path", "updated_at"] as const;

export const listRequestSchema = z.strictObject({
  filter: filterSchema.optional(),
  sort: z.enum(LIST_SORTS).optional(),
  limit: z.int().min(1).max(MAX_LIST_LIMIT).optional(),
  offset: z.int().min(0).optional(),
});

export type ListRequest = z.input<typeof listRequestSchema>;

export const documentListSchema = z.strictObject({
  total: z.number(),
  documents: z.array(documentSummarySchema),
  index_version: z.string(),
});

export type DocumentList = DeepReadonly<z.infer<typeof documentListSchema>>;
