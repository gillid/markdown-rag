import type {
  IndexedChunk,
  IndexedDocument,
} from "../index/knowledge-index.ts";
import {
  type CandidateQuery,
  searchCandidates,
} from "../index/search-candidates.ts";
import type { SearchMode } from "../index/search-mode.ts";
import { capPerDocument } from "./candidates.ts";
import { RetrievalOptionError } from "./errors.ts";
import { joinChunks, mergeAndExpand, type ScoredHit } from "./merge.ts";
import { mergeWeights, resolveDefaults, validateOptions } from "./options.ts";
import {
  blend,
  declaredSignals,
  normaliseScores,
  recencyScore,
  sigmoid,
  signalValues,
  validateWeights,
} from "./signals.ts";
import {
  MAX_CHUNKS_PER_DOCUMENT,
  type RetrievalDefaults,
  type RetrievalResponse,
  type RetrievalResult,
  type RetrieveRequest,
  type RetrieverDeps,
} from "./types.ts";
import { hasNoVisibleText } from "./visible-text.ts";

/** The text a chunk is scored on; the breadcrumb says where in the document it sits. */
function passageOf(chunk: IndexedChunk): string {
  return `${chunk.breadcrumb}\n${chunk.text}`;
}

/** Binds an index and its models; `retrieve` runs the whole read path for one request (ADR-012, ADR-013, ADR-027, ADR-034). */
export function createRetriever(deps: RetrieverDeps) {
  const { index, embedder, reranker } = deps;
  const defaults = resolveDefaults(deps.defaults, index.documents.values());
  const now = deps.now ?? Date.now;
  const declared = declaredSignals(index.documents.values());
  if (defaults.rerank && reranker === undefined) {
    throw new TypeError("a reranker is required while rerank is on");
  }
  // Same-size vectors from another model would be accepted and rank nonsense (ADR-032).
  if (index.model !== undefined && index.model.modelId !== embedder.modelId) {
    throw new Error(
      `the index was built with ${index.model.modelId} but the embedder is ${embedder.modelId}`,
    );
  }

  function documentOf(path: string): IndexedDocument {
    const document = index.documents.get(path);
    if (document === undefined) {
      throw new Error(`the search index returned unknown document ${path}`);
    }
    return document;
  }

  function chunkOf(path: string, ordinal: number): IndexedChunk {
    const chunk = documentOf(path).chunks[ordinal];
    if (chunk === undefined) throw new Error(`${path} has no chunk ${ordinal}`);
    return chunk;
  }

  return async function retrieve(
    request: RetrieveRequest,
  ): Promise<RetrievalResponse> {
    const started = performance.now();
    const mode = request.mode ?? defaults.mode;
    const limit = request.limit ?? defaults.limit;
    const expand = request.expand ?? defaults.expand;
    const minScore = request.minScore ?? defaults.minScore;
    const weights = mergeWeights(defaults.weights, request.weights);
    if (hasNoVisibleText(request.query)) {
      throw new RetrievalOptionError("the query must not be blank");
    }
    validateOptions({ mode, limit, expand, minScore });
    validateWeights(weights, declared);

    const vector =
      mode === "keyword" ? undefined : await embedder.embedQuery(request.query);
    const embedded = performance.now();

    const candidates = await searchCandidates(
      index,
      candidateQuery(mode, request, vector, defaults),
    );
    const capped = capPerDocument(candidates, MAX_CHUNKS_PER_DOCUMENT);
    const searched = performance.now();

    const { relevance, logits } = await score(request.query, capped);
    const reranked = performance.now();

    const clock = now();
    const scored: ScoredHit[] = capped.map((candidate, i) => {
      const { summary } = documentOf(candidate.path);
      const recency = recencyScore(
        summary.updatedAt,
        clock,
        defaults.halfLifeDays,
      );
      const signals = signalValues(summary, weights, recency);
      const rerank = logits[i] ?? null;
      const relevanceScore = relevance[i] ?? 0;
      const final = blend(relevanceScore, weights, signals);
      return {
        path: candidate.path,
        ordinal: candidate.ordinal,
        reranked: rerank !== null,
        final,
        scores: {
          retrieval: candidate.score,
          rerank,
          relevance: relevanceScore,
          signals,
          final,
        },
      };
    });

    // The cutoff is on relevance: signals reorder relevant chunks and must never carry an irrelevant one over it (ADR-034, ADR-036).
    const kept = scored.filter((hit) => hit.scores.relevance >= minScore);

    // `limit` counts results, so it applies after neighbouring hits have merged.
    const results = mergeAndExpand(kept, index.documents, expand)
      .slice(0, limit)
      .map(({ path, best, from, to }): RetrievalResult => {
        const chunk = chunkOf(path, best.ordinal);
        const document = documentOf(path);
        return {
          summary: document.summary,
          // A chunk before the first heading has no anchor, so it is cited by the document alone.
          ref: chunk.anchor === "" ? path : `${path}#${chunk.anchor}`,
          breadcrumb: chunk.breadcrumb,
          anchor: chunk.anchor,
          text: joinChunks(document.chunks.slice(from, to + 1)),
          chunks: { from, to },
          scores: best.scores,
        };
      });

    const finished = performance.now();
    return {
      results,
      timings: {
        embedMs: embedded - started,
        searchMs: searched - embedded,
        rerankMs: reranked - searched,
        totalMs: finished - started,
      },
    };
  };

  /** Relevance per candidate, plus the raw logit where one exists. */
  async function score(
    query: string,
    capped: readonly { path: string; ordinal: number; score: number }[],
  ): Promise<{ relevance: number[]; logits: (number | null)[] }> {
    if (!defaults.rerank || reranker === undefined) {
      return {
        relevance: normaliseScores(capped.map((c) => c.score)),
        logits: capped.map(() => null),
      };
    }
    // `rerank` throws on a blank passage, and a chunk with no text of its own would only be scored on its breadcrumb.
    const scorable = capped.flatMap(({ path, ordinal }, position) => {
      const chunk = chunkOf(path, ordinal);
      return hasNoVisibleText(chunk.text)
        ? []
        : [{ position, passage: passageOf(chunk) }];
    });
    const rawLogits =
      scorable.length === 0
        ? []
        : await reranker.rerank(
            query,
            scorable.map(({ passage }) => passage),
          );
    if (rawLogits.length !== scorable.length) {
      throw new Error(
        `the reranker returned ${rawLogits.length} scores for ${scorable.length} passages`,
      );
    }
    const logits: (number | null)[] = capped.map(() => null);
    scorable.forEach(({ position }, i) => {
      logits[position] = rawLogits[i] ?? null;
    });
    return {
      relevance: logits.map((logit) => (logit === null ? 0 : sigmoid(logit))),
      logits,
    };
  }
}

function candidateQuery(
  mode: SearchMode,
  request: RetrieveRequest,
  vector: Float32Array | undefined,
  defaults: RetrievalDefaults,
): CandidateQuery {
  const base = { k: defaults.candidates, filter: request.filter };
  if (mode === "keyword") return { ...base, mode, text: request.query };
  if (vector === undefined) throw new Error("the query was not embedded");
  if (mode === "semantic") return { ...base, mode, vector };
  return {
    ...base,
    mode,
    text: request.query,
    vector,
    hybridWeights: defaults.hybridWeights,
  };
}
