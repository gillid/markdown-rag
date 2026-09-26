# Design: Static-Indexed In-Memory Context Gateway

Status: Draft v4 · Last updated: 2026-09-26

## 1. The Idea

AI coding agents need company context: decisions, runbooks, API contracts, team maps. The usual answer is an enterprise RAG stack with a vector database, hosted embedding and reranking APIs, sync workers, and ACL plumbing. For corpora of up to ~100k chunks, most of that stack buys nothing.

This project is an **open-source engine** that makes a Git repository of Markdown files searchable by agents, with no database and no third-party services on the query path:

- **Git is the database.** Knowledge lives as Markdown files with a small frontmatter contract. Changes to files, reviews, history and rollbacks all come from Git.
- **Chunks and vectors are committed next to the content.** Whoever updates the content also runs `kb embed`. It chunks each changed document, using an LLM when one is configured and a structure-aware splitter otherwise, then embeds the chunks and records both in a per-document sidecar. Each sidecar carries the hash of the content it was built from, so only changed documents are processed again.
- **The server is a pure function of a directory.** `kb serve` reads the Markdown and the sidecars, builds a hybrid (BM25 + vector) index in RAM, and answers queries. It has no state, no background jobs and no writes. It embeds only the query.
- **Precision comes from local reranking.** A small cross-encoder runs in-process on CPU and cuts the candidates down to a few cited snippets. Results are then blended with recency and filtered by a minimum score.
- **The engine is a basic layer that others can build on.** It turns a query into ranked, cited results through a library API, an HTTP endpoint and a CLI. Anything more advanced, such as LLM post-processing into structured output, is built by integrators on top of the library API.

```
 Integrator-owned                        This project
┌──────────────────┐  write .md    ┌──────────────────────────────┐
│ Exporters        │ ────────────► │ knowledge-base/              │ ◄── kb check (CI: contract + sidecar freshness)
│ (Slack, Confl.,  │               │   <any>/<doc>.md             │
│  GitHub, …)      │  kb embed     │   .vectors/<doc>.md.vec.json │ ◄── doc hash + chunks + vectors
└──────────────────┘ ────────────► └───────────────┬──────────────┘
          (optional LLM chunker: AI SDK → Claude)  │ checkout
                                                   ▼
┌───────────────────────────── kb serve / createEngine() ─────────────────────────────┐
│  load docs + sidecars → Orama hybrid index (RAM) → query embed → rerank → recency    │
└──────┬──────────────────────────┬──────────────────────────┬────────────────────────┘
       │ library API              │ HTTP JSON                │ CLI
       ▼                          ▼                          ▼
  integrator's advanced     agents (via setup doc),     kb search "…"
  layer (e.g. zod schema)   other services
```

### 1.1 How it works

**Write path (integrator-run, engine-provided tooling):**

1. The integrator's exporters write Markdown files with the required frontmatter at deterministic paths, and delete files for removed content. The path is the document's identity.
2. They run `kb embed`. For each document whose hash differs from its sidecar's `doc_hash`, it does four things:
   - It **chunks** the document. If an LLM is configured (AI SDK, Claude by default), the LLM groups the document's structural blocks into semantic chunks. Otherwise, or if the LLM fails for that document, the structure-aware splitter does the job.
   - It **embeds** each chunk. Vectors are reused for any chunk whose content hash is unchanged.
   - It **writes** the sidecar with the document hash, the chunker ID, the model ID and each chunk (position in the text, breadcrumb, hash, vector).
   - It **prunes** sidecars whose documents are gone.
3. They commit content and sidecars together. `kb check` in CI rejects commits where the contract is broken or sidecars are stale. The check only compares hashes, so it needs no model and no LLM.

**Read path (engine):**

1. On startup the engine validates the KB and checks every sidecar against its document's hash and the configured embedding model. If any sidecar is missing or stale, it **refuses to start**.
2. It builds the Orama index from the recorded chunks and loads the query embedder and the reranker. After a warm-up it reports ready.
3. For each query:
   - embed the query
   - retrieve hybrid candidates (optionally filtered)
   - cap the number of chunks per document
   - rerank with the cross-encoder
   - blend in recency
   - apply the score cutoff
   - return the top N results, each with its citation

   Each request can override the result count, the cutoff, the recency weight and the filters.

