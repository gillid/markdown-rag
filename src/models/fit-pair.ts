import type { PreTrainedTokenizer } from "@huggingface/transformers";

type PairTokenizer = Pick<PreTrainedTokenizer, "encode" | "decode">;

// [CLS] query [SEP] passage [SEP]
const PAIR_SPECIAL_TOKENS = 3;
const MAX_QUERY_TOKENS = 128;

// The tokenizer's own truncation slices the whole pair, dropping the closing [SEP] and letting a long query cut the passage away.
export function fitPair(
  tokenizer: PairTokenizer,
  query: string,
  passages: readonly string[],
  maxTokens: number,
): { query: string; passages: string[] } {
  const fittedQuery = truncateText(tokenizer, query, MAX_QUERY_TOKENS);
  const budget =
    maxTokens - PAIR_SPECIAL_TOKENS - countTokens(tokenizer, fittedQuery);
  return {
    query: fittedQuery,
    passages: passages.map((passage) =>
      truncateText(tokenizer, passage, budget),
    ),
  };
}

function countTokens(tokenizer: PairTokenizer, text: string): number {
  return tokenizer.encode(text, { add_special_tokens: false }).length;
}

function truncateText(
  tokenizer: PairTokenizer,
  text: string,
  maxTokens: number,
): string {
  // A token spans at least one character, so short text can't exceed the budget.
  if (text.length <= maxTokens) {
    return text;
  }
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
