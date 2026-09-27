# Design: Static-Indexed In-Memory Context Gateway

Status: Draft v6 · Last updated: 2026-09-27

## 1. The Idea

AI coding agents need company context: decisions, runbooks, API contracts, team maps. The usual answer is an enterprise RAG stack with a vector database, hosted embedding and reranking APIs, sync workers, and ACL plumbing. For corpora of up to ~100k chunks, most of that stack buys nothing.

This project is an **open-source engine** that makes a Git repository of Markdown files searchable by agents, with no database and no third-party services on the query path:

- **Git is the database.** Knowledge lives as Markdown files with a small frontmatter contract. Changes to files, reviews, history and rollbacks all come from Git.
- **Chunks and vectors are committed next to the content.** Whoever updates the content also runs `md-rag embed`. It chunks each changed document with a structure-aware splitter, then embeds the chunks and records both in a per-document sidecar. Each sidecar carries the hash of the content it was built from, so only changed documents are processed again.
- **The server is a pure function of a directory.** `md-rag serve` reads the Markdown and the sidecars, builds a hybrid (BM25 + vector) index in RAM, and answers queries. It has no state and no background jobs, and it writes nothing except the model cache. It embeds only the query.
- **Precision comes from local reranking.** A small cross-encoder runs in-process on CPU and cuts the candidates down to a few cited snippets. Results are then blended with recency and filtered by a minimum score.
- **The engine is a basic layer that others can build on.** It turns a query into ranked, cited results through a library API, an HTTP endpoint and a CLI, all shipped in one npm package. Anything more advanced, such as LLM post-processing into structured output, is built by integrators on top of the library API.

```
 Integrator-owned                        This project
┌──────────────────┐  write .md    ┌──────────────────────────────────────┐
│ Exporters        │ ────────────► │ knowledge-base/                      │ ◄── md-rag check (CI: contract + sidecar freshness)
│ (Slack, Confl.,  │               │   <any>/<doc>.md                     │
│  GitHub, …)      │  md-rag embed │   .md-rag/vectors/<doc>.md.vec.json  │ ◄── doc hash + model + chunks + vectors
└──────────────────┘ ────────────► │   .md-rag/models/  (git-ignored)     │ ◄── model weights cache
                                   └───────────────────┬──────────────────┘
                                                       │ checkout
                                                       ▼
┌──────────────────────────── md-rag serve / createEngine() ──────────────────────────┐
│  load docs + sidecars → Orama hybrid index (RAM) → query embed → rerank → recency   │
└──────┬──────────────────────────┬──────────────────────────┬────────────────────────┘
       │ library API              │ HTTP JSON                │ CLI
       ▼                          ▼                          ▼
  integrator's advanced     agents (via setup doc),     md-rag search "…"
  layer (e.g. zod schema)   other services
```

### 1.1 How it works

**Write path (integrator-run, engine-provided tooling):**

1. The integrator's exporters write Markdown files with the required frontmatter at deterministic paths, and delete files for removed content. The path is the document's identity.
2. They run `md-rag embed`, which creates the engine's `.md-rag/` folder on first run (ADR-031). For each document whose hash differs from its sidecar's `doc_hash`, it does four things:
   - It **chunks** the document with the structure-aware splitter (ADR-011).
   - It **embeds** each chunk. Vectors are reused for any chunk whose content hash is unchanged.
   - It **writes** the sidecar to `.md-rag/vectors/` with the document hash, the chunker ID, the model ID and each chunk (position in the text, breadcrumb, hash, vector).
   - It **prunes** sidecars whose documents are gone.
3. They commit content and sidecars together. `md-rag check` in CI rejects commits where the contract is broken or sidecars are stale. The check only compares hashes, so it needs no model and no LLM.

**Read path (engine):**