**Updating a deployment** means restarting the server against a newer checkout. How and where it runs is up to the integrator (ADR-017).

### 1.2 Key implementation decisions

Details and rejected options are in the [ADR log](#4-decision-log-adr).

- **Runtime and language:** Node.js 24 LTS, TypeScript run through native type stripping, and pnpm (ADR-020).
- **Content contract:** Markdown with required frontmatter (`title`, `source`, `updated_at`) and optional `url` and `tags`. Unknown keys are passed through. Frontmatter is parsed in the same pass as the Markdown itself (ADR-003, ADR-023).
- **Sidecars:** they record the chunks as well as the vectors, and freshness is decided by the document hash. The server never needs to run a chunker (ADR-005, ADR-011).
- **Chunking:** chunkers are pluggable. The PoC ships two: a lean LLM chunker, where Claude (via AI SDK) groups structural blocks and never rewrites text, and a structure-aware fallback splitter (ADR-011, ADR-024).
- **Search:** Orama in-process hybrid search (ADR-008).
- **Query-path models:** local only, through transformers.js on `onnxruntime-node`. The embedder is `bge-small-en-v1.5` and the reranker is `ms-marco-MiniLM-L-6-v2`. Both sit behind interfaces, so external providers could be added later (ADR-009, ADR-010, ADR-022).
- **Interface:** a library (`createEngine`), HTTP JSON (`createHttpHandler` / `kb serve`) and a CLI (`kb search`). There's no MCP adapter and no auth in the PoC (ADR-014, ADR-016).
- **Scoring:** reranker score blended with recency after reranking. The cutoff, result count and recency weight have configured defaults that each request can override (ADR-012, ADR-013).

### 1.3 Guarantees and targets

| Property | Target | Notes |
| --- | --- | --- |
| Server-side query latency | p95 ≤ 120 ms | Embed ≤ 15 ms, search ≤ 10 ms, rerank 30 pairs ≤ 80 ms on 2 vCPU x86-64. Measured by `kb eval --bench` (ADR-018) |
| Corpus ceiling | ~100k chunks (~700 MB RSS) | ~5 KB/chunk in RAM plus ~200 MB for runtime and models (A1) |
| Startup | Seconds for ~10k docs | Hash checks and index inserts only; no chunking or embedding |
| Freshness | Deployment restart time | There is no ingest lag inside the engine, because chunks and vectors ship with the content |
| Privacy | The query path never leaves the process | Write-time LLM chunking is opt-in, using a provider the integrator chooses (ADR-019) |

## 2. PoC Scope

The PoC is the smallest system that proves the idea end to end: an agent gets relevant, cited context from a sample KB, through HTTP or the CLI, within the latency target.

### In scope

1. **Document contract:** loading `*.md` with required frontmatter, collecting validation errors across all files, and computing a document hash over normalised (LF) content.
2. **Sidecar format:** stores the document hash, chunker ID, model ID and chunk records (offsets, breadcrumb, anchor, hash, vector).
3. **Chunkers:** the structure-aware splitter, and the lean LLM chunker (AI SDK with Anthropic, enabled by config and an API key), which falls back to the splitter for each document it cannot handle.
4. **`kb embed`:** processes changed documents only, reuses vectors for unchanged chunks, prunes orphaned sidecars, and supports `--rechunk` to force re-chunking.
5. **`kb check`:** validates the contract and checks sidecar freshness, with no model and no LLM. Exits non-zero on failure.
6. **In-memory index:** built from sidecars at startup, failing fast on stale sidecars.
7. **Retrieval pipeline:**
   - Orama hybrid candidates, with filters on `sources`, `tags` and `updated_after`
   - a per-document cap
   - cross-encoder reranking
   - a recency blend
   - a score cutoff and top N, with per-request overrides
8. **Library API:** `createEngine(config)` exposing `search()` and `getDocument()`, plus exported zod schemas for requests and results, which is the extension point for advanced layers.
9. **HTTP API:**
   - `POST /search` and `GET /documents/{ref}`
   - `/healthz` and `/readyz`
   - `createHttpHandler(engine)`, so integrators can mount it in their own server, and `kb serve`, which runs it standalone
10. **CLI:** `kb search "<query>"`, with Markdown output by default and a `--json` option.
11. **Agent setup doc:** a prompt/skill snippet that teaches an agent (e.g. Claude Code) to use the HTTP API or the CLI.
12. **Evaluation:** `kb eval` runs golden queries and reports Recall@K, MRR and nDCG@N. `--bench` adds per-stage latency percentiles.
13. **Sample KB and golden queries:** checked into the repo and used by tests, eval and the demo.
14. **Integrator documentation:** the contract, the sidecar format, the commands and the configuration.

### Success criteria

- An agent can answer questions from `examples/kb` through the HTTP API and through `kb search`, with correct citations.
- On the sample KB, `kb eval` reaches Recall@30 ≥ 0.9 and MRR ≥ 0.7 with both chunkers. Thresholds will be revisited once the sample set exists. The eval also shows how the LLM chunker compares with the splitter.
- `kb eval --bench` meets the §1.3 latency target on reference hardware.
- Editing one document and running `kb embed` re-processes only that document, and re-embeds only its changed chunks.
- Without an LLM configured, `kb embed` works end to end using the splitter.

## 3. Beyond the PoC

These are deliberately left out of the PoC. Each one is useful but not needed to prove the idea.

| Item | Why deferred |
| --- | --- |
| MCP adapter (a thin wrapper over the library) | The HTTP API, the CLI and a setup doc are enough for agents (ADR-014) |
| Auth (bearer, OIDC, mTLS) and per-user ACLs | An integration concern that belongs at the ingress (ADR-016) |
| Contextual enrichment: an LLM-written context line per chunk, prepended before embedding | Proven gains, but it needs the LLM chunker working first. It can come from the same LLM call (ADR-024) |
| External embedding and reranking providers | Local models are enough under A1 and A2. The interfaces already allow adding them (ADR-009) |
| Serialised index snapshot for faster startup | Only worth it near the corpus ceiling (ADR-007) |
| Reference GitHub Actions workflow for KB repos (`kb embed` on push, `kb check` gate, eval regression gate) | An integration concern; the commands make it a few lines of YAML |
| Example exporters (Slack, Confluence, GitHub) | Ingestion is out of scope (ADR-001) |
| Per-source recency settings | Global settings are enough to validate the blend |
| Merging adjacent chunks into one snippet | Cosmetic |
| Prometheus metrics and opt-in query logging | The PoC needs only stderr logs and `--bench` |
| Multilingual model presets | English is assumed (A2) |
| Vector quantisation in sidecars (f16/int8) | Reduces repo growth (A7); not needed at PoC scale |
| Hot index reload, container image | Restarting is simple; deployment is the integrator's concern (ADR-007, ADR-017) |

## 4. Decision Log (ADR)

Each record: **Decision**, then **Why**, then **Rejected** options. Superseded records are kept and marked.

### Assumptions

| ID | Assumption |
| --- | --- |
| A1 | A deployment's corpus stays at or below ~100k chunks (≈ 10–20k typical documents). |
| A2 | Content and queries are primarily English. |
| A3 | Everyone who can reach a deployment may see all of its content. |
| A4 | Exporters produce deterministic file paths and a meaningful `updated_at`. |
| A5 | Hosts are x86-64 or arm64 with CPU support in `onnxruntime-node`. No GPU is needed. |
| A6 | Whoever writes content can run Node.js and `kb embed` in their pipeline, and can provide an LLM API key there if they want LLM chunking. |
| A7 | Repository growth from sidecars (~2 KB per changed chunk per commit) is acceptable. |

### Records

**ADR-001 · The engine, not a platform.** The project defines a document contract and does not ingest from sources itself. *Why:* ingestion depends on each company's tools and permissions, and a narrow contract keeps the engine reusable. *Rejected:* built-in Slack/Confluence connectors; webhook-driven GitHub Actions.

**ADR-002 · A Git repository is the only storage.** *Why:* no database to run, and history, review and rollback come for free. *Rejected:* Postgres/pgvector and hosted vector databases (operational cost and a network hop, with no benefit under A1).

**ADR-003 · The contract is Markdown with required YAML frontmatter: `title`, `source` and `updated_at` are required; `url` and `tags` are optional; unknown keys are passed through.** *Why:* `updated_at` is the only reliable input for recency, because Git commit time is wrong after bulk re-exports and file mtime changes on checkout. `url` is the only way back to the original source. `title` and `source` could be derived, but requiring them keeps the contract explicit. Exporter-owned maintenance metadata such as `source_id` and `exported_at` is allowed. Engine-owned metadata lives in sidecars (ADR-005). *Rejected:* optional frontmatter with fallbacks (implicit behaviour that is hard to debug); no frontmatter (no reliable recency); native JSON sources (exporters render them to Markdown instead).

**ADR-004 · A document's identity is its path relative to the KB root.** *Why:* overwriting a file updates the document and deleting it removes the document. Staleness is handled without a separate registry. *Rejected:* an ID field in frontmatter (two sources of identity that can drift apart).

**ADR-005 · Each document has a sidecar at `.vectors/<doc-path>.vec.json` recording `doc_hash`, chunker ID, embedding model ID and its chunks (offsets, breadcrumb, anchor, chunk hash, vector).** *Why:* the document hash makes freshness a trivial comparison that needs no model or chunker. Recording the chunks means non-deterministic chunkers (such as an LLM) are fine, and the server never has to re-chunk. Chunk hashes let unchanged chunks keep their vectors. Offsets instead of copies of the text keep repository growth down (A7). Line endings are normalised to LF before hashing and computing offsets, so the result is the same on Windows and Unix checkouts. There are no timestamps, because they would churn diffs and Git already records history. *Rejected:* one content-addressed file per chunk (many tiny files and a garbage-collection step); sidecars next to each document (clutters the tree exporters own); a copy of the chunk text in the sidecar (duplicates the content); re-chunking at server startup (requires a deterministic chunker, which rules out LLM chunking).

**ADR-006 · The server fails fast if any sidecar is missing, stale (`doc_hash` mismatch) or built with a different embedding model.** *Why:* a KB that breaks the contract must never serve silently degraded results. Under a rolling update, the previous version keeps serving. *Rejected:* embedding or re-chunking at startup (hides pipeline bugs and makes startup time unpredictable).

**ADR-007 · The index is built in memory at startup from the sidecars, with no serialised artifact.** *Why:* with chunks and vectors already recorded, indexing takes seconds at PoC scale. *Rejected (deferred):* an Orama snapshot. *Rejected:* hot reload.

**ADR-008 · Orama provides in-process hybrid search.** *Why:* BM25 and vector search in one index and one query, with zero-dependency JavaScript and filters built in. *Rejected:* MiniSearch or Lunr plus a separate ANN library (results must be fused by hand); an external search service.

**ADR-009 · Query-path models are local only (transformers.js on `onnxruntime-node`), behind `Embedder` and `Reranker` interfaces.** *Why:* private, free per query, no network latency, no tokens to manage. The interfaces already exist for test fakes, so an external provider could be added later without redesign. *Rejected:* external embedding and reranking APIs in the PoC (token plumbing and latency, with no quality need under A1 and A2); `flashrank-js` (FlashRank is Python-only).

**ADR-010 · Default query-path models are `Xenova/bge-small-en-v1.5` and `Xenova/ms-marco-MiniLM-L-6-v2` (q8), pinned by revision. One language setting drives both the models and the BM25 tokeniser.** *Why:* small, fast, strong on English (A2), and compatible licences. *Rejected:* `bge-reranker-base` as the default (too slow for the latency target on 2 vCPU; kept as an option).

**ADR-011 · Chunking is a pluggable write-time strategy that produces recorded chunks. The structure-aware splitter is always available: it splits on headings, then block boundaries, never splits code blocks, prefixes a breadcrumb, and caps chunk size (~1,000 characters target, ~2,000 maximum).** *Why:* structure-aware splitting is the strong baseline for Markdown. Published comparisons show inconsistent gains from semantic chunking over it. The character cap only keeps chunks within the reranker's input window. *Supersedes:* the v3 decision that the chunker must be deterministic because the server re-chunks at startup. *Rejected:* fixed-size windows (split code blocks and sections apart).

**ADR-012 · Recency is blended after reranking: `final = (1−w)·σ(rerank) + w·0.5^(age/half_life)`.** *Why:* any score applied before the reranker is thrown away by it. Recency should break ties, never replace relevance. *Rejected:* decay inside retrieval.

**ADR-013 · The result count (default 3, max 10), minimum score, recency weight and filters have configured defaults and can be overridden per request. Results are always capped at 2 chunks per document.** *Why:* different callers want different precision/recall trade-offs, and returning no result is better than padding the agent's context with noise. *Rejected:* a fixed top 3; config-only settings.

**ADR-014 · The PoC interface is a library API, HTTP JSON on `node:http`, and a CLI, plus an agent setup doc. MCP is deferred.** *Why:* the library is the basic layer that advanced layers compose on. HTTP and the CLI are enough for agents, given a setup prompt. An MCP adapter is a thin wrapper that can be added later. *Rejected:* MCP in the PoC; Fastify or Express (unneeded dependencies).

**ADR-015 · There are two operations: `search` and `getDocument`.** *Why:* snippets stay short, and callers can expand a result on demand. *Rejected:* a single `get_context`; one operation per source.

**ADR-016 · There is no auth or ACL inside the engine: one deployment per audience.** *Why:* access control is an integration concern that belongs at the ingress (A3). *Supersedes:* the v3 optional bearer token. *Rejected:* per-document ACL filtering.

**ADR-017 · Deployment-agnostic: the engine ships as a Node package with a CLI, not as a container image.** *Why:* where and how it runs is up to the integrator. *Rejected:* an official Docker image; baking indexes into images.

**ADR-018 · Latency and quality numbers are measured targets, not claims.** *Why:* the original "< 30 ms" left out query embedding and underestimated the cost of the cross-encoder. *Rejected:* stating guarantees before benchmarking.

**ADR-019 · Data boundary: the query path runs entirely in-process. By default the engine calls no external services. Optional write-time LLM steps use a model the integrator explicitly configures, such as a Claude API key through AI SDK or a local model, within the integrator's own trust boundary.** *Why:* this makes the privacy claim accurate while still allowing internal AI tooling. Deleting a file removes it from the index but not from Git history, and integrators handling PII need their own retention process. *Rejected:* "100% in-house"; "no LLM ever".

**ADR-020 · Toolchain: Node.js 24 LTS; TypeScript executed through native type stripping, with `tsc --noEmit` for type-checking; pnpm; Biome; Vitest.** *Why:* no build step, fast tools, and minimal configuration. *Rejected:* tsc emit or bundlers; ESLint plus Prettier; Bun (native ONNX bindings are less proven on it).

**ADR-021 · The licence is MIT.** *Why:* permissive and compatible with the default models' licences (MIT/Apache-2.0).

**ADR-022 · Query-path models are downloaded from the Hugging Face Hub on first use into a configurable cache directory. Remote fetching can be disabled for air-gapped hosts.** *Why:* keeps model weights out of the repository, and pre-fetching allows offline operation. *Rejected:* vendoring weights in the repo; downloading at every start.

**ADR-023 · Frontmatter is parsed in the same mdast pass as the Markdown (`mdast-util-frontmatter` plus `yaml`) and validated with zod.** *Why:* the Markdown is already parsed with mdast for chunking, and a second parser would be redundant. *Rejected:* gray-matter (last released in 2019, depends on the outdated js-yaml 3).

**ADR-024 · The LLM chunker is lean. The document is first split into structural blocks with IDs. The LLM (AI SDK `generateObject`, Claude Haiku 4.5 by default, temperature 0) returns only groups of consecutive block IDs. The output is validated: it must be complete, ordered, non-overlapping and within the size cap. If validation fails or the call errors, that document uses the splitter. The LLM chunker is used only when a model is configured.** *Why:* grouping by block ID means the LLM can never rewrite or drop text, keeps the output small and cheap, and makes validation trivial. The fallback means a missing key or a failed call never blocks `kb embed`. Chunks are recorded in the sidecar (ADR-005), so the LLM's non-determinism doesn't matter. Changing the chunker does not invalidate existing sidecars, and `kb embed --rechunk` re-chunks on demand. *Rejected:* the LLM returning chunk text (can alter content and costs more output tokens); LLM-only chunking with no fallback; re-chunking automatically whenever the chunker config changes (an unexpected LLM bill).
