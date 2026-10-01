import { z } from "zod";
import type { SidecarChunk } from "./chunk.ts";
import { decodeVector, encodeVector } from "./vector-codec.ts";

export const SIDECAR_FORMAT = 1;

export interface Sidecar {
  docHash: string;
  chunker: string;
  model: string;
  dims: number;
  chunks: SidecarChunk[];
}

export class SidecarError extends Error {
  override readonly name = "SidecarError";
}

const offset = z.number().int().min(0);
const sha256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "must be a lower-case sha256 hex digest");

const chunkSchema = z
  .strictObject({
    start: offset,
    end: offset,
    breadcrumb: z.string(),
    anchor: z.string(),
    hash: sha256,
    vector: z.string(),
  })
  .refine((chunk) => chunk.end > chunk.start, {
    message: "end must be after start",
  });

const fileSchema = z.strictObject({
  format: z.literal(SIDECAR_FORMAT, {
    error: `unsupported sidecar format (expected ${SIDECAR_FORMAT}); regenerate it with md-rag embed`,
  }),
  doc_hash: sha256,
  chunker: z.string().min(1),
  model: z.string().min(1),
  dims: z.number().int().positive(),
  chunks: z.array(chunkSchema).superRefine((chunks, ctx) => {
    chunks.forEach((chunk, i) => {
      const previous = chunks[i - 1];
      if (previous && chunk.start < previous.end) {
        ctx.addIssue({
          code: "custom",
          message: "chunks must be in order and must not overlap",
          path: [i],
        });
      }
    });
  }),
});

function validate(raw: unknown): z.output<typeof fileSchema> {
  const result = fileSchema.safeParse(raw);
  if (!result.success) {
    throw new SidecarError(
      `invalid sidecar:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

function inChunk<T>(start: number, action: () => T): T {
  try {
    return action();
  } catch (error) {
    throw new SidecarError(`chunk at ${start}: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

/** Key order is fixed and there are no timestamps, so unchanged input gives a byte-identical file (ADR-005). */
export function serializeSidecar(sidecar: Sidecar): string {
  const file = validate({
    format: SIDECAR_FORMAT,
    doc_hash: sidecar.docHash,
    chunker: sidecar.chunker,
    model: sidecar.model,
    dims: sidecar.dims,
    chunks: sidecar.chunks.map((chunk) => {
      return {
        start: chunk.start,
        end: chunk.end,
        breadcrumb: chunk.breadcrumb,
        anchor: chunk.anchor,
        hash: chunk.hash,
        vector: inChunk(chunk.start, () =>
          encodeVector(chunk.vector, sidecar.dims),
        ),
      };
    }),
  });
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function parseSidecar(json: string): Sidecar {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new SidecarError(`invalid JSON: ${(error as Error).message}`);
  }

  const file = validate(raw);

  return {
    docHash: file.doc_hash,
    chunker: file.chunker,
    model: file.model,
    dims: file.dims,
    chunks: file.chunks.map((chunk) => ({
      start: chunk.start,
      end: chunk.end,
      breadcrumb: chunk.breadcrumb,
      anchor: chunk.anchor,
      hash: chunk.hash,
      vector: inChunk(chunk.start, () => decodeVector(chunk.vector, file.dims)),
    })),
  };
}
