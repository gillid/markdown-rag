import type { PreTrainedTokenizer } from "@huggingface/transformers";
import { EmbedderError } from "./embedder.ts";
import type { ModelPreset } from "./presets.ts";

const EXCERPT_CHARS = 40;

export type TextKind = "chunk" | "query";

/** transformers.js truncates silently, so a text past the window is rejected here instead: its tail would never be searchable by meaning. */
export function assertFitsWindow(
  tokenizer: PreTrainedTokenizer,
  texts: readonly string[],
  preset: ModelPreset,
  kind: TextKind,
): void {
  for (const text of texts) {
    const { input_ids } = tokenizer(text, { truncation: false });
    const tokens = input_ids.dims.at(-1);
    if (tokens === undefined) {
      throw new EmbedderError(`${preset.id} tokenized a text to no tokens.`);
    }
    if (tokens > preset.maxTokens) {
      const message = describeOverflow(kind, text, tokens, preset);
      // A long query is the caller's input error, like a blank one; a long chunk is a failure of the document.
      throw kind === "query"
        ? new RangeError(message)
        : new EmbedderError(message);
    }
  }
}

function describeOverflow(
  kind: TextKind,
  text: string,
  tokens: number,
  preset: ModelPreset,
): string {
  const window = `${preset.maxTokens}-token window of ${preset.id}`;
  if (kind === "query") {
    return `The query is ${tokens} tokens, over the ${window} (its instruction prefix included); shorten it.`;
  }
  const excerpt = JSON.stringify(text.slice(0, EXCERPT_CHARS));
  return `A chunk of ${tokens} tokens (starting ${excerpt}) exceeds the ${window}. The chunker never splits code blocks or tables, so shorten or split that part of the document.`;
}
