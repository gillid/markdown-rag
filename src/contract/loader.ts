import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { Root } from "mdast";
import { z } from "zod";
import type { Config } from "../config/config.ts";
import { errorMessage } from "../errors.ts";
import { type DocumentMetadata, parseFrontmatterMetadata } from "./document.ts";
import { hashDocument, normalizeLineEndings } from "./hash.ts";
import { parseDocument } from "./tree.ts";

const MAX_FILE_SIZE_BYTES = 1024 * 1024;

export interface Document extends DocumentMetadata {
  path: string;
  docHash: string;
  tree: Root;
  body: string;
}

export interface DocumentLoadError {
  path: string;
  reason: string;
}

export interface KnowledgeBase {
  documents: Document[];
  errors: DocumentLoadError[];
}

/**
 * Walks `config.sourceDir` for `**\/*.md`, skipping dot-directories
 * (including the default `.md-rag/`, ADR-031) and `config.targetDir` when
 * it lies inside `sourceDir` under another name (ADR-037). Errors are
 * collected per file rather than thrown, so one bad document doesn't stop
 * the rest loading.
 */
export async function loadKnowledgeBase(
  config: Config,
): Promise<KnowledgeBase> {
  const { sourceDir, targetDir } = config;
  const files = await findMarkdownFiles(sourceDir, targetDir);

  const results = await Promise.all(
    files.map((file) => loadDocumentResult(file, sourceDir)),
  );

  const documents: Document[] = [];
  const errors: DocumentLoadError[] = [];
  for (const result of results) {
    if (result.ok) {
      documents.push(result.document);
    } else {
      errors.push({ path: result.path, reason: result.reason });
    }
  }

  return { documents, errors };
}

type LoadResult =
  | { ok: true; document: Document }
  | { ok: false; path: string; reason: string };

async function loadDocumentResult(
  file: string,
  sourceDir: string,
): Promise<LoadResult> {
  const path = toPosixPath(relative(sourceDir, file));
  try {
    return { ok: true, document: await loadDocument(file, path) };
  } catch (cause) {
    return { ok: false, path, reason: describeError(cause) };
  }
}

async function loadDocument(file: string, path: string): Promise<Document> {
  const info = await stat(file);
  if (info.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`exceeds the ${MAX_FILE_SIZE_BYTES}-byte size limit`);
  }

  const raw = await readFile(file, "utf8");
  const normalized = normalizeLineEndings(raw);
  const docHash = hashDocument(normalized);
  const { frontmatter, body, tree } = parseDocument(normalized);
  const metadata = parseFrontmatterMetadata(frontmatter);

  return { path, docHash, tree, body, ...metadata };
}

function describeError(cause: unknown): string {
  if (cause instanceof z.ZodError) {
    return z.prettifyError(cause);
  }
  return errorMessage(cause);
}

async function findMarkdownFiles(
  sourceDir: string,
  targetDir: string,
): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        if (full === targetDir) continue;
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(full);
      }
    }
  }

  await walk(sourceDir);
  return out.sort();
}

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}
