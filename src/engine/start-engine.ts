import { type Config, type ConfigInput, loadConfig } from "../config/config.ts";
import { type Filter, filterSchema } from "../index/filter.ts";
import type { KnowledgeIndex } from "../index/knowledge-index.ts";
import type { Embedder } from "../models/embedder.ts";
import type { Reranker } from "../models/reranker.ts";
import { indexedTags } from "../retrieval/indexed-tags.ts";
import { resolveDefaults } from "../retrieval/options.ts";
import { createRetriever } from "../retrieval/retrieve.ts";
import { validateWeights } from "../retrieval/signals.ts";
import type { RetrievalDefaults } from "../retrieval/types.ts";
import type { EngineOptions } from "./engine-options.ts";
import { ModelsNotLoadedError, parseRequest } from "./errors.ts";
import { getDocumentOf } from "./get-document.ts";
import { listDocumentsOf } from "./list-documents.ts";
import { loadIndex } from "./load-index.ts";
import { overviewOf } from "./overview.ts";
import { ENGINE_VERSION } from "./package-version.ts";
import { embedderFor, rerankerFor, warmUp } from "./query-models.ts";
import {
  type DocumentOutput,
  documentRefSchema,
  type GetDocumentOptions,
  getDocumentOptionsSchema,
} from "./schemas/document.ts";
import {
  type DocumentList,
  type ListRequest,
  listRequestSchema,
} from "./schemas/list.ts";
import type { OverviewOutput } from "./schemas/overview.ts";
import {
  type SearchRequest,
  type SearchResponse,
  searchRequestSchema,
} from "./schemas/search.ts";
import { searchOf } from "./search.ts";

export interface Engine {
  /** The engine's own version, not the index's (`index_version` is on every response). */
  readonly version: string;
  overview(filter?: Filter): Promise<OverviewOutput>;
  search(request: SearchRequest): Promise<SearchResponse>;
  listDocuments(request?: ListRequest): Promise<DocumentList>;
  getDocument(
    ref: string,
    options?: GetDocumentOptions,
  ): Promise<DocumentOutput>;
}

/** The public options plus how tests replace the models and the clock. */
export interface StartOptions extends EngineOptions {
  embedder?: Embedder;
  reranker?: Reranker;
  /** Epoch milliseconds, for recency. */
  now?: () => number;
}

/** Not exported from the package: the models and the clock are the engine's own, and tests replace them here (ADR-040). */
export async function startEngine(
  input: ConfigInput,
  options: StartOptions = {},
): Promise<Engine> {
  const config = loadConfig(input);
  // Copied now: the caller may reuse or change its options object while startup is still running.
  const { loadModels = true, ...injected } = options;

  const index = await loadIndex(config);
  // Checked even without models, so `loadModels: false` never hides a setting that `search` would reject.
  const defaults = resolveDefaults(config.retrieval);
  validateWeights(defaults.weights, indexedTags(index));
  const retrieve = loadModels
    ? await startRetriever(config, index, defaults, injected)
    : undefined;

  return {
    version: ENGINE_VERSION,
    async overview(filter) {
      const parsed = parseRequest(filterSchema.optional(), filter, "overview");
      return overviewOf(index, parsed ?? {});
    },
    async search(request) {
      const parsed = parseRequest(searchRequestSchema, request, "search");
      if (retrieve === undefined) {
        throw new ModelsNotLoadedError(
          "search needs the query models, but the engine was created with loadModels: false",
        );
      }
      return searchOf(index, retrieve, parsed);
    },
    async listDocuments(request = {}) {
      const parsed = parseRequest(listRequestSchema, request, "list");
      return listDocumentsOf(index, parsed);
    },
    async getDocument(ref, options = {}) {
      const parsedRef = parseRequest(documentRefSchema, ref, "get");
      const parsed = parseRequest(getDocumentOptionsSchema, options, "get");
      return getDocumentOf(index, parsedRef, parsed);
    },
  };
}

async function startRetriever(
  config: Config,
  index: KnowledgeIndex,
  defaults: RetrievalDefaults,
  supplied: Pick<StartOptions, "embedder" | "reranker" | "now">,
) {
  const embedder = supplied.embedder ?? embedderFor(config, index);
  const reranker = supplied.reranker ?? rerankerFor(config, defaults.rerank);
  const retrieve = createRetriever({
    index,
    embedder,
    reranker,
    defaults,
    now: supplied.now,
  });
  // Refuse to start on a model that can't be loaded, rather than failing the first query.
  await warmUp(embedder, reranker);
  return retrieve;
}
