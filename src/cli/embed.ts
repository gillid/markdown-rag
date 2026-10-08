import { createStructuralChunker } from "../chunking/structural-chunker.ts";
import type { Config } from "../config/config.ts";
import { formatPathErrors } from "../contract/format-errors.ts";
import {
  type DocumentLoadError,
  loadKnowledgeBase,
} from "../contract/loader.ts";
import { errorMessage } from "../errors.ts";
import type { Embedder } from "../models/embedder.ts";
import { createTransformersEmbedder } from "../models/transformers-embedder.ts";
import { type EmbedReport, embedKnowledgeBase } from "../sidecars/embed.ts";
import { loadConfigOutcome } from "./load-config.ts";
import { parseFlags } from "./parse-flags.ts";
import { preflight, SHOW_HELP } from "./preflight.ts";
import type { CliResult } from "./result.ts";

export const EMBED_HELP = `Usage: md-rag embed --source-dir <dir> [options]

Chunks and embeds every document whose sidecar is missing or stale, and
deletes sidecars whose document is gone. Fails on documents that break the
contract; every other document is still written.

Options:
  --source-dir <dir>  The knowledge base to embed (required)
  --target-dir <dir>  The engine folder (default: <source-dir>/.md-rag/)
  --models-dir <dir>  The model cache (default: <target-dir>/models/)
  --offline           Never download models; fail if they are not cached
  --rechunk           Re-chunk every document, even those that are up to date
  -h, --help          Show this help message
`;

export interface EmbedDeps {
  createEmbedder(config: Config): Embedder;
}

const defaultDeps: EmbedDeps = { createEmbedder: createTransformersEmbedder };

export async function runEmbed(
  argv: readonly string[],
  deps: EmbedDeps = defaultDeps,
): Promise<CliResult> {
  const opening = preflight({ command: "embed", help: EMBED_HELP }, () => {
    const { values } = parseFlags(
      argv,
      {
        "source-dir": { type: "string" },
        "target-dir": { type: "string" },
        "models-dir": { type: "string" },
        offline: { type: "boolean" },
        rechunk: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
      false,
    );
    if (values.help) return SHOW_HELP;
    return {
      sourceDir: values["source-dir"],
      targetDir: values["target-dir"],
      modelsDir: values["models-dir"],
      offline: values.offline === true,
      rechunk: values.rechunk === true,
    };
  });
  if (!opening.ok) return opening.result;
  const { sourceDir, targetDir, modelsDir, offline, rechunk } = opening.values;

  const configOutcome = loadConfigOutcome({
    sourceDir,
    targetDir,
    modelsDir,
    allowRemoteModels: offline ? false : undefined,
  });
  if (!configOutcome.ok) {
    return configOutcome.result;
  }
  const { config } = configOutcome;

  try {
    const knowledgeBase = await loadKnowledgeBase(config);
    const report = await embedKnowledgeBase({
      targetDir: config.targetDir,
      knowledgeBase,
      embedder: deps.createEmbedder(config),
      chunker: createStructuralChunker(),
      rechunk,
    });
    return renderResult(report, knowledgeBase.errors);
  } catch (cause) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `embed: ${errorMessage(cause)}\n`,
    };
  }
}

function renderResult(
  report: EmbedReport,
  contractErrors: readonly DocumentLoadError[],
): CliResult {
  const stdout =
    `${report.written} document(s) written (${report.chunksEmbedded} chunk(s) embedded, ${report.chunksReused} reused), ` +
    `${report.upToDate} up to date, ${report.pruned} sidecar(s) pruned.\n`;

  const problems = [
    ...contractErrors.map((error) => ({
      path: error.path,
      reason: `contract: ${error.reason}`,
    })),
    ...report.failures,
  ];
  const sections: string[] = [];
  if (report.modelError !== undefined) {
    sections.push(
      `embed: ${report.modelError}
${report.skipped} document(s) were not embedded.`,
    );
  }
  if (problems.length > 0) {
    sections.push(
      `${formatPathErrors(problems)}\n\n${problems.length} document(s) failed.`,
    );
  }
  for (const warning of report.warnings) {
    sections.push(`warning: ${warning}`);
  }

  const failed = report.modelError !== undefined || problems.length > 0;
  return {
    exitCode: failed ? 1 : 0,
    stdout,
    stderr: sections.length > 0 ? `${sections.join("\n\n")}\n` : "",
  };
}
