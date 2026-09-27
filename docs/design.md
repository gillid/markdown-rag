# Design: Static-Indexed In-Memory Context Gateway

Status: Draft v5 · Last updated: 2026-09-26

## 1. The Idea

AI coding agents need company context: decisions, runbooks, API contracts, team maps. The usual answer is an enterprise RAG stack with a vector database, hosted embedding and reranking APIs, sync workers, and ACL plumbing. For corpora of up to ~100k chunks, most of that stack buys nothing.

This project is an **open-source engine** that makes a Git repository of Markdown files searchable by agents, with no database and no third-party services on the query path:

- **Git is the database.** Knowledge lives as Markdown files with a small frontmatter contract. Changes to files, reviews, history and rollbacks all come from Git.
- **Chunks and vectors are committed next to the content.** Whoever updates the content also runs `mdrag embed`. It chunks each changed document with a structure-aware splitter, then embeds the chunks and records both in a per-document sidecar. Each sidecar carries the hash of the content it was built from, so only changed documents are processed again.
- **The server is a pure function of a directory.** `mdrag serve` reads the Markdown and the sidecars, builds a hybrid (BM25 + vector) index in RAM, and answers queries. It has no state, no background jobs and no writes. It embeds only the query.
- **Precision comes from local reranking.** A small cross-encoder runs in-process on CPU and cuts the candidates down to a few cited snippets. Results are then blended with recency and filtered by a minimum score.
- **The engine is a basic layer that others can build on.** It turns a query into ranked, cited results through a library API, an HTTP endpoint and a CLI. Anything more advanced, such as LLM post-processing into structured output, is built by integrators on top of the library API.

```
 Integrator-owned                        This project
┌──────────────────┐  write .md    ┌──────────────────────────────┐
│ Exporters        │ ────────────► │ knowledge-base/              │ ◄── mdrag check (CI: contract + sidecar freshness)
│ (Slack, Confl.,  │               │   <any>/<doc>.md             │
│  GitHub, …)      │  mdrag embed  │   .vectors/<doc>.md.vec.json │ ◄── doc hash + chunks + vectors
└──────────────────┘ ────────────► └───────────────┬──────────────┘
                                                   │ checkout
                                                   ▼
┌──────────────────────────── mdrag serve / createEngine() ───────────────────────────┐
│  load docs + sidecars → Orama hybrid index (RAM) → query embed → rerank → recency    │
└──────┬──────────────────────────┬──────────────────────────┬────────────────────────┘
       │ library API              │ HTTP JSON                │ CLI
       ▼                          ▼                          ▼
  integrator's advanced     agents (via setup doc),     mdrag search "…"
  layer (e.g. zod schema)   other services
```

### 1.1 How it works

**Write path (integrator-run, engine-provided tooling):**

1. The integrator's exporters write Markdown files with the required frontmatter at deterministic paths, and delete files for removed content. The path is the document's identity.
2. They run `mdrag embed`. For each document whose hash differs from its sidecar's `doc_hash`, it does four things:
   - It **chunks** the document with the structure-aware splitter (ADR-011).
   - It **embeds** each chunk. Vectors are reused for any chunk whose content hash is unchanged.
   - It **writes** the sidecar with the document hash, the chunker ID, the model ID and each chunk (position in the text, breadcrumb, hash, vector).
   - It **prunes** sidecars whose documents are gone.
3. They commit content and sidecars together. `mdrag check` in CI rejects commits where the contract is broken or sidecars are stale. The check only compares hashes, so it needs no model and no LLM.

**Read path (engine):**

1. On startup the engine validates the KB and checks every sidecar against its document's hash and the configured embedding model. If any sidecar is missing or stale, it **refuses to start**.
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
- **Interface:** a library (`createEngine`), HTTP JSON (`createHttpHandler` / `mdrag serve`) and a CLI (`mdrag search`). There's no MCP adapter and no auth in the PoC (ADR-014, ADR-016).
- **Scoring:** reranker score blended with recency after reranking. The search mode, cutoff, result count, recency weight and neighbour expansion have configured defaults that each request can override (ADR-012, ADR-013). The reranker has to prove its value in eval (ADR-027).

### 1.3 Guarantees and targets

