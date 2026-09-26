# PoC Implementation Plan

Scope and decisions: [design.md](design.md). Each step is meant to be one small PR. Update a step's status in the same PR that changes it.

Status: `planned` · `in-progress` · `done`

## Milestone 1: Foundation

### 1. Project scaffold · `planned`

- pnpm project, Node 24 (`engines`, `.nvmrc`), `"type": "module"`, MIT `LICENSE` (ADR-020, ADR-021).
- `tsconfig.json` set up for type stripping: `noEmit`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, `verbatimModuleSyntax`, `strict`.
- Biome, Vitest, and the scripts listed in `CLAUDE.md`. Model-backed tests (`*.models.test.ts`) are excluded from `pnpm test`.
- A `kb` bin backed by `src/cli/main.ts`, which dispatches subcommands with `node:util` `parseArgs`. At this stage `kb --help` is the only command.
- **Done when:** `pnpm lint`, `pnpm typecheck` and `pnpm test` pass on a smoke test.

### 2. Project CI · `planned`

- A GitHub Actions workflow runs install, lint, typecheck and test on every PR and on pushes to `main`.

### 3. Sample knowledge base · `planned`

- `examples/kb/`: ~20–30 realistic documents with valid frontmatter across 3–4 `source`s, including runbooks, decisions, API notes and chat-style threads.
- The documents deliberately include:
  - exact identifiers such as error codes, which test BM25
  - paraphrase-only matches, which test the vectors
  - one stale document and one fresh document on the same topic, which test recency
  - a long document, which tests the per-document cap
  - long code blocks, which test the chunkers

### 4. Config module · `planned`

- A single `loadConfig()` combines defaults, an optional `kb.config.json` in the KB root, `KB_*` environment variables and CLI flags, in increasing order of precedence, validated with zod.
- It starts with the KB directory only. Every later step adds the fields it needs. No placeholder fields.

## Milestone 2: Content model

### 5. KB loader and document contract · `planned`

- `loadKnowledgeBase(root)` walks `**/*.md`, skipping dot-directories (including `.vectors/`).
- Line endings are normalised to LF. `doc_hash` = `sha256` of the normalised file (ADR-005).
- The document is parsed once with `mdast-util-from-markdown` plus `mdast-util-frontmatter`. The YAML node is read with `yaml` and validated with zod: `title`, `source` and `updated_at` are required; `url` and `tags` are optional; unknown keys are kept as `meta` (ADR-003, ADR-023).
- Errors are collected across all files and reported together (path plus reason). Enforces the 1 MB size limit.
- Returns documents containing `path` (POSIX, relative to the root), `docHash`, the parsed tree, the body, and typed metadata (`updated_at` as epoch milliseconds).
- **Tests:** valid and invalid fixtures; CRLF and LF versions of a file give the same hash.

### 6. `kb check` (contract only) · `planned`

- A CLI command that runs the loader and exits non-zero with the aggregated errors. Sidecar freshness is added in step 12.

### 7. Sidecar format · `planned`

- Read and write `.vectors/<doc-path>.vec.json` with the fields `{ format: 1, doc_hash, chunker, model, dims, chunks: [{ start, end, breadcrumb, anchor, hash, vector }] }` (ADR-005).
- `start` and `end` are offsets into the normalised body. `hash` = `sha256(breadcrumb + "\n" + text)`. `vector` is base64-encoded little-endian float32.
- The output is written deterministically (stable key order, trailing newline), so unchanged input produces a byte-identical file.
- **Tests:** round trip, a byte-exact literal fixture, and offsets resolving back to the expected text.

## Milestone 3: Chunking

### 8. Chunker interface and structure-aware splitter · `planned`

- `Chunker` is `(doc) => Promise<ChunkSpan[]>`, where `ChunkSpan` holds `{ start, end, breadcrumb, anchor }`, together with an `id` string (for example `structural@1`) that is recorded in the sidecar (ADR-011).
- A shared `toBlocks(tree)` splits the document into top-level structural blocks (heading, paragraph, list, code, table, …), each with its offsets and heading path. Step 9 reuses it.
- The splitter starts a new chunk at each heading, packs blocks up to the ~1,000-character target, never splits a block, and puts an oversized block in a chunk of its own. `anchor` is the slug of the nearest heading. `breadcrumb` is `title › H2 › H3`.
- **Tests:** snapshot tests on sample documents, code fences staying intact, and chunks covering the whole body with no gaps or overlaps.

