import { z } from "zod";
import { updatedAtSchema } from "./updated-at.ts";

const frontmatterSchema = z.object({
  title: z.string().min(1, "must not be empty"),
  updated_at: updatedAtSchema,
  tags: z.array(z.string()),
});

const KNOWN_FRONTMATTER_KEYS = new Set(Object.keys(frontmatterSchema.shape));

export interface DocumentMetadata {
  title: string;
  updatedAt: number;
  tags: string[];
  meta: Record<string, unknown>;
}

/** Validates raw YAML frontmatter and separates known fields from pass-through `meta` (ADR-003, ADR-023). */
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
    updatedAt: parsed.updated_at,
    tags: parsed.tags,
    meta,
  };
}
