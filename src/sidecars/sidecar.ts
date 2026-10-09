import { z } from "zod";
import { errorMessage } from "../errors.ts";
import type { SidecarChunk } from "./chunk.ts";
import {
  decodeVector,
  encodedVectorLength,
  encodeVector,
} from "./vector-codec.ts";

export const SIDECAR_FORMAT = 1;

export interface Sidecar {
  docHash: string;
  chunker: string;
  model: string;
  dims: number;
  chunks: SidecarChunk[];
}

export type SidecarHeader = Pick<
  Sidecar,
  "docHash" | "chunker" | "model" | "dims"
>;

export class SidecarError extends Error {
  override readonly name: string = "SidecarError";
}

/** The file could not be read, as opposed to its contents being invalid. */
export class SidecarReadError extends SidecarError {
  override readonly name = "SidecarReadError";
}

/** The file was read but its contents are not a valid sidecar. */
export class SidecarContentError extends SidecarError {
  override readonly name = "SidecarContentError";
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
    error: `unsupported sidecar format (expected ${SIDECAR_FORMAT}); regenerate it with markdown-rag embed`,
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
    throw new SidecarError(`chunk at ${start}: ${errorMessage(error)}`, {
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

function parseJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch (error) {
    throw new SidecarError(`invalid JSON: ${errorMessage(error)}`);
  }
}

export interface OpenedSidecar {
  header: SidecarHeader;
  /** Decodes the vectors, the expensive part, without parsing the file again. */
  load(): Sidecar;
}

/** Validates the structure and the vector sizes but defers decoding the vectors. */
export function openSidecarJson(json: string): OpenedSidecar {
  const file = validate(parseJson(json));
  const expectedLength = encodedVectorLength(file.dims);
  for (const chunk of file.chunks) {
    if (chunk.vector.length !== expectedLength) {
      throw new SidecarError(
        `chunk at ${chunk.start}: vector is not ${file.dims} dims of float16`,
      );
    }
  }
  return {
    header: {
      docHash: file.doc_hash,
      chunker: file.chunker,
      model: file.model,
      dims: file.dims,
    },
    load: () => toSidecar(file),
  };
}

export function parseSidecar(json: string): Sidecar {
  return toSidecar(validate(parseJson(json)));
}

function toSidecar(file: z.output<typeof fileSchema>): Sidecar {
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
