# Configuration

Configuration arrives only through command-line flags or the object passed to `createEngine`. There are no environment variables of the engine's own and no config file. Defaults for the ranking options are not listed here because they may be tuned between releases; `markdown-rag <command> --help` prints the current ones.

## Storage and models

| Flag | `createEngine` option | Meaning |
| --- | --- | --- |
| `--source-dir <dir>` | `sourceDir` | The knowledge base: the directory searched for `.md` files. Required. |
| `--target-dir <dir>` | `targetDir` | The engine folder that holds the generated files. Defaults to `<source-dir>/.markdown-rag/`. It may not be the source directory or one of its parents. |
| `--models-dir <dir>` | `modelsDir` | The model cache. Defaults to `<target-dir>/models/`. Inside the source directory it is only allowed within the engine folder. |
| `--offline` | `allowRemoteModels: false` | Never download models; fail if they are not cached. Remote downloads are allowed by default. |
| `--rechunk` (`embed` only) | | Re-chunk every document, even those that are up to date. |

`createEngine(input, options)` also takes `options.loadModels` (default `true`). With `false` the engine skips loading the models, so `search` fails but `overview`, `listDocuments` and `getDocument` work without the model cost.

## Query commands

`search`, `list`, `get` and `overview` share a filter, and `search` and `serve` share the ranking options. The library takes the same settings as plain objects.

| Flag | Library | Meaning |
| --- | --- | --- |
| `--tag <tag>` (repeatable) | `filter.tags` | Only documents that have all of these tags. |
| `--tag-any <tag>` (repeatable) | `filter.tags_any` | Only documents that have at least one of these tags. |
| `--dir <path>` | `filter.dir` | Only documents beneath this directory of the knowledge base. |
| `--since <date>` | `filter.updated_after` | Only documents updated on or after an ISO 8601 date or date-time. The library takes epoch milliseconds, exclusive. |
| `--mode <mode>` | `mode` (request) and `retrieval.mode` (default) | `hybrid`, `keyword` or `semantic`. |
| `--limit <n>` | `limit` and `retrieval.limit` | Results to return, 1 to 10. For `list`, documents per page, 1 to 500. |
| `--min-score <x>` | `min_score` and `retrieval.minScore` | Drop results whose relevance is below `x`. |
| `--expand <n>` | `expand` and `retrieval.expand` | Neighbouring chunks added on each side of a hit, 0 to 2. |
| `--weight <name=x>` (repeatable) | `weights` and `retrieval.weights` | `recency=x`, or `tag:<tag>=x` to boost (positive) or penalise (negative) documents with that tag. See [weights.md](weights.md). |
| `--sort <order>` (`list`) | `sort` | `path` or `updated_at` (newest first). |
| `--offset <n>` (`list`) | `offset` | Documents to skip. |
| `--no-body` (`get`) | `getDocument(ref, { body: false })` | Print only the summary and the outline. |
| `--json` | | Print JSON; a failure is a JSON error on stderr. |

The library also takes `retrieval.candidates`, `retrieval.halfLifeDays`, `retrieval.hybridWeights` and `retrieval.rerank`, which have no flag.

## Server

| Flag | Meaning |
| --- | --- |
| `--port <n>` | Port to listen on (default 3000; 0 picks a free one). |
| `--host <address>` | Address to bind (default `127.0.0.1`). A container needs `0.0.0.0`. |
| `--weight <name=x>` | Default ranking weight, which a request can override. |

## The model cache

- The engine git-ignores its own folder, models included. A custom `--models-dir` outside the engine folder gets a `.gitignore` of its own only when it has none, so if you point it at a directory that already has one, check that it keeps the weights out of Git.
- If a model fails to load because of a corrupted download, delete `modelsDir` and run `embed` again.
- `@huggingface/transformers` reads `HF_TOKEN` and `HF_ACCESS_TOKEN` from the environment when it downloads. A stale token can make the download of the public model fail; unset it.
- `@huggingface/transformers` looks for a model in `/models/<repository>` before the cache, so a directory mounted there would shadow the pinned weights.
- For hosts without network access, copy a populated `modelsDir` onto the host and pass `--offline`.
