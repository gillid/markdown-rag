import { z } from "zod";
import { updatedAtSchema } from "./updated-at.ts";

const RESERVED_SIGNAL_NAME = "recency";

const signalNameSchema = z
  .string()
  .min(1, "must not be empty")
  .refine((name) => name === name.toLowerCase(), {
    message: "must be lower-case",
  })
  .refine((name) => name !== RESERVED_SIGNAL_NAME, {
    message: `"${RESERVED_SIGNAL_NAME}" is reserved for the built-in recency signal`,
  });

const signalsSchema = z.record(signalNameSchema, z.number().min(0).max(1));

const frontmatterSchema = z.object({
  title: z.string().min(1, "must not be empty"),
  source: z.string().min(1, "must not be empty"),
  updated_at: updatedAtSchema,
  url: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  signals: signalsSchema.optional(),
});

const KNOWN_FRONTMATTER_KEYS = new Set(Object.keys(frontmatterSchema.shape));

export interface DocumentMetadata {
  title: string;
  source: string;
  updatedAt: number;
  url?: string;
  tags: string[];
  signals: Record<string, number>;
  meta: Record<string, unknown>;
}

/** Validates raw YAML frontmatter and separates known fields from pass-through `meta` (ADR-003, ADR-023, ADR-034). */
export function parseFrontmatterMetadata(raw: unknown): DocumentMetadata {
  const meta: Record<string, unknown> = {};
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (!KNOWN_FRONTMATTER_KEYS.has(key)) {
        meta[key] = value;
      }
    }
  }

  const parsed = frontmatterSchema.parse(raw);

  return {
    title: parsed.title,
    source: parsed.source,
    updatedAt: parsed.updated_at,
    url: parsed.url,
    tags: parsed.tags ?? [],
    signals: parsed.signals ?? {},
    meta,
  };
}
