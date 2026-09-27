---
name: implement-step-start
description: Start (or resume) work on the next PoC implementation step from docs/implementation.md — picks the next planned item, marks it in-progress, branches off main, and begins implementing it. Use when the user asks to start, pick up, or continue the next implementation step.
disable-model-invocation: true
---

# Implement Step: Start

Follow these steps in order.

1. **Read `docs/implementation.md`.** Find the first item whose status is `planned`, in step-number order. If an item is already `in-progress`, prefer resuming that one instead of starting a new one — ask the user which one they mean if it's ambiguous.

2. **Mark the item `in-progress`.** If its status is still `planned`, edit `docs/implementation.md` to change it to `in-progress`. Skip this edit if it's already `in-progress`.

3. **Sync with `main` and branch.**
   - Check `git status` first; if there are uncommitted changes that aren't part of this step, stop and ask the user.
   - `git checkout main`, `git pull --ff-only origin main` (or the configured remote).
   - Create a new branch off `main` named for the step, e.g. `feat/05-storage-loader` or `chore/03-sample-knowledge-base` — match the prefix to the step's nature (`feat`, `chore`, `docs`, etc.) per `CLAUDE.md`'s conventional-commit scopes.

4. **Read the relevant ADRs.** Skim `docs/design.md` §4 (ADR log) for any ADR referenced by the step's bullet points, so the implementation doesn't contradict a recorded decision.

5. **Start or continue implementing the step**, following the step's bullet points and "Done when" / test criteria verbatim from `docs/implementation.md`. Keep the change scoped to this one step — one step, one PR.

If the item picked in step 1 needs clarification (e.g. its scope depends on a decision not yet made), ask the user before proceeding rather than guessing.
