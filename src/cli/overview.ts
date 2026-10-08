import { filterSchema } from "../engine/index.ts";
import {
  FILTER_HELP,
  FILTER_OPTIONS,
  filterFromFlags,
} from "./filter-flags.ts";
import { checkAgainstSchema } from "./flag-values.ts";
import { renderOverview } from "./render/render-overview.ts";
import { type CliResult, toJson } from "./result.ts";
import {
  COMMON_HELP,
  commonInvocation,
  defaultQueryDeps,
  type QueryDeps,
  runQuery,
} from "./run-query.ts";

export const OVERVIEW_HELP = `Usage: md-rag overview --source-dir <dir> [options]

Counts the documents and chunks, then lists every tag with its document
count, all within the filter. Run it first to learn the real values to filter
by.

Options:
${COMMON_HELP}
${FILTER_HELP}`;

export function runOverview(
  argv: readonly string[],
  deps: QueryDeps = defaultQueryDeps,
): Promise<CliResult> {
  const query = {
    command: "overview",
    help: OVERVIEW_HELP,
    argv,
    options: FILTER_OPTIONS,
    allowPositionals: false,
  } as const;
  return runQuery(query, deps, ({ values }) => {
    const filter = filterFromFlags(values);
    checkAgainstSchema(filterSchema, filter);
    return {
      ...commonInvocation(values),
      loadModels: false,
      async operation(engine) {
        const overview = await engine.overview(filter);
        return values.json ? toJson(overview) : renderOverview(overview);
      },
    };
  });
}
