import type { DocumentList } from "../../engine/index.ts";
import { formatDate } from "./format.ts";

export function renderList(list: DocumentList): string {
  const { offset } = list;
  const lines = list.documents.map((document) => {
    const tags =
      document.tags.length === 0 ? "" : ` · ${document.tags.join(", ")}`;
    return `- ${document.ref} · ${document.title} · ${formatDate(document.updated_at)}${tags}`;
  });
  const shown =
    list.documents.length === 0
      ? `Showing none of ${list.total} document(s).`
      : `Showing ${offset + 1}–${offset + list.documents.length} of ${list.total} document(s).`;
  return [
    ...(lines.length === 0 ? [] : [...lines, ""]),
    shown,
    "",
    `index_version: ${list.index_version}`,
    "",
  ].join("\n");
}
