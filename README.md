# markdown-rag

Give your AI agents search over a Git repository of Markdown files. No database, no external services: hybrid search (keywords plus embeddings) and reranking run locally, in-process, and return a few cited snippets per query.

## Quick start

Requires Node.js 24 or later.

```sh
# 1. Prepare the knowledge base (downloads the models on first run)
npx markdown-rag embed --source-dir ./docs

# 2. Ask it something
npx markdown-rag search "how do I roll back a bad deploy?" --source-dir ./docs
```

`embed` writes its generated files to `./docs/.markdown-rag/`. Git-ignore that folder and re-run `embed` whenever the Markdown changes; only changed documents are processed again.

## Your documents

Every `.md` file starts with a little frontmatter:

```markdown
---
title: "Rollback a Bad Deploy"
updated_at: "2026-07-15"
tags: [runbook, process]
---

Run `orbitctl deploy rollback --service=<name>` to revert to the previous release.
```

`title`, `updated_at` and `tags` are required (`tags` may be an empty list). Any other key is kept as pass-through metadata. `npx markdown-rag check --source-dir ./docs` validates the files and tells you what to fix.

## Four operations

| Operation | Use it to |
| --- | --- |
| `overview` | Learn which tags exist, before filtering |
| `search` | Answer a question with ranked, cited snippets |
| `list` | Enumerate documents or find what changed recently |
| `get` | Read a whole document or one section, by the `ref` that `search` and `list` print |

The same four are available three ways. Every command takes `--help`.

### Command line

```sh
npx markdown-rag overview --source-dir ./docs
npx markdown-rag search "rate limit errors" --source-dir ./docs --tag runbook --limit 5
npx markdown-rag list --source-dir ./docs --since 2026-07-01 --sort updated_at
npx markdown-rag get runbooks/rollback-a-bad-deploy.md --source-dir ./docs
```

Add `--json` for machine-readable output.

### HTTP

```sh
npx markdown-rag serve --source-dir ./docs --port 3000
```

```sh
curl -X POST localhost:3000/search \
  -H 'Content-Type: application/json' \
  -d '{"query": "rate limit errors", "limit": 5}'
```

Also `GET /overview`, `GET /documents` and `GET /documents/{ref}`. `GET /healthz` and `GET /readyz` are for orchestrators. The server listens on `127.0.0.1` only and has no authentication, so put your own network controls in front before exposing it.

### Library

```sh
npm install markdown-rag
```

TypeScript projects also need `@types/node` (version 24 or later), which the handler's types refer to.

```ts
import { createEngine } from "markdown-rag";

const engine = await createEngine({ sourceDir: "./docs" });
const { results } = await engine.search({ query: "rate limit errors", limit: 5 });
```

`createHttpHandler(createEngine({ sourceDir: "./docs" }))` (also imported from `markdown-rag`) takes the engine promise (so you can mount it before the models have loaded) and returns a plain `(req, res)` handler for your own server.

## Ranking

Results are ordered by relevance, and you can nudge the order toward newer documents or boost and penalise documents by tag. See [docs/weights.md](docs/weights.md).

## Using it from an agent

Tell your agent to run `overview` first, filter with what it learned, then `search` or `list`, then `get` to read the full text. [docs/agent-setup.md](docs/agent-setup.md) has a short note to paste into its instructions, and the package ships a working guide for it to read, `docs/agent-guide.md`.

## License

MIT
