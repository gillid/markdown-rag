import { listRequestSchema } from "../engine/index.ts";
import {
  DEFAULT_LIST_LIMIT,
  LIST_SORTS,
  MAX_LIST_LIMIT,
} from "../engine/schemas/list.ts";
import {
  FILTER_HELP,
  FILTER_OPTIONS,
  filterFromFlags,
} from "./filter-flags.ts";
import {
  checkAgainstSchema,
  optionalInteger,
  parseEnumFlag,
} from "./flag-values.ts";
import { parseFlags } from "./parse-flags.ts";
import { renderList } from "./render/render-list.ts";
import { type CliResult, toJson } from "./result.ts";
import {
  COMMON_HELP,
  COMMON_OPTIONS,
  commonInvocation,
  defaultQueryDeps,
  type QueryDeps,
  runQuery,
  SHOW_HELP,
} from "./run-query.ts";

export const LIST_HELP = `Usage: md-rag list --source-dir <dir> [options]

Lists the documents that match the filter, unranked: one line per document
with its ref, title, source, updated date and tags. Use it to enumerate or to
find what changed recently; use \`search\` to answer a question.

Options:
  --sort <order>      path (default) or updated_at (newest first)
  --limit <n>         Documents per page (default ${DEFAULT_LIST_LIMIT}, maximum ${MAX_LIST_LIMIT})
  --offset <n>        Documents to skip (default 0)
${COMMON_HELP}
${FILTER_HELP}`;

export function runList(
  argv: readonly string[],
  deps: QueryDeps = defaultQueryDeps,
): Promise<CliResult> {
  return runQuery({ command: "list", help: LIST_HELP, argv }, deps, () => {
    const { values } = parseFlags(
      argv,
      {
        ...COMMON_OPTIONS,
        ...FILTER_OPTIONS,
        sort: { type: "string" },
        limit: { type: "string" },
        offset: { type: "string" },
      },
      false,
    );
    if (values.help) return SHOW_HELP;
    const filter = filterFromFlags(values);
    const sort = parseEnumFlag("sort", LIST_SORTS, values.sort);
    const limit = optionalInteger("limit", values.limit);
    const offset = optionalInteger("offset", values.offset) ?? 0;
    const request = { filter, sort, limit, offset };
    checkAgainstSchema(listRequestSchema, request);
    return {
      ...commonInvocation(values),
      loadModels: false,
      async operation(engine) {
        const list = await engine.listDocuments(request);
        return values.json ? toJson(list) : renderList(list, offset);
      },
    };
  });
}
