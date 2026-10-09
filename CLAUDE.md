# CLAUDE.md

An open-source engine that serves a Git repository of Markdown files to AI agents. It combines in-memory hybrid search (BM25 + vectors) with local reranking, and has no database and no external services on the query path. Chunks and vectors are precomputed at write time into per-document sidecars. Read [docs/design.md](docs/design.md) before making non-trivial changes.

## Tech Stack

- **Runtime:** Node.js 24 LTS, ESM. TypeScript runs directly through native type stripping (no build step in development), with `tsc --noEmit` for type-checking only. Use erasable syntax only: no `enum`, no `namespace`, no parameter properties. Sidecar vectors use Node 24's native `DataView` float16 methods (ADR-033), so the `tsconfig.json` `lib` includes `ESNext.Float16`.
- **Package manager:** pnpm
- **Distribution:** one npm package, `markdown-rag`, whose binary is `markdown-rag`. `tsc` emits JS and `.d.ts` into `dist/` only at pack time (`prepack`, ADR-030); `publishConfig` points `bin` and `exports` at `dist/`, while in the repo they point at the `.ts` sources. Merging to `main` a `package.json` whose `version` isn't on npm yet publishes it and tags `v<version>` through `.github/workflows/publish.yml` (npm trusted publishing, ADR-043).
- **Search:** `@orama/orama` (in-process hybrid index) with `@orama/stopwords` for the English BM25 stopword list
- **Query-path models (local):** `@huggingface/transformers` on `onnxruntime-node`. The embedder is `Xenova/bge-small-en-v1.5` and the reranker is `Xenova/ms-marco-MiniLM-L-6-v2` (q8).
- **Parsing and validation:** `mdast-util-from-markdown`, `mdast-util-frontmatter`, `mdast-util-gfm-table` (tables are parsed as tables), `mdast-util-to-string`, `yaml`, `zod`
- **HTTP:** `node:http`, with no framework
- **Tooling:** Biome (lint and format), Vitest (tests), Lefthook (git hooks)

## Commands

Keep this list in sync with `package.json`.

| Command | Purpose |
| --- | --- |
| `pnpm install` | Install dependencies |
| `pnpm markdown-rag <cmd>` | Run the CLI: `embed`, `check`, `overview`, `search`, `list`, `get`, `serve`, `eval` |
| `pnpm start` | `markdown-rag serve` (HTTP API) with the configured storage |
| `pnpm lint` / `pnpm lint:fix` | Biome check / apply fixes and formatting |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Unit tests; no model downloads and no LLM calls |
| `pnpm test:models` | Model-backed tests (`*.models.test.ts`); downloads models on first run |
| `pnpm build` | Emit JS and `.d.ts` into `dist/` (also runs from `prepack`) |
| `pnpm test:pack` | Pack the tarball, install it in a temp directory and smoke-test the binary and types; needs network for `npm install` |

Before reporting work as done, run `pnpm lint:fix`, `pnpm typecheck` and `pnpm test`.

`pnpm install` runs `lefthook install` (via the `prepare` script), which wires up a pre-commit hook that runs Biome (`--write`, restaging fixes) on staged files and `pnpm typecheck` on the whole project. See `lefthook.yml`.

## Practices

- **Every behaviour change is checked against its ADR.** If a change contradicts a decision in `docs/design.md` §4, update or supersede that ADR in the same PR.
- **One step, one PR.** Work follows `docs/implementation.md`. Set the step's status (`planned` → `in-progress` → `done`) in the same PR.
- **Sidecars are the contract between the write path and the read path.** A sidecar is fresh if and only if its `doc_hash` matches its document, its chunker ID and embedding model match the ones all sidecars share, its vectors decode, and its chunks match the document text (ADR-006, ADR-039). Sidecar output must be byte-stable. Stale sidecars must fail fast and must never be patched over at runtime.
- **Engine-owned files live only in `targetDir`** (default `<sourceDir>/.markdown-rag/`: sidecars and model cache). Every file in it is generated; never add a hand-edited one, and never write anywhere else in a knowledge base (ADR-031, ADR-037).
- **A release is a `version` bump merged to `main`.** Never push a tag by hand and never bump `version` unless the PR is meant to ship (ADR-043).
- **Sidecars are never committed.** The whole engine folder is git-ignored, and `markdown-rag embed` regenerates it before serving; tests generate sidecars into a temporary `targetDir` (ADR-038).
- **No environment variables.** Configuration arrives only through CLI flags or the object passed to `createEngine`; there is no config file. The embedding model comes from the sidecars (ADR-032).
- **Neither path makes network calls.** The only network access is downloading model weights into the cache.
- **The library API is the extension point.** Advanced layers compose on `createEngine()`. Don't add plugin or hook systems.
- **Tests use the `examples/docs` fixture and golden queries.** Expected values come from hand-written literals or worked examples. Model-dependent assertions go in `*.models.test.ts`.
- **Paths:** document identity uses POSIX paths relative to the knowledge base root. Line endings are normalised to LF before hashing.

## References

| What | Where |
| --- | --- |
| Idea, PoC scope, what's deferred, ADR log | `docs/design.md` |
| Step-by-step PoC plan with statuses | `docs/implementation.md` |
| PR review checklist (used by the automated review routine) | `REVIEW.md` |
| Document contract and sidecar format (for exporters) | `docs/contract.md` (planned, step 24) |
| Agent setup note, and the working guide that ships in the package | `docs/agent-setup.md`, `docs/agent-guide.md` |
| Benchmark and chunker comparison | `docs/benchmarks.md` (planned, steps 22–23) |
| Sample knowledge base and golden queries | `examples/docs/`, `examples/eval/` (planned, steps 3, 21) |
| CLI entry and subcommands | `src/cli/` |
| Pack-time emit config and the packed-tarball smoke test | `tsconfig.build.json`, `scripts/pack-smoke.ts` |
| Release workflow (a new `version` merged to `main` publishes to npm and tags it) | `.github/workflows/publish.yml` |
| Runtime config | `src/config/` |
| Storage loading and contract validation | `src/contract/` |
| Sidecar format, freshness, `markdown-rag embed` | `src/sidecars/` |
| Chunker (structure-aware splitter) | `src/chunking/` |
| Embedder and reranker | `src/models/` |
| Orama index and candidate search | `src/index/` |
| Retrieval pipeline (rerank, recency, tag weights, cutoff) | `src/retrieval/` |
| Ranking weights (recency, tag boosts and penalties, the 0.5 cap) | `docs/weights.md` |
| Library API (`createEngine`, `createHttpHandler`, schemas) | `src/engine/` |
| HTTP handler (`createHttpHandler`), server and `Host`/body checks | `src/http/` |
| `markdown-rag serve` | `src/cli/serve.ts` |
| Eval and benchmarks | `src/eval/` |
| Orama docs | https://docs.orama.com |
| transformers.js docs | https://huggingface.co/docs/transformers.js |

## Keeping Docs Current

When you change the stack, commands, practices, module layout or a design decision, update this file, `docs/design.md` (including the ADR log) and `docs/implementation.md` in the same change. A stale doc is treated as a bug.
