import type { SearchResponse, SearchResult } from "../../engine/index.ts";
import { formatDate, formatScore } from "./format.ts";

export const NO_RESULTS_MESSAGE = "No relevant context found.";

// Quoted so a heading inside a chunk can't be mistaken for the start of the next result.
function quote(text: string): string {
  // Only blank lines are dropped from the start: the first line's indentation is part of the text.
  return text
    .replace(/^(?:[ \t]*\n)+/, "")
    .trimEnd()
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
}

function renderResult(result: SearchResult): string {
  const facts = [
    `updated: ${formatDate(result.updated_at)}`,
    `ref: ${result.ref}`,
    `score: ${formatScore(result.scores.final)}`,
  ];
  return `## ${result.breadcrumb}\n\n${facts.join(" · ")}\n\n${quote(result.text)}\n`;
}

export function renderSearch(response: SearchResponse): string {
  const footer = `index_version: ${response.index_version}\n`;
  if (response.results.length === 0) {
    return `${NO_RESULTS_MESSAGE}\n\n${footer}`;
  }
  return `${response.results.map(renderResult).join("\n")}\n${footer}`;
}
