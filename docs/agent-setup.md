# Agent setup

An agent needs two things to use a knowledge base served by markdown-rag: a short note in its standing context that says what the tool is and where to learn more, and a working guide it reads when it decides to use the tool. This page holds the note. The guide is [agent-guide.md](agent-guide.md), which the package ships.

Every consumer of the package has the same interface, so the note needs no adapting beyond its two placeholders.

## Prepare the knowledge base

Run `markdown-rag embed --source-dir <kb>` once, and again after the documents change. A query against missing or stale sidecars fails fast and says to run `embed`.

## The note

Paste this into the agent's `CLAUDE.md`, `AGENTS.md` or an equivalent file, or save it as a skill whose description says what the knowledge base covers.

````markdown
## Knowledge base

`<kb>` holds a knowledge base of Markdown documents that you can query with `markdown-rag` (use `npx markdown-rag` if it isn't installed). It offers ranked search over the documents, listing them by tag, directory or date, and reading a whole document or one section. It only reads, and it knows only what is in those documents.

Check it when a question may be covered by them, before you answer from memory, and say so when it has nothing on the topic. Before the first query, read `<guide>`; for the flags of a command (`overview`, `search`, `list`, `get`), run `markdown-rag <command> --help`.
````

Replace the two placeholders:

- `<kb>`: the path of the knowledge base, as the agent should pass it to `--source-dir`. If the engine folder isn't `<kb>/.markdown-rag/`, say which `--target-dir` to use as well.
- `<guide>`: where the agent can read the working guide. When `markdown-rag` is a dependency of the project, that is `node_modules/markdown-rag/docs/agent-guide.md`. When the tool runs only through `npx`, the package isn't on disk, so copy `agent-guide.md` into the repository and give its path (or give a link to the file at the version in use).

To describe what the knowledge base covers, add one sentence to the note (for example "the engineering handbook and runbooks"), so the agent knows when it is worth checking.
