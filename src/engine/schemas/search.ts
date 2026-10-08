import { z } from "zod";
import { filterSchema } from "../../index/filter.ts";
import { SEARCH_MODES } from "../../index/search-mode.ts";
import {
  MAX_EXPAND,
  MAX_LIMIT,
  MIN_EXPAND,
  MIN_LIMIT,
} from "../../retrieval/types.ts";
import { hasNoVisibleText } from "../../retrieval/visible-text.ts";
import type { DeepReadonly } from "./deep-readonly.ts";
import { documentSummarySchema } from "./document.ts";

// `JSON.parse` makes `__proto__` an own key and zod's record skips it before any key check, which would silently ignore the weight.
const weightsSchema = z
  .custom<Record<string, number>>(
    (value) =>
      typeof value !== "object" ||
      value === null ||
      !Object.hasOwn(value, "__proto__"),
    { message: 'must not have a "__proto__" key' },
  )
  .pipe(z.record(z.string(), z.number()));

export const searchRequestSchema = z.strictObject({
  query: z.string().refine((query) => !hasNoVisibleText(query), {
    message: "must not be blank",
  }),
  filter: filterSchema.optional(),
  mode: z.enum(SEARCH_MODES).optional(),
  limit: z.int().min(MIN_LIMIT).max(MAX_LIMIT).optional(),
  min_score: z.number().optional(),
  weights: weightsSchema.optional(),
  expand: z.int().min(MIN_EXPAND).max(MAX_EXPAND).optional(),
});

export type SearchRequest = z.input<typeof searchRequestSchema>;

/** How a result was scored, stage by stage (ADR-036). */
const scoresSchema = z.strictObject({
  retrieval: z.number(),
  rerank: z.number().nullable(),
  relevance: z.number(),
  signals: z.record(z.string(), z.number()),
  final: z.number(),
});

/** The document summary, with `ref` naming the best chunk (ADR-035, ADR-036). */
export const searchResultSchema = documentSummarySchema.extend({
  breadcrumb: z.string(),
  text: z.string(),
  scores: scoresSchema,
});

export type SearchResult = DeepReadonly<z.infer<typeof searchResultSchema>>;

export const searchResponseSchema = z.strictObject({
  results: z.array(searchResultSchema),
  timings: z.strictObject({
    embed_ms: z.number(),
    search_ms: z.number(),
    rerank_ms: z.number(),
    total_ms: z.number(),
  }),
  index_version: z.string(),
});

export type SearchResponse = DeepReadonly<z.infer<typeof searchResponseSchema>>;