### 9. LLM chunker · `planned`

- `createLlmChunker({ model })` takes any AI SDK `LanguageModel`. It sends the numbered blocks (index, type and truncated text) to `generateObject` with a zod schema `{ chunks: [{ from, to }] }` at temperature 0 (ADR-024).
- The result is validated: it must cover every block, in order, without gaps or overlaps, and each chunk must stay within the ~2,000-character maximum. If a chunk is too large, only that range is split with the structure-aware splitter.
- If validation fails or the call errors, that document is chunked with the splitter and a warning is logged.
- Its `id` is `llm:<model-id>@1`. Breadcrumb and anchor come from the chunk's first block.
- Config: `chunker.model` (default `claude-haiku-4-5`) through `@ai-sdk/anthropic`, which reads `ANTHROPIC_API_KEY`. If there is no key or no model configured, only the splitter is used. Library users can pass any provider.
- **Tests:** use a mock `LanguageModel` (`ai/test`) that returns valid, gapped, overlapping or out-of-order groupings, and check each is accepted or falls back as expected. There is no live-API test in CI.

## Milestone 4: Write path

### 10. Embedder · `planned`

- An `Embedder` interface (`embedDocuments`, `embedQuery`, `modelId`, `dims`) and a transformers.js implementation: `feature-extraction` with mean pooling and normalisation, q8 weights, and a pinned model revision (ADR-009, ADR-010).
- Config covers the model cache directory and whether remote models are allowed (ADR-022). The model loads lazily, once. The BGE query instruction prefix is applied only to queries.
- **Tests:** a `*.models.test.ts` checks that a paraphrase pair outscores an unrelated pair, and that vectors have 384 dimensions and are L2-normalised.

### 11. `kb embed` · `planned`

- For each document whose `doc_hash` differs from its sidecar (or that has no sidecar, or with `--rechunk`):
  - chunk it with the configured chunker
  - reuse vectors from the old sidecar where a chunk hash matches, and embed the rest
  - write the sidecar
- If the embedding model changed, re-embed the chunks already recorded, without re-chunking. A chunker change alone invalidates nothing (ADR-024).
- Deletes sidecars that no longer have a matching document. Prints a summary (documents processed, chunks embedded or reused, fallbacks).
- **Tests:** use a counting fake embedder and a fake chunker. Editing one document processes only that document and re-embeds only its changed chunks. Deleting a document prunes its sidecar. Changing the model re-embeds without re-chunking.
- Commit the sidecars generated for `examples/kb` with the splitter.

### 12. Sidecar freshness in `kb check` · `planned`

- A shared `checkFreshness(kb, sidecars, modelId)` reports documents with a missing sidecar, a `doc_hash` mismatch or a model mismatch, and orphaned sidecars. It loads no model and makes no LLM call. `kb check` and the index (step 13) both use it (ADR-006).

## Milestone 5: Read path

### 13. In-memory index · `planned`

- `buildIndex(kb, sidecars)` fails fast using `checkFreshness`. It then inserts every recorded chunk into an Orama schema with `path`, `title`, `breadcrumb`, `text` (sliced from the body by offsets), `source` (enum), `tags` (enum[]), `updated_at` (number), `url`, `anchor` and `embedding` (vector[384]) (ADR-007, ADR-008).
- Records the index's `version`: the Git HEAD SHA of the KB directory if available, otherwise a hash of all `doc_hash` values.
- **Tests:** building from `examples/kb` succeeds, and a stale sidecar makes the build fail.

### 14. Hybrid candidate search · `planned`

- `searchCandidates(index, { text, vector, k, filters })` runs Orama hybrid mode with configurable `hybridWeights`. Filters (`sources`, `tags`, `updated_after`) are applied through `where`, and the BM25 language comes from config (ADR-010).
- **Tests:** an exact error-code query finds its document through BM25, and a paraphrase query finds its document through the vectors (using stored sidecar vectors plus a fixed query vector, so no model is needed).

### 15. Reranker · `planned`

