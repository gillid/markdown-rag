import type { WhereCondition } from "@orama/orama";
import { z } from "zod";
import { ancestorDirs } from "./chunk-record.ts";
import type { ChunkSchema } from "./chunk-schema.ts";
import type { DocumentSummary } from "./knowledge-index.ts";

type Where = WhereCondition<ChunkSchema>;

const nameList = z.array(z.string().min(1, "must not be empty"));

const relativeDir = z
  .string()
  .refine((dir) => !dir.includes("\\"), {
    message: "must use / as the separator, not backslashes",
  })
  .refine((dir) => !dir.split("/").includes(".."), {
    message: 'must not contain ".." segments',
  });

/** The filter every operation shares (ADR-035); strict, so a misspelt field is an error rather than "no constraint". */
export const filterSchema = z.strictObject({
  sources: nameList.optional(),
  tags: nameList.optional(),
  tags_any: nameList.optional(),
  // Matches documents anywhere beneath it; `./a`, `/a` and `a/` all name `a` (see `normaliseDir`).
  dir: relativeDir.optional(),
  updated_after: z.number().optional(),
});

export type Filter = z.infer<typeof filterSchema>;

function isPresent(list: string[] | undefined): list is string[] {
  return list !== undefined && list.length > 0;
}

/** `ops/`, `/ops`, `./ops` and `ops//db` name the same directories as their clean forms, and the root (`""`, `/` or `.`) is every document, so it constrains nothing. */
function normaliseDir(dir: string | undefined): string | undefined {
  if (dir === undefined) return undefined;
  const segments = dir.split("/").filter((s) => s !== "" && s !== ".");
  return segments.length === 0 ? undefined : segments.join("/");
}

/** The Orama `where` clause for a filter, or undefined when it constrains nothing. */
export function toWhere(filter: Filter = {}): Where | undefined {
  const dir = normaliseDir(filter.dir);
  const clauses: Where[] = [];
  if (isPresent(filter.sources)) {
    clauses.push({ source: { in: filter.sources } });
  }
  if (isPresent(filter.tags)) {
    clauses.push({ tags: { containsAll: filter.tags } });
  }
  if (isPresent(filter.tags_any)) {
    clauses.push({ tags: { containsAny: filter.tags_any } });
  }
  if (dir !== undefined) {
    clauses.push({ dirs: { containsAll: [dir] } });
  }
  if (filter.updated_after !== undefined) {
    clauses.push({ updated_at: { gt: filter.updated_after } });
  }
  return clauses.length > 0 ? { and: clauses } : undefined;
}

/** The same semantics as `toWhere`, over document summaries, for the unranked operations. */
export function matchesFilter(
  summary: Pick<DocumentSummary, "path" | "source" | "tags" | "updatedAt">,
  filter: Filter = {},
): boolean {
  const { sources, tags, tags_any, updated_after } = filter;
  const dir = normaliseDir(filter.dir);
  return (
    (!isPresent(sources) || sources.includes(summary.source)) &&
    (!isPresent(tags) || tags.every((tag) => summary.tags.includes(tag))) &&
    (!isPresent(tags_any) ||
      tags_any.some((tag) => summary.tags.includes(tag))) &&
    (dir === undefined || ancestorDirs(summary.path).includes(dir)) &&
    (updated_after === undefined || summary.updatedAt > updated_after)
  );
}
