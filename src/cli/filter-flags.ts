import { updatedAtSchema } from "../contract/updated-at.ts";
import type { Filter } from "../index/filter.ts";
import { FlagError } from "./flag-error.ts";

export const FILTER_OPTIONS = {
  source: { type: "string", multiple: true },
  tag: { type: "string", multiple: true },
  "tag-any": { type: "string", multiple: true },
  dir: { type: "string" },
  since: { type: "string" },
} as const;

export const FILTER_HELP = `Filter (shared by every query command):
  --source <name>   Only this source; repeat for any of several
  --tag <tag>       Only documents with this tag; repeat to require all
  --tag-any <tag>   Only documents with at least one of these tags; repeatable
  --dir <path>      Only documents under this directory of the knowledge base
  --since <date>    Only documents updated on or after this ISO 8601 date or date-time
`;

export interface FilterFlagValues {
  source?: string[];
  tag?: string[];
  "tag-any"?: string[];
  dir?: string;
  since?: string;
}

export function filterFromFlags(values: FilterFlagValues): Filter {
  const filter: Filter = {};
  if (values.source !== undefined) filter.sources = values.source;
  if (values.tag !== undefined) filter.tags = values.tag;
  if (values["tag-any"] !== undefined) filter.tags_any = values["tag-any"];
  if (values.dir !== undefined) filter.dir = values.dir;
  if (values.since !== undefined) {
    const since = updatedAtSchema.safeParse(values.since);
    if (!since.success) {
      throw new FlagError(
        `--since ${since.error.issues.map((issue) => issue.message).join("; ")}`,
      );
    }
    // `updated_after` is exclusive; one millisecond earlier makes `--since` include a document dated exactly then.
    filter.updated_after = since.data - 1;
  }
  return filter;
}
