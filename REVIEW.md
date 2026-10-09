# REVIEW.md

Checklist for automated and human PR review of markdown-rag. Rules here are drawn from `CLAUDE.md` and the ADR log in `docs/design.md` §4 — this file doesn't invent new rules, it makes the existing non-negotiables checkable against a diff. If a rule here and the source doc ever disagree, the source doc wins and this file is stale.

## Non-negotiable rules

### Design and process

- **ADR consistency.** Any behavior change must be checked against `docs/design.md` §4 (the ADR log). If the diff contradicts a decision recorded there, the PR must update or supersede that ADR in the same PR — a behavior change with no matching ADR update is a violation.
- **Step status.** Work follows `docs/implementation.md`. A PR implementing a step must set that step's status (`planned` → `in-progress` → `done`) in the same PR.
- **No speculative docs.** Deferred/future work belongs only in `docs/design.md` §3 ("Beyond the PoC") and its ADR — never as TODOs, speculative code paths, or half-built features scattered elsewhere.
- **Docs kept current.** If the diff changes the stack, commands, practices, module layout, or a design decision, `CLAUDE.md`, `docs/design.md` (including the ADR log), and `docs/implementation.md` must be updated in the same PR. A stale doc is a bug.

### Sidecar and storage contract

- **Freshness rule.** A sidecar is fresh iff its `doc_hash` matches its document and its embedding model matches the one all sidecars share (ADR-006, ADR-032). Nothing should patch a stale sidecar at runtime or make the read path tolerate staleness — it must fail fast.
- **Byte-stable output.** Sidecar writers must produce byte-stable output for unchanged input (ADR-005, ADR-038) — no timestamps, non-deterministic key ordering, or other churn baked into sidecar content.
- **Engine-owned files stay in `targetDir`.** Nothing the engine writes may land outside `targetDir` (default `<sourceDir>/.markdown-rag/`), and nothing in `targetDir` should be hand-edited or assumed pre-existing (ADR-031, ADR-037).
- **Sidecars are never committed.** No change should commit anything under the engine folder, remove it from `.gitignore`, or make `markdown-rag embed` optional before serving (ADR-038).
- **Paths and hashing.** Document identity is a POSIX path relative to the knowledge base root; line endings are normalized to LF before hashing or computing offsets (ADR-004, ADR-005). Flag any path handling that uses OS-native separators or hashes un-normalized content.

### Configuration and boundaries

- **No environment variables.** Configuration must arrive only through CLI flags or the object passed to `createEngine` — flag any new `process.env` read in engine code (ADR-032).
- **No network calls on the query or write path** beyond downloading model weights into the cache (ADR-019, ADR-022).
- **HTTP stays on `node:http`, no framework.** The HTTP layer is a thin wrapper over the library with no unneeded dependency added for routing or middleware (ADR-014).
- **No plugin/hook systems.** The library API (`createEngine()`) is the sole extension point; flag any new plugin, hook, or middleware mechanism (per "The library API is the extension point" in `CLAUDE.md`).
- **Embedding model is not configurable outside sidecars.** `embed` always uses the engine's preset; `check`/`search`/`serve` must read the model from the sidecars, never a flag or config value (ADR-032).

### Language and tooling

- **Erasable TypeScript syntax only.** No `enum`, no `namespace`, no parameter properties — flag any use since these can't be stripped without a build step (ADR-020).
- **No `as` casts in production code.** Flag any `as` type assertion under `src/` (casts in tests are fine) unless the PR explains why it is unavoidable. Prefer type guards, narrowing, `satisfies` or fixing the types; `isErrnoException` and `errorMessage` in `src/errors.ts` cover the common `catch` cases. `as const` and `import * as` are not type assertions.

### Tests

- **Fixture and golden queries.** Tests should use the `examples/docs` fixture and golden queries, not ad hoc fixtures, unless there's a specific reason noted in the PR.
- **Independent expected values.** Expected values must come from a hand-written literal or worked example — flag any test that recomputes the expected value the same way the code under test does (e.g. `expect(chunk(x)).toEqual(chunker(x))`).
- **Model-dependent tests are isolated.** Any assertion that depends on model output (embeddings, reranking, downloads) belongs in `*.models.test.ts`, not `pnpm test`'s default suite.

## General code quality

- **Comments:** only for a non-obvious WHY — a hidden constraint, a workaround, a surprising invariant. Flag comments that restate what the code does, or that reference the current PR/task/issue.
- **Structure:** new code should prefer multiple small, focused files grouped by meaningful unit over one large file — but don't flag a file for not being split further than the task warrants, and don't flag refactors of existing files outside the PR's stated scope.
- **Smells (Fowler):** duplicated code (extract the shared shape), feature envy (move the function onto the data it envies), primitive obsession (give the domain concept its own type), speculative generality (delete abstractions for needs that don't exist yet), shotgun surgery (gather what changes together into one module).
- **No re-exports.** Don't re-export a symbol through a module that doesn't otherwise use it, including `export type { X }` added "for convenience" — flag any re-export with no consumer that actually imports through that path. Importers should reach for the symbol's owning module directly.

## Out of scope for this review

- Pure formatting and style issues Biome already enforces (`pnpm lint` / `pnpm lint:fix`) — don't comment on them.
- Type errors `tsc --noEmit` would already catch — assume `pnpm typecheck` passed; don't re-derive type issues from reading the diff unless they look like something the type checker would miss (e.g. `any`-typed escape hatches).
- Commit message formatting/conventions — not part of the diff content.
