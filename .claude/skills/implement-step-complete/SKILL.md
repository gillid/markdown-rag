---
name: implement-step-complete
description: Finish the implementation step currently in progress — marks it done in docs/implementation.md, reconciles docs/design.md if decisions changed, then pushes the branch and opens a PR. Use when the user says a step is finished, ready, or asks to wrap up and open a PR.
disable-model-invocation: true
---

# Implement Step: Complete

Follow these steps in order.

1. **Identify the current step.** Find the item in `docs/implementation.md` marked `in-progress`. If none is marked `in-progress`, or more than one is, ask the user which step this PR completes.

2. **Verify before marking done.** Run `pnpm lint:fix`, `pnpm typecheck` and `pnpm test` (per `CLAUDE.md`); resolve any failures first. Confirm the step's own "Done when" / test criteria in `docs/implementation.md` are actually met — don't mark it done otherwise.

3. **Review the diff.** Run `/code-review high` against the full diff for this step (against `main`, not just the last commit). Apply the findings — including nits — and re-run step 2's checks if the fixes touch code. This runs locally, before the PR exists, so round-trips are cheap; the goal is to not lean on GitHub review rounds to find what a local pass already would.

4. **Mark the item `done`** in `docs/implementation.md`.

5. **Reconcile docs.** Compare what was actually built against `docs/design.md` (scope, ADR log) and the step's own bullet points in `docs/implementation.md`:
   - If an ADR's decision changed or a new one was made, update or supersede it in `docs/design.md` §4 in this same change (per `CLAUDE.md`: "Every behaviour change is checked against its ADR").
   - If the plan's bullet points no longer match what was built (scope shrank, grew, or moved to a later step), update them.
   - **If it's unclear whether a divergence is a real decision change or just an implementation detail, ask the user before editing `docs/design.md`.**

6. **Commit any doc or code changes** from steps 3–5 that aren't already committed, following `CLAUDE.md`'s commit conventions (conventional commit subject with scope, split into logical commits, `Co-Authored-By` trailer) — only if the user hasn't asked you to hold off on committing.

7. **Ask whether this PR is a release.** Merging to `main` publishes to npm and tags `v<version>` whenever `package.json`'s `version` isn't on npm yet (`.github/workflows/publish.yml`, ADR-043). So a bump of `version` in a PR is a release, and a PR that leaves it alone releases nothing. If the step changes what the published package does for consumers, ask the user whether to bump `version` in this PR (semver; `0.x` while the contract is unstable) and make it a separate `chore(release): <version>` commit. Never bump it without asking, and never create or push a tag by hand.

8. **Push and open a PR.**
   - Push the current branch to the remote (`git push -u origin <branch>`).
   - Open a PR with `gh pr create`, using the sections from `.github/PULL_REQUEST_TEMPLATE.md` (Scope, Implementation, Key decisions). Title it after the step, e.g. `feat(storage-loader): add storage loader and document contract (step 5)`.
   - Report the PR URL back to the user.
