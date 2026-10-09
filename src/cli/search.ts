import { searchRequestSchema } from "../engine/index.ts";
import { SEARCH_MODES } from "../index/search-mode.ts";
import { MAX_EXPAND, MAX_LIMIT } from "../retrieval/types.ts";
import {
  FILTER_HELP,
  FILTER_OPTIONS,
  filterFromFlags,
} from "./filter-flags.ts";
import {
  checkAgainstSchema,
  optionalInteger,
  optionalNumber,
  parseEnumFlag,
  parseNamedNumbers,
} from "./flag-values.ts";
import { renderSearch } from "./render/render-search.ts";
import { type CliResult, toJson } from "./result.ts";
import {
  COMMON_HELP,
  commonInvocation,
  defaultQueryDeps,
  onlyPositional,
  type QueryDeps,
  runQuery,
} from "./run-query.ts";

export const SEARCH_HELP = `Usage: md-rag search "<query>" --source-dir <dir> [options]

Ranked, cited search. Each result prints a heading from its breadcrumb, one
line with its updated date, ref and final score, then the
snippet. Pass a result's ref to \`get\` to read more of the document. Put \`--\`
before a query that starts with a dash: md-rag search --source-dir docs -- "-v flag".

Options:
  --mode <mode>       hybrid (default), keyword (identifiers, error codes) or semantic
  --limit <n>         Results to return (default from the engine, maximum ${MAX_LIMIT})
  --min-score <x>     Drop results whose relevance is below x; write a negative
                      value with an equals sign: --min-score=-0.5
  --expand <n>        Neighbouring chunks to add on each side of a hit (maximum ${MAX_EXPAND})
  --weight <name=x>   Ranking weight, repeatable: recency=x, or tag:<tag>=x to boost
                      (x > 0) or penalise (x < 0) documents with that tag
  --models-dir <dir>  The model cache (default: <target-dir>/models/)
  --offline           Never download models; fail if they are not cached
${COMMON_HELP}
${FILTER_HELP}`;

export function runSearch(
  argv: readonly string[],
  deps: QueryDeps = defaultQueryDeps,
): Promise<CliResult> {
  const query = {
    command: "search",
    help: SEARCH_HELP,
    argv,
    options: {
      ...FILTER_OPTIONS,
      mode: { type: "string" },
      limit: { type: "string" },
      "min-score": { type: "string" },
      expand: { type: "string" },
      weight: { type: "string", multiple: true },
      "models-dir": { type: "string" },
      offline: { type: "boolean" },
    },
    allowPositionals: true,
  } as const;
  return runQuery(query, deps, ({ values, positionals }) => {
    const request = {
      query: onlyPositional("query", positionals),
      filter: filterFromFlags(values),
      mode: parseEnumFlag("mode", SEARCH_MODES, values.mode),
      limit: optionalInteger("limit", values.limit),
      min_score: optionalNumber("min-score", values["min-score"]),
      expand: optionalInteger("expand", values.expand),
      weights:
        values.weight === undefined
          ? undefined
          : parseNamedNumbers("weight", values.weight),
    };
    checkAgainstSchema(searchRequestSchema, request);
    return {
      ...commonInvocation(values),
      modelsDir: values["models-dir"],
      offline: values.offline,
      loadModels: true,
      async operation(engine) {
        const response = await engine.search(request);
        return values.json ? toJson(response) : renderSearch(response);
      },
    };
  });
}
