import { errorMessage } from "../errors.ts";
import { type Embedder, EmbedderUnavailableError } from "../models/embedder.ts";
import type { SidecarPlan } from "./plan.ts";

const MAX_TEXTS_PER_BATCH = 64;

export type PlanEmbedding =
  | { plan: SidecarPlan; vectors: Float32Array[] }
  | { plan: SidecarPlan; error: string };

type BatchOutcome =
  | { ok: true; embeddings: PlanEmbedding[] }
  | { ok: false; error: string };

/** Batches span documents; a failed batch is retried per document, except when the model itself is unavailable, which is rethrown. */
export async function* embedPlans(
  plans: readonly SidecarPlan[],
  embedder: Pick<Embedder, "embedDocuments">,
): AsyncGenerator<PlanEmbedding> {
  const needsEmbedding: SidecarPlan[] = [];
  for (const plan of plans) {
    if (plan.pending.length === 0) {
      yield { plan, vectors: [] };
    } else {
      needsEmbedding.push(plan);
    }
  }

  for (const batch of toBatches(needsEmbedding)) {
    const outcome = await embedBatch(batch, embedder);
    if (outcome.ok) {
      yield* outcome.embeddings;
      continue;
    }
    for (const plan of batch) {
      if (batch.length === 1) {
        yield { plan, error: outcome.error };
        continue;
      }
      const retry = await embedBatch([plan], embedder);
      yield* retry.ok ? retry.embeddings : [{ plan, error: retry.error }];
    }
  }
}

function toBatches(plans: readonly SidecarPlan[]): SidecarPlan[][] {
  const batches: SidecarPlan[][] = [];
  let current: SidecarPlan[] = [];
  let texts = 0;
  for (const plan of plans) {
    current.push(plan);
    texts += plan.pending.length;
    if (texts >= MAX_TEXTS_PER_BATCH) {
      batches.push(current);
      current = [];
      texts = 0;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function embedBatch(
  batch: readonly SidecarPlan[],
  embedder: Pick<Embedder, "embedDocuments">,
): Promise<BatchOutcome> {
  const texts = batch.flatMap((plan) =>
    plan.pending.map((chunk) => chunk.text),
  );
  let vectors: Float32Array[];
  try {
    vectors = await embedder.embedDocuments(texts);
  } catch (cause) {
    if (cause instanceof EmbedderUnavailableError) throw cause;
    return { ok: false, error: errorMessage(cause) };
  }
  if (vectors.length !== texts.length) {
    return {
      ok: false,
      error: `the embedder returned ${vectors.length} vectors for ${texts.length} chunks`,
    };
  }

  let offset = 0;
  const embeddings = batch.map((plan): PlanEmbedding => {
    const own = vectors.slice(offset, offset + plan.pending.length);
    offset += plan.pending.length;
    return { plan, vectors: own };
  });
  return { ok: true, embeddings };
}