1. On startup the engine validates the storage and checks every sidecar against its document's hash. All sidecars must record the same embedding model, and that is the model the engine loads for queries (ADR-032). If any sidecar is missing or stale, or the models disagree, it **refuses to start**.
2. It builds the Orama index from the recorded chunks and loads the query embedder and the reranker. After a warm-up it reports ready.
3. For each query:
   - embed the query
   - retrieve candidates using hybrid, keyword-only or semantic-only search (optionally filtered)
   - cap the number of chunks per document
   - rerank with the cross-encoder
   - blend in recency
   - apply the score cutoff
   - take the top N results
   - merge adjacent hits from the same document, and optionally expand each hit with its neighbouring chunks
   - return the results with citations

   Each request can override the search mode, result count, cutoff, recency weight, neighbour expansion and filters.

There is no LLM on the query path. The calling agent is already an LLM: it reformulates queries and searches again. The engine's job is to make each call fast and precise (ADR-025).

**Updating a deployment** means restarting the server against a newer checkout. How and where it runs is up to the integrator (ADR-017).

### 1.2 Key implementation decisions

Details and rejected options are in the [ADR log](#4-decision-log-adr).

- **Runtime and language:** Node.js 24 LTS, TypeScript run through native type stripping, and pnpm (ADR-020).
- **Content contract:** Markdown with required frontmatter (`title`, `source`, `updated_at`) and optional `url` and `tags`. Unknown keys are passed through. Frontmatter is parsed in the same pass as the Markdown itself (ADR-003, ADR-023).
- **Sidecars:** they record the chunks as well as the vectors, and freshness is decided by the document hash. The server never needs to run a chunker (ADR-005, ADR-011).
- **Chunking:** the PoC ships one chunker, a structure-aware splitter (ADR-011). Chunking stays pluggable so an LLM chunker can be added later; a design for one exists but is deferred beyond the PoC (ADR-024, ADR-028).
- **Search:** Orama in-process hybrid search (ADR-008).
- **Query-path models:** local only, through transformers.js on `onnxruntime-node`. The embedder is `bge-small-en-v1.5` and the reranker is `ms-marco-MiniLM-L-6-v2`. Both sit behind interfaces, so external providers could be added later (ADR-009, ADR-010, ADR-022).
- **Interface:** a library (`createEngine`), HTTP JSON (`createHttpHandler` / `md-rag serve`) and a CLI (`md-rag search`). There's no MCP adapter and no auth in the PoC (ADR-014, ADR-016).
- **Distribution:** one npm package, `md-rag`, ships the library and the `md-rag` binary, so all three interfaces share one version and one contract. The package holds JavaScript that `tsc` emits at pack time, because Node won't strip types inside `node_modules` (ADR-029, ADR-030).
- **Engine files and configuration:** everything the engine owns lives in `<root>/.md-rag/`: the committed sidecars and a git-ignored model cache. Nothing in it is edited by hand. Configuration comes from built-in defaults and the caller's CLI flags or config object, with no config file and no environment variables. The embedding model is the one the sidecars record (ADR-031, ADR-032).
- **Scoring:** reranker score blended with recency after reranking. The search mode, cutoff, result count, recency weight and neighbour expansion have configured defaults that each request can override (ADR-012, ADR-013). The reranker has to prove its value in eval (ADR-027).

### 1.3 Guarantees and targets

| Property | Target | Notes |
| --- | --- | --- |
| Server-side query latency | p95 ≤ 120 ms | Embed ≤ 15 ms, search ≤ 10 ms, rerank 30 pairs ≤ 80 ms on 2 vCPU x86-64. Measured by `md-rag eval --bench` (ADR-018) |
| Corpus ceiling | ~100k chunks (~700 MB RSS) | ~5 KB/chunk in RAM plus ~200 MB for runtime and models (A1) |
| Startup | Seconds for ~10k docs | Hash checks and index inserts only; no chunking or embedding |
| Freshness | Deployment restart time | There is no ingest lag inside the engine, because chunks and vectors ship with the content |
| Privacy | Neither path leaves the process | No external services in the PoC, aside from downloading model weights into the cache (ADR-019, ADR-022) |

## 2. PoC Scope

The PoC is the smallest system that proves the idea end to end: an agent gets relevant, cited context from a sample knowledge base, through HTTP or the CLI, within the latency target.

### In scope

1. **Document contract:** loading `*.md` with required frontmatter, collecting validation errors across all files, and computing a document hash over normalised (LF) content.
2. **Sidecar format:** stores the document hash, chunker ID, model ID and chunk records (offsets, breadcrumb, anchor, hash, vector).
3. **Chunker:** the structure-aware splitter. A lean LLM chunker was designed (ADR-024) and then deferred beyond the PoC (ADR-028, §3).
4. **`md-rag embed`:** creates `.md-rag/` on first run, processes changed documents only, reuses vectors for unchanged chunks, prunes orphaned sidecars, and supports `--rechunk` to force re-chunking.
5. **`md-rag check`:** validates the contract and checks sidecar freshness, with no model and no LLM. Exits non-zero on failure.
6. **In-memory index:** built from sidecars at startup, failing fast on stale sidecars.
7. **Retrieval pipeline:**
   - Orama candidates in `hybrid`, `keyword` or `semantic` mode, with a boosted title field, English stopwords, and filters on `sources`, `tags` and `updated_after`
   - a per-document cap
   - cross-encoder reranking
   - a recency blend
   - a score cutoff and top N
   - adjacent-chunk merging and optional neighbour expansion
   - per-request overrides for all of the above
8. **Library API:** `createEngine(config)` exposing `search()` and `getDocument()`, plus exported zod schemas for requests and results, which is the extension point for advanced layers.
9. **HTTP API:**
   - `POST /search` and `GET /documents/{ref}`
   - `/healthz` and `/readyz`
   - `createHttpHandler(engine)`, so integrators can mount it in their own server, and `md-rag serve`, which runs it standalone
10. **CLI:** `md-rag search "<query>"`, with Markdown output by default and a `--json` option.
11. **Package:** one npm package, `md-rag`, that contains the library exports and the `md-rag` binary (the CLI and `md-rag serve`). It runs without installation through `npx md-rag` (ADR-029, ADR-030).
12. **Agent setup doc:** a prompt/skill snippet that teaches an agent (e.g. Claude Code) to use the HTTP API or the CLI. It covers when to use each search mode, gives worked request examples, shows the output format, lists what the tool can and cannot do, and tells the agent to search again with a refined query rather than rely on a weak result. Every consumer of the package gets the same interface contract, so one snippet works across teams (ADR-029).
13. **Evaluation:** `md-rag eval` runs golden queries and reports Recall@K, MRR and nDCG@N. `--bench` adds per-stage latency percentiles. Ablation flags (`--no-rerank`, `--mode`) measure what each stage contributes, and `--save` / `--compare` diff against a saved baseline run.
14. **Sample knowledge base and golden queries:** checked into the repo and used by tests, eval and the demo.
15. **Integrator documentation:** the contract, the sidecar format, the commands and the configuration.

### Success criteria

- An agent can answer questions from `examples/docs` through the HTTP API and through `md-rag search`, with correct citations.
- On the sample knowledge base, `md-rag eval` reaches Recall@30 ≥ 0.9 and MRR ≥ 0.7. Thresholds will be revisited once the sample set exists. The eval also shows whether reranking improves results enough to justify its latency.
- `md-rag eval --bench` meets the §1.3 latency target on reference hardware.
- Editing one document and running `md-rag embed` re-processes only that document, and re-embeds only its changed chunks.
- The packed `md-rag` tarball installs into an empty directory, and `md-rag check` and `md-rag search` run from it without a checkout of this repository.

## 3. Beyond the PoC

These are deliberately left out of the PoC. Each one is useful but not needed to prove the idea.

| Item | Why deferred |
| --- | --- |
| MCP adapter (a thin wrapper over the library) | The HTTP API, the CLI and a setup doc are enough for agents (ADR-014) |
| Auth (bearer, OIDC, mTLS) and per-user ACLs | An integration concern that belongs at the ingress (ADR-016) |
| LLM chunker: an LLM groups structural blocks into chunks (never rewriting text), instead of the structure-aware splitter | Headings are a hard, deterministic chunk boundary (ADR-011), so it can only add value on documents with no heading structure at all — and even there, packing consecutive blocks to the size target (ADR-011) already covers it without an LLM call. Deferred until eval shows a real gap the splitter can't cover (ADR-024, superseded by ADR-028) |
| Contextual enrichment: an LLM-written document summary and context line per chunk, prepended before embedding | Proven gains, and Onyx ships it on by default (~50-token document summary, ~64-token chunk context). It needs the LLM chunker working first and can come from the same LLM call (ADR-024) |
| Link-graph boost from Markdown links between knowledge base documents | Grapevine boosts documents that many others reference. It could help cross-linked documents, but it needs link extraction and eval evidence (ADR-026) |
| External embedding and reranking providers | Local models are enough under A1 and A2. The interfaces already allow adding them (ADR-009) |
| Serialised index snapshot for faster startup | Only worth it near the corpus ceiling (ADR-007) |
| Reference GitHub Actions workflow for consuming repos (`md-rag embed` on push, `md-rag check` gate, eval regression gate) | An integration concern; the commands make it a few lines of YAML |
| Example exporters (Slack, Confluence, GitHub) | Ingestion is out of scope (ADR-001) |
| Per-source recency settings | Global settings are enough to validate the blend |
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
| A6 | Whoever writes content can run Node.js and `md-rag embed` in their pipeline,. |
| A7 | Repository growth from sidecars (~2 KB per changed chunk per commit) is acceptable. |

### Records

**ADR-001 · The engine, not a platform.** The project defines a document contract and does not ingest from sources itself. *Why:* ingestion depends on each company's tools and permissions, and a narrow contract keeps the engine reusable. *Rejected:* built-in Slack/Confluence connectors; webhook-driven GitHub Actions.

**ADR-002 · A Git repository is the only storage.** *Why:* no database to run, and history, review and rollback come for free. *Rejected:* Postgres/pgvector and hosted vector databases (operational cost and a network hop, with no benefit under A1).

**ADR-003 · The contract is Markdown with required YAML frontmatter: `title`, `source` and `updated_at` are required; `url` and `tags` are optional; unknown keys are passed through.** *Why:* `updated_at` is the only reliable input for recency, because Git commit time is wrong after bulk re-exports and file mtime changes on checkout. `url` is the only way back to the original source. `title` and `source` could be derived, but requiring them keeps the contract explicit. Exporter-owned maintenance metadata such as `source_id` and `exported_at` is allowed. Engine-owned metadata lives in sidecars (ADR-005). *Rejected:* optional frontmatter with fallbacks (implicit behaviour that is hard to debug); no frontmatter (no reliable recency); native JSON sources (exporters render them to Markdown instead).

**ADR-004 · A document's identity is its path relative to the knowledge base root.** *Why:* overwriting a file updates the document and deleting it removes the document. Staleness is handled without a separate registry. *Rejected:* an ID field in frontmatter (two sources of identity that can drift apart).

**ADR-005 · (Sidecar location amended by ADR-031.) Each document has a sidecar at `.vectors/<doc-path>.vec.json` recording `doc_hash`, chunker ID, embedding model ID and its chunks (offsets, breadcrumb, anchor, chunk hash, vector).** *Why:* the document hash makes freshness a trivial comparison that needs no model or chunker. Recording the chunks means non-deterministic chunkers (such as an LLM) are fine, and the server never has to re-chunk. Chunk hashes let unchanged chunks keep their vectors. Offsets instead of copies of the text keep repository growth down (A7). Line endings are normalised to LF before hashing and computing offsets, so the result is the same on Windows and Unix checkouts. There are no timestamps, because they would churn diffs and Git already records history. *Rejected:* one content-addressed file per chunk (many tiny files and a garbage-collection step); sidecars next to each document (clutters the tree exporters own); a copy of the chunk text in the sidecar (duplicates the content); re-chunking at server startup (requires a deterministic chunker, which rules out LLM chunking).

**ADR-006 · (Reference model refined by ADR-032.) The server fails fast if any sidecar is missing, stale (`doc_hash` mismatch) or built with a different embedding model.** *Why:* a knowledge base that breaks the contract must never serve silently degraded results. Under a rolling update, the previous version keeps serving. *Rejected:* embedding or re-chunking at startup (hides pipeline bugs and makes startup time unpredictable).

**ADR-007 · The index is built in memory at startup from the sidecars, with no serialised artifact.** *Why:* with chunks and vectors already recorded, indexing takes seconds at PoC scale. *Rejected (deferred):* an Orama snapshot. *Rejected:* hot reload.

**ADR-008 · Orama provides in-process hybrid search. The title is indexed as a separate field with a small boost, and also appears in the chunk's breadcrumb.** *Why:* BM25 and vector search in one index and one query, with zero-dependency JavaScript and filters built in. The title acts as a boost rather than a separate signal, as in Onyx, whose title-to-content weight is 0.10. *Rejected:* MiniSearch or Lunr plus a separate ANN library (results must be fused by hand); an external search service.

**ADR-009 · Query-path models are local only (transformers.js on `onnxruntime-node`), behind `Embedder` and `Reranker` interfaces.** *Why:* private, free per query, no network latency, no tokens to manage. The interfaces already exist for test fakes, so an external provider could be added later without redesign. *Rejected:* external embedding and reranking APIs in the PoC (token plumbing and latency, with no quality need under A1 and A2); `flashrank-js` (FlashRank is Python-only).

**ADR-010 · Default query-path models are `Xenova/bge-small-en-v1.5` and `Xenova/ms-marco-MiniLM-L-6-v2` (q8), pinned by revision. One language setting drives the models, the BM25 tokeniser and the BM25 stopword list.** *Why:* small, fast, strong on English (A2), and compatible licences. *Rejected:* `bge-reranker-base` as the default (too slow for the latency target on 2 vCPU; kept as an option).

**ADR-011 · Chunking is a pluggable write-time strategy that produces recorded chunks. The structure-aware splitter is always available: it splits on headings, then block boundaries, never splits code blocks, prefixes a breadcrumb capped at ~25% of the chunk, and caps chunk size (~1,000 characters target, ~2,000 maximum; the target is tuned in eval). Chunks never overlap.** *Why:* structure-aware splitting is the strong baseline for Markdown. Published comparisons show inconsistent gains from semantic chunking over it. A heading is a hard boundary regardless of the resulting chunk's size, because it marks a deliberate new piece of information, not a size threshold to reach — small heading-delimited sections stay their own chunk rather than being packed with their neighbours. Content with no heading at all (or the run of blocks before the first heading) has no such boundary, so it is packed by size alone, the same rule used within any single heading's section. The character cap only keeps chunks within the reranker's input window. Zero overlap and query-time neighbour expansion (ADR-013) go together: overlap would pay at write time, in duplicated text and vectors for every chunk, for context that expansion supplies only when a query asks for it. Without overlap, adjacent chunks also join cleanly. Onyx makes the same pairing (`CHUNK_OVERLAP=0`, "unclear if overlaps actually help"). The breadcrumb cap stops deep headings from crowding out content, following Onyx's 25% limit on metadata. *Supersedes:* the v3 decision that the chunker must be deterministic because the server re-chunks at startup. *Rejected:* fixed-size windows (split code blocks and sections apart); merging small heading-delimited sections together to hit the size target (loses the heading as a semantic signal; cross-section retrieval misses are handled at query time instead, see ADR-028).

**ADR-012 · Recency is blended after reranking: `final = (1−w)·σ(rerank) + w·0.5^(age/half_life)`.** *Why:* any score applied before the reranker is thrown away by it. Recency should break ties, never replace relevance. Because the blend is additive, an old document can lose at most `w` (15% by default), so it never decays to zero. That is the same property as Onyx's multiplicative recency floor of 0.75. *Rejected:* decay inside retrieval; unbounded multiplicative decay.

**ADR-013 · These settings have configured defaults and can be overridden per request: search `mode` (`hybrid` by default, or `keyword` or `semantic`), result count (default 3, max 10), minimum score, recency weight, neighbour `expand` (default 0, max 2 chunks on each side) and filters. Results are always capped at 2 chunks per document, and adjacent hits from one document are merged into a single result.** *Why:* different callers want different precision/recall trade-offs, and returning no result is better than padding the agent's context with noise. `keyword` mode lets an agent force exact matching for identifiers, following Grapevine's separate keyword and semantic tools, without giving up fused hybrid search as the default. Expansion supplies surrounding context only when it's asked for (Onyx expands 1 chunk above and below by default). *Rejected:* a fixed top 3; config-only settings; separate keyword and semantic endpoints (a mode parameter is enough).

**ADR-014 · The PoC interface is a library API, HTTP JSON on `node:http`, and a CLI, plus an agent setup doc. MCP is deferred.** *Why:* the library is the basic layer that advanced layers compose on. HTTP and the CLI are enough for agents, given a setup prompt. An MCP adapter is a thin wrapper that can be added later. *Rejected:* MCP in the PoC; Fastify or Express (unneeded dependencies).

**ADR-015 · There are two operations: `search` and `getDocument`.** *Why:* snippets stay short, and callers can expand a result on demand. *Rejected:* a single `get_context`; one operation per source.

**ADR-016 · There is no auth or ACL inside the engine: one deployment per audience.** *Why:* access control is an integration concern that belongs at the ingress (A3). *Supersedes:* the v3 optional bearer token. *Rejected:* per-document ACL filtering.

**ADR-017 · (Refined by ADR-029.) Deployment-agnostic: the engine ships as a Node package with a CLI, not as a container image.** *Why:* where and how it runs is up to the integrator. *Rejected:* an official Docker image; baking indexes into images.

**ADR-018 · Latency and quality numbers are measured targets, not claims.** *Why:* the original "< 30 ms" left out query embedding and underestimated the cost of the cross-encoder. *Rejected:* stating guarantees before benchmarking.

**ADR-019 · Data boundary: neither the query path nor the write path calls an external service in the PoC.** *Why:* this makes the privacy claim unconditional rather than dependent on an optional feature. Deleting a file removes it from the index but not from Git history, and integrators handling PII need their own retention process. *Rejected:* "100% in-house" (network access for model downloads is still allowed, ADR-022).

**ADR-020 · (Amended by ADR-030.) Toolchain: Node.js 24 LTS; TypeScript executed through native type stripping, with `tsc --noEmit` for type-checking; pnpm; Biome; Vitest.** *Why:* no build step, fast tools, and minimal configuration. *Rejected:* tsc emit or bundlers; ESLint plus Prettier; Bun (native ONNX bindings are less proven on it).

**ADR-021 · The licence is MIT.** *Why:* permissive and compatible with the default models' licences (MIT/Apache-2.0).

**ADR-022 · (Default cache directory amended by ADR-031.) Query-path models are downloaded from the Hugging Face Hub on first use into a configurable cache directory. Remote fetching can be disabled for air-gapped hosts.** *Why:* keeps model weights out of the repository, and pre-fetching allows offline operation. *Rejected:* vendoring weights in the repo; downloading at every start.

**ADR-023 · Frontmatter is parsed in the same mdast pass as the Markdown (`mdast-util-frontmatter` plus `yaml`) and validated with zod.** *Why:* the Markdown is already parsed with mdast for chunking, and a second parser would be redundant. *Rejected:* gray-matter (last released in 2019, depends on the outdated js-yaml 3).

**ADR-024 · (Superseded by ADR-028 — deferred beyond the PoC; kept as the reference design.) The LLM chunker is lean. The document is first split into structural blocks with IDs. The LLM (AI SDK `generateObject`, Claude Haiku 4.5 by default, temperature 0) returns only groups of consecutive block IDs. The output is validated: it must be complete, ordered, non-overlapping and within the size cap. If validation fails or the call errors, that document uses the splitter. The LLM chunker is used only when a model is configured.** *Why:* grouping by block ID means the LLM can never rewrite or drop text, keeps the output small and cheap, and makes validation trivial. The fallback means a missing key or a failed call never blocks `md-rag embed`. Chunks are recorded in the sidecar (ADR-005), so the LLM's non-determinism doesn't matter. Changing the chunker does not invalidate existing sidecars, and `md-rag embed --rechunk` re-chunks on demand. *Rejected:* the LLM returning chunk text (can alter content and costs more output tokens); LLM-only chunking with no fallback; re-chunking automatically whenever the chunker config changes (an unexpected LLM bill).

**ADR-025 · There is no LLM on the query path.** *Why:* the caller is already an LLM agent that can reformulate its query and search again. Putting LLM calls inside search would add seconds of latency and per-query cost, and would break ADR-019. Onyx's agentic search does use up to 6 LLM cycles (query expansion, then fusing results by rank, then LLM section selection, then LLM expansion), but it serves users who are not themselves agents. *Rejected:* multi-query generation with rank fusion, LLM relevance filtering or section selection, and an `ask_agent`-style endpoint that answers questions (Grapevine).

**ADR-026 · No extra index-time representations in the PoC: no mini-chunks or large chunks with their own embeddings, and no separate title embeddings. The link-graph boost is deferred.** *Why:* each one multiplies index size and write cost, and there's no evidence they help at our scale (A1) with structure-aware chunks and breadcrumbs. Onyx keeps its multi-pass indexing behind a flag. *Rejected:* Onyx multi-pass indexing; separate keyword and vector stores (Grapevine uses OpenSearch plus Turbopuffer, and Orama already combines both).

**ADR-027 · The cross-encoder reranker is kept provisionally and must earn its place in eval.** *Why:* neither reference project uses one on its live path. Grapevine uses a linear blend of scores, and Onyx has cross-encoder code but only runs it at warm-up. It is still the only local precision step we have without an LLM (ADR-025). `md-rag eval --no-rerank` measures what it adds against its ~80 ms. If the gain is marginal, the default becomes off and this ADR is superseded. *Rejected:* dropping it without measuring; replacing it with an LLM (ADR-025).

**ADR-028 · The LLM chunker (ADR-024) is deferred beyond the PoC.** *Why:* the structure-aware splitter treats each heading as a hard, deterministic chunk boundary (ADR-011), the strongest available signal for well-structured Markdown. The LLM chunker's grouping is still constrained to contiguous blocks, so within that rule it cannot improve on the splitter's boundaries without crossing a heading — and crossing one was rejected outright (ADR-011). Its one remaining edge case, content with no heading structure (e.g. chat-style threads), is instead handled by the splitter packing consecutive blocks by size alone when there is no heading to break at (ADR-011), which needs no LLM call. Deferring also drops an LLM dependency, a configured API key and non-deterministic write-time behaviour from the PoC, none of which have proven necessary. *Supersedes:* ADR-024's decision to ship the LLM chunker in the PoC; its design (block-ID grouping, validation, splitter fallback) is kept as the reference design if this is revisited (§3). *Rejected:* shipping it unconditionally as in ADR-024; an always-on evaluation gate like ADR-027 gives the reranker, since here the splitter's heading-boundary rule already explains why it wouldn't earn its place on headed documents.

**ADR-029 · Distribution: one npm package, `md-rag`, ships all three interfaces. Its `exports` hold the library (`createEngine`, `createHttpHandler` and the schemas), and its `md-rag` binary runs the CLI and `md-rag serve`. The CLI and the server are thin wrappers over the library and depend on nothing beyond it and Node built-ins.** *Why:* a single install keeps every usage pattern on the same version. A library integrator, an agent calling HTTP and a CI job running `md-rag check` get the same behaviour and the same request/response contract. That shared contract is what lets one agent setup doc work across teams and organisations. Shipping the wrappers ready-made stops each consuming team from building slightly different HTTP endpoints, CLI flags or setup scripts. Evaluating the engine takes `npx md-rag embed` and `npx md-rag search`, with no code. The package, the binary and the engine's folder (ADR-031) all use the name `md-rag`; `mdrag` is taken on npm by an unrelated library. *Refines:* ADR-017. *Rejected:* separate core, CLI and server packages (the interfaces could drift apart in version, with no benefit at this size); a library-only package that leaves HTTP and CLI to integrators (every team rebuilds them, and the setup doc can't be shared); consuming the repository as a Git submodule or vendored copy.

