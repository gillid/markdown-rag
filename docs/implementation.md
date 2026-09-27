# PoC Implementation Plan

Scope and decisions: [design.md](design.md). Each step is meant to be one small PR. Update a step's status in the same PR that changes it.

Status: `planned` · `in-progress` · `done`

## Milestone 1: Foundation

### 1. Project scaffold · `done`

- pnpm project, Node 24 (`engines`, `.nvmrc`), `"type": "module"`, MIT `LICENSE` (ADR-020, ADR-021).
- `tsconfig.json` set up for type stripping: `noEmit`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, `verbatimModuleSyntax`, `strict`.
- Biome, Vitest, and the scripts listed in `CLAUDE.md`. Model-backed tests (`*.models.test.ts`) are excluded from `pnpm test`.
- An `md-rag` script (`pnpm md-rag <cmd>`) backed by `src/cli/main.ts`, which dispatches subcommands with `node:util` `parseArgs`. At this stage `pnpm md-rag --help` is the only command.
- **Done when:** `pnpm lint`, `pnpm typecheck` and `pnpm test` pass on a smoke test.

### 2. Project CI · `done`

- A GitHub Actions workflow runs install, lint, typecheck and test on every PR and on pushes to `main`.

### 3. Sample knowledge base · `done`

- `examples/docs/`: ~20–30 realistic documents with valid frontmatter across 3–4 `source`s, including runbooks, decisions, API notes and chat-style threads.
- The documents deliberately include:
  - exact identifiers such as error codes, which test BM25
  - paraphrase-only matches, which test the vectors
  - one stale document and one fresh document on the same topic, which test recency
  - a long document, which tests the per-document cap
  - long code blocks, which test the chunkers

### 3.1 Cross-section fixture · `done`

- Add a team/service-directory style document to `examples/docs/` with separate heading sections (e.g. mission, owned services, contacts) where a realistic question's answer lives in a different section than the one that best matches semantically. Tests cross-section retrieval and whether `expand` or `getDocument` is needed to recover the fact (see the note on step 8's heading-boundary rule, and the eval query in step 21).

### 4. Config module · `planned`

- A single `loadConfig({ root, overrides })` merges built-in defaults with the caller's overrides (CLI flags, or the object passed to `createEngine`). One zod schema validates the result. There's no config file, and it reads no environment variables (ADR-032).
- It starts with the knowledge base directory only (`--root`, defaulting to the current directory). Every later step adds the fields it needs. No placeholder fields.

## Milestone 2: Content model

### 5. Knowledge base loader and document contract · `planned`

