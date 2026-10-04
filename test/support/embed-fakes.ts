import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Chunker } from "../../src/chunking/chunker.ts";
import type { Embedder } from "../../src/models/embedder.ts";

export interface CountingEmbedder extends Embedder {
  /** Every text passed to `embedDocuments`, in call order. */
  readonly embeddedTexts: string[];
  /** The size of each `embedDocuments` call. */
  readonly batchSizes: number[];
}

/** Fails any call whose texts include `failOn`, like a model choking on one document. */
export function createCountingEmbedder(
  options: { modelId?: string; failOn?: string } = {},
): CountingEmbedder {
  const embeddedTexts: string[] = [];
  const batchSizes: number[] = [];
  return {
    modelId: options.modelId ?? "fake-model",
    dims: 4,
    embeddedTexts,
    batchSizes,
    async embedDocuments(texts) {
      batchSizes.push(texts.length);
      if (
        options.failOn !== undefined &&
        texts.some((text) => text.includes(options.failOn as string))
      ) {
        throw new Error(`cannot embed "${options.failOn}"`);
      }
      embeddedTexts.push(...texts);
      return texts.map((text) =>
        Float32Array.of(text.length / 100, 0.5, 0.25, 0.125),
      );
    },
    async embedQuery(text) {
      return Float32Array.of(text.length / 100, 0.5, 0.25, 0.125);
    },
  };
}

export interface CountingChunker extends Chunker {
  calls: number;
}

/** One chunk per blank-line-separated paragraph. */
export function createParagraphChunker(): CountingChunker {
  const chunker: CountingChunker = {
    id: "paragraphs@1",
    calls: 0,
    async chunk({ title, body }) {
      chunker.calls++;
      return [...body.matchAll(/\S[\s\S]*?(?=\n\n|$)/g)].map((match) => ({
        start: match.index,
        end: match.index + match[0].trimEnd().length,
        breadcrumb: title,
        anchor: "",
      }));
    },
  };
  return chunker;
}

export async function writeDoc(
  root: string,
  path: string,
  paragraphs: readonly string[],
  title = path,
): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    [
      "---",
      `title: "${title}"`,
      "source: docs",
      'updated_at: "2026-01-15"',
      "---",
      "",
      paragraphs.join("\n\n"),
      "",
    ].join("\n"),
    "utf8",
  );
}