**ADR-030 · The published package holds JavaScript and type declarations that `tsc` emits into `dist/` at pack time. Development, tests and CI keep running the TypeScript sources directly.** *Why:* Node refuses to strip types from files under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so a package of `.ts` sources would fail on every install. Library consumers also need `.d.ts` files. Because the code is erasable-only (ADR-020), the emit is a plain type strip, and `rewriteRelativeImportExtensions` changes `.ts` import specifiers to `.js`. The build runs only in `prepack`, so day-to-day development keeps ADR-020's no-build-step workflow. *Amends:* ADR-020, which rejected tsc emit, but only for development. *Rejected:* publishing the `.ts` sources (they won't run from `node_modules`); a bundler (an extra tool, and the native `onnxruntime-node` binding would have to stay external anyway).

**ADR-031 · Every file the engine owns lives in one folder, `<root>/.md-rag/`, and every file in it is generated by the engine; nothing there is edited by hand. `vectors/` holds the sidecars and is committed. `models/` is the model cache. `.md-rag/.gitignore` keeps `models/` out of Git. `md-rag embed` creates the folder on first run, and there is no `init` command.** *Why:* exporters own the rest of the tree, so a single dot-folder holds the engine's whole footprint. The loader skips it like any other dot-directory, the ignore rule lives inside it, and CI can cache `.md-rag/models/` at a fixed path. Because the folder holds only generated files, the engine can change its layout or formats and rewrite them: a sidecar `format` bump or a new ignore rule never collides with a user's edits. For the same reason the tool rewrites `.gitignore` to its canonical content every time it sets up the folder, and integrators who want more ignore rules add them to the repository's own `.gitignore`. The cache default has to be set explicitly anyway: transformers.js caches inside its own `node_modules` folder by default, which is wiped on every reinstall and, under `npx`, sits in a throwaway directory. `embed` is the first command every knowledge base needs, because `check`, `search` and `serve` fail fast without sidecars and tell you to run it. A separate `init` would add a step to the quick start with nothing of its own to do. Every command that downloads models goes through the same folder setup, so the cache never appears without its `.gitignore`. `--models-dir` still overrides the cache location, for example to share one cache across checkouts on a deployment host, or to point at pre-fetched weights on an air-gapped one. *Amends:* ADR-005 (the sidecar location, formerly `.vectors/`) and ADR-022 (the default cache directory). *Rejected:* `.vectors/` plus a global cache in the user's home directory (two locations to know about, and the cache moves with the machine); an `md-rag init` command (see above); committing model weights (ADR-022); a `.gitignore` that users can extend (a hand-edited file in the engine's folder).

**ADR-032 · Configuration comes only from explicit inputs: built-in defaults, overridden by the caller's CLI flags or by the object passed to `createEngine`. One zod schema validates the result. There is no config file, and the engine reads no environment variables. The embedding model is not configurable: `embed` always uses the engine's embedding preset and re-embeds any sidecar recorded with another model, and `check`, `search` and `serve` use the one model the sidecars record.** *Why:* every input is then either a versioned public interface (the CLI flags and the library schema, released with the package) or data the engine generated itself (the sidecars). There is no hand-edited file whose schema the engine would have to keep reading, and migrating, across releases. Environment variables would add hidden, machine-local state that makes the same command behave differently in CI, on a laptop and on a server. The one setting that `embed` and the read path must agree on is the embedding model, and ADR-005 already records it in every sidecar. Reading it from there makes disagreement impossible rather than something to detect. Settings that matter to only one command, such as the chunk size target for `embed` or the port and retrieval defaults for `serve`, are flags. Integrators keep their invocations in their own scripts or CI, and map environment variables themselves, for example `md-rag serve --port "$PORT"`. *Rejected:* `MDRAG_*` environment variables; a config file inside `.md-rag/` (a hand-edited file in the engine-owned folder, whose users' copies break when its schema changes, ADR-031); a config file in the knowledge base root (another user-facing schema to version, and clutter in the tree exporters own, for no need once the model comes from the sidecars); a configured model checked against the sidecars (two sources of truth for one fact); an `embed --model` flag (the PoC has a single embedding preset, so there is nothing to switch to).