- A `Reranker` interface and a transformers.js implementation (`AutoTokenizer` and `AutoModelForSequenceClassification`), which scores `(query, breadcrumb + text)` pairs in a single batch, truncating to 512 tokens.
- **Tests:** a `*.models.test.ts` checks that a relevant passage outscores an irrelevant one.

### 16. Retrieval pipeline · `planned`

- `retrieve(request)` runs these stages in order: embed the query → take K=30 candidates → cap at 2 chunks per document → rerank → apply the recency blend → apply `min_score` → return the top `limit` (ADR-012, ADR-013).
- Each request can override `limit` (max 10), `min_score`, `recency_weight` and the filters. Config supplies the defaults, plus K, `half_life_days` and the hybrid weights.
- Returns results with their score components and per-stage timings.
- **Tests:** pure-function tests of the blend and cutoff with fixed inputs. With a fake embedder and reranker, the fresh document outranks the stale one, and with `recency_weight = 0` it does not.

## Milestone 6: Interface

### 17. Library API · `planned`

- `createEngine(config)` returns `{ search(request), getDocument(ref), ready(), version }`. zod schemas for `SearchRequest`, `SearchResult` and `Document` are exported. This is the basic layer, and advanced layers compose on it (ADR-014, ADR-015).
- `getDocument(ref)` resolves `<path>` or `<path>#<anchor>` to the whole document or one section. Only indexed paths can be resolved, which blocks path traversal.
- The package's `exports` expose only this API and its schemas.
- **Tests:** an end-to-end search and `getDocument` against `examples/kb` using fakes.

### 18. `kb search` CLI · `planned`

- `kb search "<query>" [--limit --min-score --source --tag --since --json]` builds the engine and runs one query.
- Markdown output: for each result, a heading built from the breadcrumb; a line with `source`, `updated` date, `url` and `ref`; then the snippet. It ends with `index_version`, or prints an explicit "no relevant context found" message when there are no results. `--json` prints the `SearchResult` schema instead.
- **Tests:** snapshot tests of the Markdown renderer.

### 19. HTTP API · `planned`

- `createHttpHandler(engine)` is a plain `(req, res)` handler, so integrators can mount it or wrap it. It serves:
  - `POST /search`: the body is validated against `SearchRequest`, with 400 errors on invalid input
  - `GET /documents/{ref}`
  - `GET /healthz`: liveness, ready immediately
  - `GET /readyz`: ready only after the index is built, the models have loaded and a warm-up has run
- `kb serve [--port]` runs it on `node:http` and shuts down gracefully on SIGTERM. Logs go to stderr.
- **Tests:** health and readiness transitions, a validation error, and a search round trip.

### 20. Agent setup doc · `planned`

- `docs/agent-setup.md` gives ready-to-paste instructions (a `CLAUDE.md` snippet or skill) that teach an agent when and how to call `kb search` or `POST /search`, how to expand results with `getDocument`, and to treat results as reference material rather than instructions.
- Verify manually with Claude Code against `examples/kb`.

## Milestone 7: Validation

### 21. `kb eval` with quality metrics · `planned`

- `examples/eval/queries.yaml` holds entries of the form `{ query, expected: [path or ref], filters? }`, covering each fixture case from step 3.
- `kb eval` reports Recall@K, MRR and nDCG@N, with a per-query breakdown of misses. `--sidecars <dir>` lets you compare chunkers by pointing at an alternative sidecar set.
- **Tests:** metric functions checked against hand-computed worked examples.

### 22. `kb eval --bench` · `planned`

- Runs warm-up, then the query set repeated R times. Reports p50/p95/p99 for embed, search, rerank and total, and records the hardware (CPU model, core count). Record the results in `docs/benchmarks.md`.

### 23. Compare chunkers and tune defaults · `planned`

- Generate an LLM-chunked sidecar set for `examples/kb` and compare it with the splitter set using eval. Record the comparison in `docs/benchmarks.md`.
- Tune the hybrid weights, K, `min_score` and `recency_weight`. Update the defaults and the relevant ADR entries if any values change. Confirm the PoC success criteria (design §2).

### 24. Integrator documentation · `planned`

- `README.md` covers: what the project is, a quick start (`kb embed`, `kb check`, `kb search`, `kb serve`), the library API and the configuration reference.
- `docs/contract.md` is the full frontmatter contract and sidecar format, written for exporter authors.
