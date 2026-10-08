import { parseFlags } from "./parse-flags.ts";
import { SHOW_HELP } from "./preflight.ts";
import { renderGet } from "./render/render-get.ts";
import { type CliResult, toJson } from "./result.ts";
import {
  COMMON_HELP,
  COMMON_OPTIONS,
  commonInvocation,
  defaultQueryDeps,
  onlyPositional,
  type QueryDeps,
  runQuery,
} from "./run-query.ts";

export const GET_HELP = `Usage: md-rag get <ref> --source-dir <dir> [options]

Prints one document: its summary, its outline (headings with their anchors)
and its body. <ref> is a document path, or <path>#<anchor> for one section;
every ref printed by \`search\` and \`list\` works. It takes no filter.

Options:
  --no-body           Print only the summary and the outline
${COMMON_HELP}`;

export function runGet(
  argv: readonly string[],
  deps: QueryDeps = defaultQueryDeps,
): Promise<CliResult> {
  return runQuery({ command: "get", help: GET_HELP, argv }, deps, () => {
    const { values, positionals } = parseFlags(
      argv,
      { ...COMMON_OPTIONS, "no-body": { type: "boolean" } },
      true,
    );
    if (values.help) return SHOW_HELP;
    const ref = onlyPositional("ref", positionals);
    return {
      ...commonInvocation(values),
      loadModels: false,
      async operation(engine) {
        const document = await engine.getDocument(ref, {
          body: !values["no-body"],
        });
        return values.json ? toJson(document) : renderGet(document);
      },
    };
  });
}
