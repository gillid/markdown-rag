# Contract

This is for people who produce the Markdown (exporters) and people who deploy the engine (integrators). The README covers installing and using it; this page covers what the engine requires of the files it reads, the files it writes, and how to run it in a pipeline.

Two sets of files meet here. The **documents** are Markdown that you produce and commit. The **sidecars** are generated from them by `markdown-rag embed` and never committed. The sidecars are the contract between the write path (`embed`) and the read path (`serve` and the query commands).

## Documents

### Which files are read

The engine reads every file whose name ends in `.md` beneath the source directory. It skips any directory whose name starts with a dot (including the default engine folder `.markdown-rag/`) and the target directory if it sits inside the source directory under another name. A file larger than 1 MB (1,048,576 bytes) is rejected. Only regular files and real directories are followed: symlinks and files named `.MD` are skipped silently, and `check` does not report them.

A document's identity is its path relative to the source directory, written with `/` as the separator on every platform. Moving or renaming a file makes it a different document.

### Frontmatter

Every document starts with a YAML frontmatter block between `---` lines, then the Markdown body:

```markdown
---
title: "Rollback a Bad Deploy"
updated_at: "2026-07-15"
tags: [runbook, process]
owner: platform-team
---

Run `orbitctl deploy rollback --service=<name>` to revert to the previous release.
```

| Key | Type | Rule |
| --- | --- | --- |
| `title` | string | Required, not empty. |
| `updated_at` | string | Required. An ISO 8601 calendar date (`2026-07-15`, read as midnight UTC) or a date-time with an explicit zone (`2026-07-15T10:00:00Z`, `2026-07-15 10:00:00+02:00`). A date-time without a zone is rejected, so the instant never depends on the host's timezone. |
| `tags` | list of strings | Required, and may be empty. The filterable vocabulary (see below). |
| any other key | any YAML value | Kept as pass-through `meta`. The engine does not interpret it. |

A document with no frontmatter, invalid YAML, or a missing or wrong-typed required key fails the contract. `markdown-rag check` reports every such document by path, and `markdown-rag embed` skips it, reports it and exits non-zero while still writing the sidecars of the other documents. The server and the query commands are stricter: one document that fails the contract stops them all from starting, even when every sidecar is fresh.

### Normalisation

Before a document is hashed and parsed, a leading byte order mark is dropped and `\r\n` becomes `\n`. The same text on Windows and Linux therefore hashes the same. Chunk offsets are measured in UTF-16 code units into the body, which is the text after the frontmatter block.

### What an exporter must guarantee

- **Byte-identical output for unchanged content.** A document is re-read and re-chunked whenever its hash changes, and only its chunks that are new get embedded, since an unchanged chunk reuses its vector. An export that rewrites a file with a new timestamp, a reordered key or a different line ending still changes the hash, so it costs that work and a new sidecar for a document that did not change. Put no export timestamps in the files, and write keys and tags in a stable order.
- **`updated_at` is the source's change time.** Use when the underlying content last changed (the page's last edit, the message's last reply), not when the export ran. Recency ranking and the `--since` and `updated_after` filters read it, and an export-time value would make every document look new.
- **Tags are the filterable vocabulary.** Agents learn the tags from `overview` and filter by them exactly, so use a small, consistent set and the same spelling every time (`runbook`, not `Runbook` in one file and `runbooks` in another). Tag ranking weights name tags exactly as well (see [weights.md](weights.md)).
- **One document per path, stable paths.** Derive the path from the source's identity, not from its title, so that a retitled page is an edit and not a delete plus an add.
- **No engine-owned files.** Never write into the engine folder (below); an exporter writes only Markdown.

## The engine folder

Everything the engine generates lives in one folder, the **target directory**: `<source-dir>/.markdown-rag/` by default, or the directory given with `--target-dir`. It has this layout:

```text
.markdown-rag/
  .gitignore            written by the engine; contains "*"
  vectors/
    runbooks/
      rollback-a-bad-deploy.md.vec.json
  models/               the model cache, unless --models-dir points elsewhere
```

- Every file in the folder is generated. Never add a hand-edited file, and never commit it: the `.gitignore` inside ignores the folder and itself.
- The engine writes nowhere else in a knowledge base. With a `--target-dir` outside the source directory, the source directory is not written to at all.
- A document's sidecar is `vectors/<document path>.vec.json`, so `runbooks/rollback-a-bad-deploy.md` has `vectors/runbooks/rollback-a-bad-deploy.md.vec.json`.
- `embed` writes each sidecar through a temporary file and a rename, so a reader never sees a partial file. It removes the temporary files an interrupted run left behind and deletes the sidecars of documents that no longer exist.

## Sidecar format

A sidecar is a JSON file, two-space indented, with a trailing newline:

