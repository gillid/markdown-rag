import type { PreTrainedTokenizer } from "@huggingface/transformers";

type PairTokenizer = Pick<PreTrainedTokenizer, "encode" | "decode">;

const MAX_QUERY_TOKENS = 128;
const specialTokenCounts = new WeakMap<PairTokenizer, number>();

export interface PairFitter {
  query: string;
  fitPassage(passage: string): string;
}

// The tokenizer's own truncation slices the whole pair, dropping the closing separator and letting a long query cut the passage away.
export function createPairFitter(
  tokenizer: PairTokenizer,
  query: string,
  maxTokens: number,
): PairFitter {
  // A query may take at most a quarter of a small window, so passages always keep room.
  const maxQueryTokens = Math.min(MAX_QUERY_TOKENS, Math.floor(maxTokens / 4));
  const fittedQuery = truncateText(tokenizer, query, maxQueryTokens);
  const budget =
    maxTokens -
    specialTokenCount(tokenizer) -
    countTokens(tokenizer, fittedQuery);
  if (budget <= 0) {
    throw new Error(
      `A ${maxTokens}-token window leaves no room for a passage after the query and special tokens.`,
    );
  }
  return {
    query: fittedQuery,
    fitPassage: (passage) => truncateText(tokenizer, passage, budget),
  };
}

// Differs per model family (BERT pairs take 3, XLM-R pairs 4); an empty text_pair counts as no pair, so probe with real text.
function specialTokenCount(tokenizer: PairTokenizer): number {
  let count = specialTokenCounts.get(tokenizer);
  if (count === undefined) {
    const probe = "a";
    const pair = tokenizer.encode(probe, {
      text_pair: probe,
      add_special_tokens: true,
    });
    count = pair.length - 2 * countTokens(tokenizer, probe);
    specialTokenCounts.set(tokenizer, count);
  }
  return count;
}

function countTokens(tokenizer: PairTokenizer, text: string): number {
  return tokenizer.encode(text, { add_special_tokens: false }).length;
}

function truncateText(
  tokenizer: PairTokenizer,
  text: string,
  maxTokens: number,
): string {
  const ids = tokenizer.encode(text, { add_special_tokens: false });
  if (ids.length <= maxTokens) {
    return text;
  }
  // Decoding can normalise text so that it re-encodes to more tokens than were kept.
  let keep = maxTokens;
  while (keep > 0) {
    const candidate = tokenizer.decode(ids.slice(0, keep), {
      skip_special_tokens: true,
    });
    const tokens = countTokens(tokenizer, candidate);
    if (tokens <= maxTokens) {
      return candidate;
    }
    keep = Math.min(keep - 1, Math.floor((keep * maxTokens) / tokens));
  }
  return "";
}
