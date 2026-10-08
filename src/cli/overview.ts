import { filterSchema } from "../engine/index.ts";
import {
  FILTER_HELP,
  FILTER_OPTIONS,
  filterFromFlags,
} from "./filter-flags.ts";
import { checkAgainstSchema } from "./flag-values.ts";
import { parseFlags } from "./parse-flags.ts";
import { SHOW_HELP } from "./preflight.ts";
import { renderOverview } from "./render/render-overview.ts";
import { type CliResult, toJson } from "./result.ts";
import {
  COMMON_HELP,
  COMMON_OPTIONS,
  commonInvocation,
  defaultQueryDeps,
  type QueryDeps,
  runQuery,
} from "./run-query.ts";

export const OVERVIEW_HELP = `Usage: md-rag overview --source-dir <dir> [options]

Counts the documents and chunks, then lists every source, tag and declared
signal with its document count, all within the filter. Run it first to learn
the real values to filter by.

Options:
${COMMON_HELP}
${FILTER_HELP}`;

export function runOverview(
  argv: readonly string[],
  deps: QueryDeps = defaultQueryDeps,
): Promise<CliResult> {
  return runQuery(
    { command: "overview", help: OVERVIEW_HELP, argv },
    deps,
    () => {
      const { values } = parseFlags(
        argv,
        { ...COMMON_OPTIONS, ...FILTER_OPTIONS },
        false,
      );
      if (values.help) return SHOW_HELP;
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
    },
  );
}
