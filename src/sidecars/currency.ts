import type { Embedder } from "../models/embedder.ts";
import type { SidecarHeader } from "./sidecar.ts";

// The one definition of "fresh" shared by `embed` and `check` (ADR-006).
export function matchesDocument(
  header: SidecarHeader,
  docHash: string,
): boolean {
  return header.docHash === docHash;
}

export function matchesModel(
  header: SidecarHeader,
  model: Pick<Embedder, "modelId" | "dims">,
): boolean {
  return header.model === model.modelId && header.dims === model.dims;
}
