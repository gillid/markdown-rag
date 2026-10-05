import type {
  IndexedChunk,
  IndexedDocument,
} from "../index/knowledge-index.ts";
import type { ResultScores } from "./types.ts";

export interface ScoredHit {
  path: string;
  ordinal: number;
  /** Higher is better. */
  final: number;
  /** False for a chunk the reranker couldn't score, which ranks after every scored one. */
  reranked: boolean;
  scores: ResultScores;
}

/** Best first: reranked hits before unreranked ones, then by final score. */
export function byRank(a: ScoredHit, b: ScoredHit): number {
  return Number(b.reranked) - Number(a.reranked) || b.final - a.final;
}

export interface MergedResult {
  path: string;
  /** The best hit of the group, whose scores the result keeps. */
  best: ScoredHit;
  /** First and last ordinal covered, expansion included. */
  from: number;
  to: number;
}

/** Hits whose expanded ranges overlap or touch become one result; with `expand` 0 that is exactly consecutive chunks. Best first. */
export function mergeAndExpand(
  hits: readonly ScoredHit[],
  documents: ReadonlyMap<string, IndexedDocument>,
  expand: number,
): MergedResult[] {
  const byPath = new Map<string, ScoredHit[]>();
  for (const hit of hits) {
    const group = byPath.get(hit.path) ?? [];
    group.push(hit);
    byPath.set(hit.path, group);
  }

  const merged: MergedResult[] = [];
  for (const [path, group] of byPath) {
    const last = (documents.get(path)?.chunks.length ?? 0) - 1;
    let current: MergedResult | undefined;
    for (const hit of [...group].sort((a, b) => a.ordinal - b.ordinal)) {
      const from = Math.max(0, hit.ordinal - expand);
      const to = Math.min(last, hit.ordinal + expand);
      if (current !== undefined && from <= current.to + 1) {
        current.to = Math.max(current.to, to);
        if (byRank(hit, current.best) < 0) current.best = hit;
      } else {
        current = { path, best: hit, from, to };
        merged.push(current);
      }
    }
  }
  return merged.sort((a, b) => byRank(a.best, b.best));
}

/** Chunks tile the body without overlap, so joining them restores the covered text (ADR-011). */
export function joinChunks(chunks: readonly IndexedChunk[]): string {
  return chunks.map((chunk) => chunk.text).join("");
}