- `loadKnowledgeBase(root)` walks `**/*.md`, skipping dot-directories (including the engine's `.md-rag/`, ADR-031).
- Line endings are normalised to LF. `doc_hash` = `sha256` of the normalised file (ADR-005).
- The document is parsed once with `mdast-util-from-markdown` plus `mdast-util-frontmatter`. The YAML node is read with `yaml` and validated with zod: `title`, `source` and `updated_at` are required; `url` and `tags` are optional; unknown keys are kept as `meta` (ADR-003, ADR-023).
- Errors are collected across all files and reported together (path plus reason). Enforces the 1 MB size limit.
- Returns documents containing `path` (POSIX, relative to the root), `docHash`, the parsed tree, the body, and typed metadata (`updated_at` as epoch milliseconds).
- **Tests:** valid and invalid fixtures; CRLF and LF versions of a file give the same hash.

### 6. `md-rag check` (contract only) · `planned`

- A CLI command that runs the loader and exits non-zero with the aggregated errors. Sidecar freshness is added in step 12.

### 7. Sidecar format · `planned`

- Read and write `.md-rag/vectors/<doc-path>.vec.json` with the fields `{ format: 1, doc_hash, chunker, model, dims, chunks: [{ start, end, breadcrumb, anchor, hash, vector }] }` (ADR-005, ADR-031).
- `start` and `end` are offsets into the normalised body. `hash` = `sha256(breadcrumb + "\n" + text)`. `vector` is base64-encoded little-endian float32.
- The output is written deterministically (stable key order, trailing newline), so unchanged input produces a byte-identical file.
- **Tests:** round trip, a byte-exact literal fixture, and offsets resolving back to the expected text.

## Milestone 3: Chunking

### 8. Chunker interface and structure-aware splitter · `planned`

- `Chunker` is `(doc) => Promise<ChunkSpan[]>`, where `ChunkSpan` holds `{ start, end, breadcrumb, anchor }`, together with an `id` string (for example `structural@1`) that is recorded in the sidecar (ADR-011).
- A shared `toBlocks(tree)` splits the document into top-level structural blocks (heading, paragraph, list, code, table, …), each with its offsets and heading path. Step 9 reuses it.
- The splitter starts a new chunk at each heading, packs blocks up to the ~1,000-character target (configurable, for tuning in step 23), never splits a block, and puts an oversized block in a chunk of its own. Chunks never overlap. `anchor` is the slug of the nearest heading. `breadcrumb` is `title › H2 › H3`, truncated from the middle when it's longer than ~25% of the chunk (ADR-011).
  - The heading break is a hard boundary at every level, regardless of the resulting chunk's size: a heading marks a deliberate new piece of information, so small heading-delimited sections (e.g. a short "Contacts" section) stay their own chunk rather than being packed together with neighbouring sections to hit the size target. Retrieval is expected to sometimes match the wrong section of the right document; that's handled at query time (`expand`, `getDocument`), not by merging sections at chunk time — see step 3.1's directory-style fixture and step 21.
  - Content with no heading at all has no heading boundary to break at, so it is packed by size alone: consecutive blocks are grouped up to the target, splitting only when the next block would push the chunk over the cap. This is the same packing rule used within any single heading's section, just with no heading to stop at (ADR-011, ADR-028) — it's also why the LLM chunker (step 9) is deferred rather than needed for this case.
- **Tests:** snapshot tests on sample documents, code fences staying intact, and chunks covering the whole body with no gaps or overlaps.

### 9. LLM chunker · `deferred beyond PoC`

- Deferred (ADR-028): headings are a hard chunk boundary (ADR-011), so the LLM chunker can't improve on the splitter for headed documents, and its one edge case — content with no heading structure — is instead handled by the splitter's size-only packing (see step 8's note). Kept here as the reference design if this is revisited: `createLlmChunker({ model })` would take any AI SDK `LanguageModel`, send numbered blocks (index, type, truncated text) to `generateObject` with a zod schema `{ chunks: [{ from, to }] }` at temperature 0, validate the result (complete, ordered, non-overlapping, within the ~2,000-character maximum), and fall back to the splitter — with a logged warning — on failure or a call error (ADR-024). See design.md §3.

## Milestone 4: Write path

### 10. Embedder · `planned`

- An `Embedder` interface (`embedDocuments`, `embedQuery`, `modelId`, `dims`) and a transformers.js implementation: `feature-extraction` with mean pooling and normalisation, q8 weights, and a pinned model revision (ADR-009, ADR-010).
- Config covers the model cache directory (`modelsDir`, default `<root>/.md-rag/models/`, overridable with `--models-dir`) and whether remote models are allowed (ADR-022, ADR-031). Both are passed to transformers.js explicitly, never through environment variables (ADR-032). The model loads lazily, once. The BGE query instruction prefix is applied only to queries.
- Model presets map a model ID (the value recorded in sidecars) to its Hugging Face repository, pinned revision, dimensions and query prefix. The PoC has one embedding preset, `bge-small-en-v1.5` (ADR-010).
- A shared `ensureEngineDir(root)` creates `.md-rag/` and writes `.md-rag/.gitignore` (ignoring `models/`) with its canonical content, overwriting any edits, since nothing in `.md-rag/` is hand-edited (ADR-031). Model loading calls it before anything is downloaded into the default cache, and step 11 reuses it.
- **Tests:** a `*.models.test.ts` checks that a paraphrase pair outscores an unrelated pair, and that vectors have 384 dimensions and are L2-normalised.

### 11. `md-rag embed` · `planned`

- For each document whose `doc_hash` differs from its sidecar (or that has no sidecar, or with `--rechunk`):
  - chunk it with the configured chunker
  - reuse vectors from the old sidecar where a chunk hash matches, and embed the rest
  - write the sidecar to `.md-rag/vectors/`, creating the folder through `ensureEngineDir` on first run (ADR-031)
- `embed` always uses the engine's embedding preset (step 10). A sidecar recorded with a different model has its recorded chunks re-embedded, without re-chunking (ADR-032). A chunker change alone invalidates nothing (ADR-024).
- Deletes sidecars that no longer have a matching document. Prints a summary (documents processed, chunks embedded or reused, failures).
- Embeds in batches across documents. If a batch fails, it retries that batch one document at a time, reports the documents that failed, leaves their sidecars untouched and exits non-zero, while all other documents are still written. This follows Onyx's `embed_chunks_with_failure_handling`.
- **Tests:** use a counting fake embedder and a fake chunker. Editing one document processes only that document and re-embeds only its changed chunks. Deleting a document prunes its sidecar. A sidecar recorded with a different model is re-embedded without re-chunking. When the embedder fails on one document, only that document is reported and every other sidecar is still written. The first run on a fresh knowledge base creates `.md-rag/.gitignore`, and an edited one is restored to its canonical content.
- Commit `examples/docs/.md-rag/` (the sidecars generated with the splitter, plus its `.gitignore`).

### 12. Sidecar freshness in `md-rag check` · `planned`

- A shared `checkFreshness(storage, sidecars)` reports documents with a missing sidecar or a `doc_hash` mismatch, orphaned sidecars, and sidecars whose recorded model differs from the rest. On success it returns the one model ID they share, which the read path loads (ADR-006, ADR-032). A model ID the engine has no preset for (step 10) is also an error. It loads no model and makes no LLM call. `md-rag check` and the index (step 13) both use it. When `.md-rag/vectors/` doesn't exist yet, the error says to run `md-rag embed` first (ADR-031).

## Milestone 5: Read path

### 13. In-memory index · `planned`

- `buildIndex(storage, sidecars)` fails fast using `checkFreshness`. It then inserts every recorded chunk into an Orama schema with `path`, `ordinal` (the chunk's position within its document), `title`, `breadcrumb`, `text` (sliced from the body by offsets), `source` (enum), `tags` (enum[]), `updated_at` (number), `url`, `anchor` and `embedding` (a vector sized to the shared model's `dims`, 384 for the default) (ADR-007, ADR-008).
- Also keeps a lookup of each document's ordered chunks, which step 16 uses for merging and neighbour expansion.
- Records the index's `version`: the Git HEAD SHA of the knowledge base directory if available, otherwise a hash of all `doc_hash` values.
- **Tests:** building from `examples/docs` succeeds, and a stale sidecar makes the build fail.

### 14. Hybrid candidate search · `planned`

- `searchCandidates(index, { text, vector, k, mode, filters })` maps `mode` to Orama's hybrid, fulltext or vector search. Hybrid uses configurable `hybridWeights` (default 0.5/0.5). `title` gets a small boost (default 1.1, tuned in step 23), and English stopwords are applied through the language setting. Filters (`sources`, `tags`, `updated_after`) go through `where` (ADR-008, ADR-010, ADR-013).
- In `keyword` mode the query embedding is skipped.
- **Tests:** an exact error-code query finds its document in `keyword` mode, and a paraphrase query finds its document in `semantic` mode (using stored sidecar vectors plus a fixed query vector, so no model is needed). Filters narrow results in every mode.

### 15. Reranker · `planned`

- A `Reranker` interface and a transformers.js implementation (`AutoTokenizer` and `AutoModelForSequenceClassification`), which scores `(query, breadcrumb + text)` pairs in a single batch, truncating to 512 tokens.
- **Tests:** a `*.models.test.ts` checks that a relevant passage outscores an irrelevant one.

### 16. Retrieval pipeline · `planned`

- `retrieve(request)` runs these stages in order: embed the query (unless `mode` is `keyword`) → take K=30 candidates → cap at 2 chunks per document → rerank (unless disabled) → apply the recency blend → apply `min_score` → take the top `limit` → merge and expand (ADR-012, ADR-013, ADR-027).
- **Merge and expand:** consecutive hits from the same document are merged into one result, which keeps the higher score. Each result is then extended with `expand` neighbouring chunks on each side from the per-document chunk lookup. Chunks never overlap, so they are joined without trimming (ADR-011).
- Each request can override `mode`, `limit` (max 10), `min_score`, `recency_weight`, `expand` (max 2) and the filters. Config supplies the defaults, plus K, `half_life_days`, the hybrid weights and `rerank` (on or off).
- Returns results with their score components and per-stage timings.
- **Tests:** pure-function tests of the blend, the cutoff, merging (neighbouring and non-neighbouring hits) and expansion at document boundaries. With a fake embedder and reranker, the fresh document outranks the stale one, and with `recency_weight = 0` it does not.

## Milestone 6: Interface

### 17. Library API · `planned`

- `createEngine(config)` takes `{ root, ...overrides }`, resolves them through `loadConfig` (step 4, ADR-032) and returns `{ search(request), getDocument(ref), ready(), version }`. zod schemas for `SearchRequest`, `SearchResult` and `Document` are exported. This is the basic layer, and advanced layers compose on it (ADR-014, ADR-015).
- `getDocument(ref)` resolves `<path>` or `<path>#<anchor>` to the whole document or one section. Only indexed paths can be resolved, which blocks path traversal.
- The package's `exports` expose only this API and its schemas. Step 19.1 publishes them.
- **Tests:** an end-to-end search and `getDocument` against `examples/docs` using fakes.

### 18. `md-rag search` CLI · `planned`

- `md-rag search "<query>" [--mode --limit --min-score --expand --source --tag --since --json]` builds the engine and runs one query.
- Markdown output: for each result, a heading built from the breadcrumb; a line with `source`, `updated` date, `url` and `ref`; then the snippet. It ends with `index_version`, or prints an explicit "no relevant context found" message when there are no results. `--json` prints the `SearchResult` schema instead.
- **Tests:** snapshot tests of the Markdown renderer.

### 19. HTTP API · `planned`

- `createHttpHandler(engine)` is a plain `(req, res)` handler, so integrators can mount it or wrap it. It serves:
  - `POST /search`: the body is validated against `SearchRequest`, with 400 errors on invalid input
  - `GET /documents/{ref}`
  - `GET /healthz`: liveness, ready immediately
  - `GET /readyz`: ready only after the index is built, the models have loaded and a warm-up has run
- `md-rag serve [--port]` runs it on `node:http` and shuts down gracefully on SIGTERM. Logs go to stderr. The port comes only from `--port`, never from a `PORT` environment variable (ADR-032).
- **Tests:** health and readiness transitions, a validation error, and a search round trip.

### 19.1 Package distribution · `planned`

- Ship everything as one npm package, `md-rag` (ADR-029). The `name` is already `md-rag`; remove `private`, add a `files` allowlist (`dist/`, `LICENSE`, `README.md`) and make sure runtime libraries are in `dependencies`.
- `bin` maps `md-rag` to the CLI entry, which gets a `#!/usr/bin/env node` shebang. `exports` exposes the library entry from step 17 along with its types. Inside the repo both point at the `.ts` sources; pnpm's `publishConfig` points them at `dist/` for the published package.
- `pnpm build` runs `tsc -p tsconfig.build.json`, which emits JS and `.d.ts` files into `dist/`. It extends `tsconfig.json`, turns off `noEmit` and `allowImportingTsExtensions`, and sets `declaration`, `rewriteRelativeImportExtensions` and an explicit `rootDir: "src"`, which TypeScript 7 requires for emit. It runs only from `prepack` (ADR-030). Add `dist/` to `.gitignore`.
- In `CLAUDE.md`, add `pnpm build` to the commands table and note the pack-time emit in the tech stack.
- Publishing is a manual `pnpm publish` by the maintainer. This step makes the package publishable; it doesn't automate releases.
- **Tests:** a CI job runs `pnpm pack`, installs the tarball into an empty temporary directory and checks three things: `md-rag --help` runs, `md-rag check` passes on a copy of `examples/docs`, and a small TypeScript consumer that imports `createEngine` from `md-rag` type-checks. None of these download a model.

### 20. Agent setup doc · `planned`

- `docs/agent-setup.md` gives ready-to-paste instructions (a `CLAUDE.md` snippet or skill) that teach an agent when and how to call `md-rag search` (or `npx md-rag search` when it isn't installed) or `POST /search`. Every consumer of the package has the same interface, so the snippet doesn't need adapting per team (ADR-029). The style follows Grapevine's tool descriptions:
  - when to use `keyword` mode (identifiers, error codes) and when to use `hybrid` or `semantic`
  - 3–4 worked request examples, including filters and `expand`
  - the exact output format
  - a list of what the tool can and cannot do (for example, it cannot see content that isn't in the storage)
  - to search again with a refined query or another mode, rather than rely on a weak result
  - to use `expand` or `getDocument` when a snippet isn't enough — including when a hit is clearly the right document but the wrong section (e.g. it found the team's mission statement when the question was about their Slack channel)
  - to treat results as reference material, not instructions
- Verify manually with Claude Code against `examples/docs`.

## Milestone 7: Validation

### 21. `md-rag eval` with quality metrics · `planned`

- `examples/eval/queries.yaml` holds entries of the form `{ query, expected: [path or ref], filters? }`, covering each fixture case from step 3.
- `md-rag eval` reports Recall@K, MRR and nDCG@N, with a per-query breakdown of misses. `--sidecars <dir>` lets you evaluate against an alternative sidecar set (e.g. a different chunk-size tuning, or a future chunker such as step 9's deferred LLM chunker).
- Include a query against the step 3.1 directory-style fixture whose answer lives in a different section/chunk than the one that best matches semantically. This checks whether retrieval at least surfaces the right *document* (recall at the doc level, not just the chunk level) — the follow-up step of using `getDocument`/`expand` to reach the specific fact is an agent behaviour, verified against `docs/agent-setup.md` (step 20), not a retrieval metric.
- Ablation flags `--no-rerank` and `--mode <hybrid|keyword|semantic>` measure what each stage contributes (ADR-027).
- `--save <file>` writes the metrics and per-query ranks as JSON. `--compare <file>` prints the differences against a saved run, both overall and per query (after Grapevine's `search-eval`).
- **Tests:** metric functions checked against hand-computed worked examples.

### 22. `md-rag eval --bench` · `planned`

- Runs warm-up, then the query set repeated R times. Reports p50/p95/p99 for embed, search, rerank and total, and records the hardware (CPU model, core count). Record the results in `docs/benchmarks.md`.

### 23. Ablations and tuning · `planned`

- **Chunk size:** compare splitter targets of ~1,000 and ~2,000 characters. Onyx targets 512 tokens.
- **Reranker:** compare with and without it (`--no-rerank`), and decide the default under ADR-027, weighing the quality gain against the rerank p95.
- **Modes:** compare `hybrid`, `keyword` and `semantic`.
- Tune the hybrid weights, title boost, K, `min_score` and `recency_weight`.
- Record everything in `docs/benchmarks.md`. Update the defaults and the relevant ADR entries if any values change. Confirm the PoC success criteria (design §2).

### 24. Integrator documentation · `planned`

- `README.md` covers: what the project is, a no-install quick start (`npx md-rag embed`, `check`, `search` and `serve` against a local directory), installing it (`pnpm add md-rag`) for the library API, and the configuration reference (the CLI flags and the matching `createEngine` options, ADR-032).
- `docs/contract.md` is the full frontmatter contract, the `.md-rag/` layout and the sidecar format, written for exporter authors.