| Property | Target | Notes |
| --- | --- | --- |
| Server-side query latency | p95 ≤ 120 ms | Embed ≤ 15 ms, search ≤ 10 ms, rerank 30 pairs ≤ 80 ms on 2 vCPU x86-64. Measured by `mdrag eval --bench` (ADR-018) |
| Corpus ceiling | ~100k chunks (~700 MB RSS) | ~5 KB/chunk in RAM plus ~200 MB for runtime and models (A1) |
| Startup | Seconds for ~10k docs | Hash checks and index inserts only; no chunking or embedding |
| Freshness | Deployment restart time | There is no ingest lag inside the engine, because chunks and vectors ship with the content |
| Privacy | The query path never leaves the process | The write path makes no LLM calls in the PoC; any future optional write-time LLM step uses a provider the integrator chooses (ADR-019) |

## 2. PoC Scope

The PoC is the smallest system that proves the idea end to end: an agent gets relevant, cited context from a sample KB, through HTTP or the CLI, within the latency target.

### In scope

1. **Document contract:** loading `*.md` with required frontmatter, collecting validation errors across all files, and computing a document hash over normalised (LF) content.
2. **Sidecar format:** stores the document hash, chunker ID, model ID and chunk records (offsets, breadcrumb, anchor, hash, vector).
3. **Chunker:** the structure-aware splitter. A lean LLM chunker was designed (ADR-024) and then deferred beyond the PoC (ADR-028, §3).
4. **`mdrag embed`:** processes changed documents only, reuses vectors for unchanged chunks, prunes orphaned sidecars, and supports `--rechunk` to force re-chunking.
5. **`mdrag check`:** validates the contract and checks sidecar freshness, with no model and no LLM. Exits non-zero on failure.
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
   - `createHttpHandler(engine)`, so integrators can mount it in their own server, and `mdrag serve`, which runs it standalone
10. **CLI:** `mdrag search "<query>"`, with Markdown output by default and a `--json` option.
11. **Agent setup doc:** a prompt/skill snippet that teaches an agent (e.g. Claude Code) to use the HTTP API or the CLI. It covers when to use each search mode, gives worked request examples, shows the output format, lists what the tool can and cannot do, and tells the agent to search again with a refined query rather than rely on a weak result.
12. **Evaluation:** `mdrag eval` runs golden queries and reports Recall@K, MRR and nDCG@N. `--bench` adds per-stage latency percentiles. Ablation flags (`--no-rerank`, `--mode`) measure what each stage contributes, and `--save` / `--compare` diff against a saved baseline run.
13. **Sample KB and golden queries:** checked into the repo and used by tests, eval and the demo.
14. **Integrator documentation:** the contract, the sidecar format, the commands and the configuration.

### Success criteria

- An agent can answer questions from `examples/kb` through the HTTP API and through `mdrag search`, with correct citations.
- On the sample KB, `mdrag eval` reaches Recall@30 ≥ 0.9 and MRR ≥ 0.7. Thresholds will be revisited once the sample set exists. The eval also shows whether reranking improves results enough to justify its latency.
- `mdrag eval --bench` meets the §1.3 latency target on reference hardware.
- Editing one document and running `mdrag embed` re-processes only that document, and re-embeds only its changed chunks.

## 3. Beyond the PoC

These are deliberately left out of the PoC. Each one is useful but not needed to prove the idea.

| Item | Why deferred |
| --- | --- |
| MCP adapter (a thin wrapper over the library) | The HTTP API, the CLI and a setup doc are enough for agents (ADR-014) |
| Auth (bearer, OIDC, mTLS) and per-user ACLs | An integration concern that belongs at the ingress (ADR-016) |
| LLM chunker: an LLM groups structural blocks into chunks (never rewriting text), instead of the structure-aware splitter | Headings are a hard, deterministic chunk boundary (ADR-011), so it can only add value on documents with no heading structure at all — and even there, packing consecutive blocks to the size target (ADR-011) already covers it without an LLM call. Deferred until eval shows a real gap the splitter can't cover (ADR-024, superseded by ADR-028) |
| Contextual enrichment: an LLM-written document summary and context line per chunk, prepended before embedding | Proven gains, and Onyx ships it on by default (~50-token document summary, ~64-token chunk context). It needs the LLM chunker working first and can come from the same LLM call (ADR-024) |
| Link-graph boost from Markdown links between KB documents | Grapevine boosts documents that many others reference. It could help cross-linked KBs, but it needs link extraction and eval evidence (ADR-026) |
| External embedding and reranking providers | Local models are enough under A1 and A2. The interfaces already allow adding them (ADR-009) |
| Serialised index snapshot for faster startup | Only worth it near the corpus ceiling (ADR-007) |
| Reference GitHub Actions workflow for KB repos (`mdrag embed` on push, `mdrag check` gate, eval regression gate) | An integration concern; the commands make it a few lines of YAML |
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
| A6 | Whoever writes content can run Node.js and `mdrag embed` in their pipeline, and can provide an LLM API key there if a future optional write-time LLM step needs one. |
| A7 | Repository growth from sidecars (~2 KB per changed chunk per commit) is acceptable. |