```json
{
  "format": 1,
  "doc_hash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "chunker": "structural@1;target=1000;max=2000",
  "model": "bge-small-en-v1.5-q8",
  "dims": 384,
  "chunks": [
    {
      "start": 0,
      "end": 412,
      "breadcrumb": "Rollback a Bad Deploy",
      "anchor": "",
      "hash": "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
      "vector": "..."
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `format` | The sidecar format version. Currently `1`; any other value is rejected. |
| `doc_hash` | The lower-case SHA-256 hex digest of the normalised document text, frontmatter included. |
| `chunker` | The ID of the chunker that produced the chunks. It encodes the algorithm version and its size settings. |
| `model` | The ID of the embedding model that produced the vectors. |
| `dims` | The length of each vector. |
| `chunks` | In document order, without overlap. |

Each chunk has:

| Field | Meaning |
| --- | --- |
| `start`, `end` | Offsets in UTF-16 code units into the normalised body. `end` is after `start`. |
| `breadcrumb` | The heading path of the chunk. |
| `anchor` | The anchor of the section the chunk belongs to, which `get` accepts after `#` in a `ref`. Empty when there is none. |
| `hash` | The SHA-256 hex digest of `breadcrumb`, a newline and the chunk's text. Identical chunks reuse their vector when a document is edited. |
| `vector` | The embedding as little-endian float16 values, base64-encoded. It has exactly `dims` values. |

Key order is fixed and nothing in the file depends on time, so the same document, chunker and model always produce the same bytes. Unknown keys are rejected.

### When a sidecar is fresh

A sidecar is fresh if and only if all of these hold:

1. Its `doc_hash` equals the hash of its document.
2. Its `chunker` is the chunker ID that every other sidecar records.
3. Its `model` and `dims` are the embedding model that every other sidecar records, and that is a model the engine has a preset for.
4. Its vectors decode (canonical base64, finite float16 values).
5. Its chunks match the document: every chunk's hash equals the hash of the text at its offsets, and no text is left outside the chunks apart from whitespace.

The engine never patches over a stale sidecar at query time. `serve` and the query commands refuse to start if any document fails the contract, if any document has a missing, stale, invalid or orphaned sidecar, or if the sidecars disagree about the model or chunker, and tell you to run `markdown-rag embed`. `markdown-rag check` reports the same problems without starting anything.

The query models come from the sidecars: the engine loads the embedding model its sidecars record. If they record a model the installed version has no preset for, the engine refuses to start and tells you to run `markdown-rag embed`, which re-embeds with the engine's own model.

## Running in a deployment pipeline

The sidecars are generated, so the pipeline generates them before it serves. The steps are:

1. Check out the repository.
2. Restore the engine folder from the pipeline's cache, if it has one.
3. Run `markdown-rag embed --source-dir <dir>`.
4. Run `markdown-rag check --source-dir <dir>`, which is optional because `serve` verifies the same things.
5. Save the engine folder back to the cache.
6. Start `markdown-rag serve --source-dir <dir>`.

For example, with GitHub Actions. The sidecars and the model weights are cached separately, so a changed document does not store another copy of the weights. The sidecars are saved even when `embed` fails, so the documents that did embed are kept, and `<version>` is a released version of `markdown-rag` that you pin so `embed` and `serve` agree:

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with:
    node-version: 24
- uses: actions/cache@v4
  with:
    path: docs/.markdown-rag/models
    key: markdown-rag-models-bge-small-en-v1.5-ms-marco-minilm-l6-v2
- uses: actions/cache/restore@v4
  with:
    path: docs/.markdown-rag/vectors
    key: markdown-rag-vectors-${{ hashFiles('docs/**/*.md') }}
    restore-keys: markdown-rag-vectors-
- run: npx markdown-rag@<version> embed --source-dir docs
- uses: actions/cache/save@v4
  if: always()
  with:
    path: docs/.markdown-rag/vectors
    key: markdown-rag-vectors-${{ hashFiles('docs/**/*.md') }}
- run: npx markdown-rag@<version> check --source-dir docs
```

The models key names the model presets, not the package version, so a release that keeps the models keeps the cache. Change it when a release changes them.

Things to know:

- **The cache is an optimisation, never a requirement.** Without it `embed` processes every document. With it, `embed` processes only the documents whose sidecar is missing or stale (its `doc_hash`, chunker or model differs) and reuses the vector of every chunk it has already embedded. A cache is safe to restore from any earlier run, because freshness is decided by the sidecars' contents, not by the cache key. `restore-keys` above lets a run start from the previous cache and rewrite only what changed.
- **`embed` exits non-zero** if any document fails the contract or the model cannot be loaded. After a contract failure the documents that pass are still written and orphaned sidecars are pruned. After a model failure the run stops: documents not yet embedded are skipped and nothing is pruned. A failed step skips the rest of the job and its cache save, which is why the example saves with `if: always()`.
- **Models download on first use** into the model cache, which defaults to `<target-dir>/models/`. With network access blocked, pre-fetch the weights into the cache directory and pass `--offline` to `embed`, `search` and `serve`, the commands that load models; see [configuration.md](configuration.md#the-model-cache).
- **Use one engine folder per knowledge base.** Two knowledge bases sharing a target directory make each other's sidecars orphans.
- **Use the same version of `markdown-rag` to embed and to serve.** The engine does not check this: sidecars from an older chunker are served as they are, and only a recorded model the installed version does not know is refused at startup. Pin the version, as above.