### Records

**ADR-001 · The engine, not a platform.** The project defines a document contract and does not ingest from sources itself. *Why:* ingestion depends on each company's tools and permissions, and a narrow contract keeps the engine reusable. *Rejected:* built-in Slack/Confluence connectors; webhook-driven GitHub Actions.

**ADR-002 · A Git repository is the only storage.** *Why:* no database to run, and history, review and rollback come for free. *Rejected:* Postgres/pgvector and hosted vector databases (operational cost and a network hop, with no benefit under A1).

**ADR-003 · The contract is Markdown with required YAML frontmatter: `title`, `source` and `updated_at` are required; `url` and `tags` are optional; unknown keys are passed through.** *Why:* `updated_at` is the only reliable input for recency, because Git commit time is wrong after bulk re-exports and file mtime changes on checkout. `url` is the only way back to the original source. `title` and `source` could be derived, but requiring them keeps the contract explicit. Exporter-owned maintenance metadata such as `source_id` and `exported_at` is allowed. Engine-owned metadata lives in sidecars (ADR-005). *Rejected:* optional frontmatter with fallbacks (implicit behaviour that is hard to debug); no frontmatter (no reliable recency); native JSON sources (exporters render them to Markdown instead).

**ADR-004 · A document's identity is its path relative to the KB root.** *Why:* overwriting a file updates the document and deleting it removes the document. Staleness is handled without a separate registry. *Rejected:* an ID field in frontmatter (two sources of identity that can drift apart).

**ADR-005 · Each document has a sidecar at `.vectors/<doc-path>.vec.json` recording `doc_hash`, chunker ID, embedding model ID and its chunks (offsets, breadcrumb, anchor, chunk hash, vector).** *Why:* the document hash makes freshness a trivial comparison that needs no model or chunker. Recording the chunks means non-deterministic chunkers (such as an LLM) are fine, and the server never has to re-chunk. Chunk hashes let unchanged chunks keep their vectors. Offsets instead of copies of the text keep repository growth down (A7). Line endings are normalised to LF before hashing and computing offsets, so the result is the same on Windows and Unix checkouts. There are no timestamps, because they would churn diffs and Git already records history. *Rejected:* one content-addressed file per chunk (many tiny files and a garbage-collection step); sidecars next to each document (clutters the tree exporters own); a copy of the chunk text in the sidecar (duplicates the content); re-chunking at server startup (requires a deterministic chunker, which rules out LLM chunking).

**ADR-006 · The server fails fast if any sidecar is missing, stale (`doc_hash` mismatch) or built with a different embedding model.** *Why:* a KB that breaks the contract must never serve silently degraded results. Under a rolling update, the previous version keeps serving. *Rejected:* embedding or re-chunking at startup (hides pipeline bugs and makes startup time unpredictable).

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

**ADR-017 · Deployment-agnostic: the engine ships as a Node package with a CLI, not as a container image.** *Why:* where and how it runs is up to the integrator. *Rejected:* an official Docker image; baking indexes into images.

**ADR-018 · Latency and quality numbers are measured targets, not claims.** *Why:* the original "< 30 ms" left out query embedding and underestimated the cost of the cross-encoder. *Rejected:* stating guarantees before benchmarking.

**ADR-019 · Data boundary: the query path runs entirely in-process. By default the engine calls no external services. Optional write-time LLM steps use a model the integrator explicitly configures, such as a Claude API key through AI SDK or a local model, within the integrator's own trust boundary.** *Why:* this makes the privacy claim accurate while still allowing internal AI tooling. Deleting a file removes it from the index but not from Git history, and integrators handling PII need their own retention process. *Rejected:* "100% in-house"; "no LLM ever".

**ADR-020 · Toolchain: Node.js 24 LTS; TypeScript executed through native type stripping, with `tsc --noEmit` for type-checking; pnpm; Biome; Vitest.** *Why:* no build step, fast tools, and minimal configuration. *Rejected:* tsc emit or bundlers; ESLint plus Prettier; Bun (native ONNX bindings are less proven on it).

**ADR-021 · The licence is MIT.** *Why:* permissive and compatible with the default models' licences (MIT/Apache-2.0).

**ADR-022 · Query-path models are downloaded from the Hugging Face Hub on first use into a configurable cache directory. Remote fetching can be disabled for air-gapped hosts.** *Why:* keeps model weights out of the repository, and pre-fetching allows offline operation. *Rejected:* vendoring weights in the repo; downloading at every start.

**ADR-023 · Frontmatter is parsed in the same mdast pass as the Markdown (`mdast-util-frontmatter` plus `yaml`) and validated with zod.** *Why:* the Markdown is already parsed with mdast for chunking, and a second parser would be redundant. *Rejected:* gray-matter (last released in 2019, depends on the outdated js-yaml 3).

**ADR-024 · (Superseded by ADR-028 — deferred beyond the PoC; kept as the reference design.) The LLM chunker is lean. The document is first split into structural blocks with IDs. The LLM (AI SDK `generateObject`, Claude Haiku 4.5 by default, temperature 0) returns only groups of consecutive block IDs. The output is validated: it must be complete, ordered, non-overlapping and within the size cap. If validation fails or the call errors, that document uses the splitter. The LLM chunker is used only when a model is configured.** *Why:* grouping by block ID means the LLM can never rewrite or drop text, keeps the output small and cheap, and makes validation trivial. The fallback means a missing key or a failed call never blocks `mdrag embed`. Chunks are recorded in the sidecar (ADR-005), so the LLM's non-determinism doesn't matter. Changing the chunker does not invalidate existing sidecars, and `mdrag embed --rechunk` re-chunks on demand. *Rejected:* the LLM returning chunk text (can alter content and costs more output tokens); LLM-only chunking with no fallback; re-chunking automatically whenever the chunker config changes (an unexpected LLM bill).

**ADR-025 · There is no LLM on the query path.** *Why:* the caller is already an LLM agent that can reformulate its query and search again. Putting LLM calls inside search would add seconds of latency and per-query cost, and would break ADR-019. Onyx's agentic search does use up to 6 LLM cycles (query expansion, then fusing results by rank, then LLM section selection, then LLM expansion), but it serves users who are not themselves agents. *Rejected:* multi-query generation with rank fusion, LLM relevance filtering or section selection, and an `ask_agent`-style endpoint that answers questions (Grapevine).

**ADR-026 · No extra index-time representations in the PoC: no mini-chunks or large chunks with their own embeddings, and no separate title embeddings. The link-graph boost is deferred.** *Why:* each one multiplies index size and write cost, and there's no evidence they help at our scale (A1) with structure-aware chunks and breadcrumbs. Onyx keeps its multi-pass indexing behind a flag. *Rejected:* Onyx multi-pass indexing; separate keyword and vector stores (Grapevine uses OpenSearch plus Turbopuffer, and Orama already combines both).

**ADR-027 · The cross-encoder reranker is kept provisionally and must earn its place in eval.** *Why:* neither reference project uses one on its live path. Grapevine uses a linear blend of scores, and Onyx has cross-encoder code but only runs it at warm-up. It is still the only local precision step we have without an LLM (ADR-025). `mdrag eval --no-rerank` measures what it adds against its ~80 ms. If the gain is marginal, the default becomes off and this ADR is superseded. *Rejected:* dropping it without measuring; replacing it with an LLM (ADR-025).

**ADR-028 · The LLM chunker (ADR-024) is deferred beyond the PoC.** *Why:* the structure-aware splitter treats each heading as a hard, deterministic chunk boundary (ADR-011), the strongest available signal for well-structured Markdown. The LLM chunker's grouping is still constrained to contiguous blocks, so within that rule it cannot improve on the splitter's boundaries without crossing a heading — and crossing one was rejected outright (ADR-011). Its one remaining edge case, content with no heading structure (e.g. chat-style threads), is instead handled by the splitter packing consecutive blocks by size alone when there is no heading to break at (ADR-011), which needs no LLM call. Deferring also drops an LLM dependency, a configured API key and non-deterministic write-time behaviour from the PoC, none of which have proven necessary. *Supersedes:* ADR-024's decision to ship the LLM chunker in the PoC; its design (block-ID grouping, validation, splitter fallback) is kept as the reference design if this is revisited (§3). *Rejected:* shipping it unconditionally as in ADR-024; an always-on evaluation gate like ADR-027 gives the reranker, since here the splitter's heading-boundary rule already explains why it wouldn't earn its place on headed documents.
