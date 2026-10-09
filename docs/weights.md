# Ranking weights

Weights let you reorder search results using more than relevance: newer documents can rank higher, a curated page can outrank a chat thread, and a noisy source can be pushed down. The decision record is ADR-034 and ADR-045 in [design.md](design.md).

## How a result is scored

Every search result starts with a **relevance** score: how well the chunk answers the query, as judged by the local reranker. Weights then add nudges on top. There are two kinds:

- **Recency:** a bonus for newer documents. It halves every `halfLifeDays` (90 by default), measured from the document's `updated_at`. A document dated in the future counts as brand new.
- **Tags:** a bonus or a penalty for documents that carry a tag you gave a weight.

Each nudge has a weight that says how much of the final score it controls. Whatever share the nudges take is taken away from relevance, so with nudges worth 30% of the score, relevance is worth the other 70%.

## The cap

Nudges can never outweigh relevance. The recency weight plus the largest tag weight (by size, ignoring sign) must be at most **0.5**, so relevance always keeps at least half of the score. A bigger total is a validation error.

Two things follow from this:

- A tag moves a result's score by at most its weight, so a boost against a penalty can swing two results by up to twice the largest tag weight. A boosted weaker match can overtake a better one when their relevance is closer than that swing: with `tag:runbook = 0.2`, a runbook chunk with relevance `0.3` (final `0.44`) outranks a plain chunk with relevance `0.5` (final `0.40`). Keep tag weights small if relevance should usually decide.
- `min_score` compares against relevance, not the final score. A document that is not relevant is dropped however heavily it is boosted, so weights only reorder results that already passed the cutoff.

## Setting weights

Weights are a map from a name to a number:

| Name | Range | Effect |
| --- | --- | --- |
| `recency` | 0 to 1 | Bonus for newer documents. Defaults to `0.15`. |
| `tag:<tag>` | -1 to 1 | Boost (positive) or penalty (negative) for documents with that tag. |

Any other name is an error. So is a `tag:<tag>` weight for a tag that no indexed document carries, so a typo fails loudly instead of silently ranking nothing. `md-rag overview` lists the tags that exist.

Two consequences to know about:

- **The default recency weight uses part of the cap.** Unless you set `recency`, it is `0.15`, so a tag weight above `0.35` is rejected until you lower recency too, for example `--weight recency=0 --weight tag:runbook=0.4`. The error message shows both numbers.
- **A configured tag must exist in the knowledge base.** The check is made when the engine starts, against the documents it loaded, so `serve` opens its port and loads the models before it reports a typo. It also means that if a re-export removes the last document with a weighted tag, a deployment configured with that weight refuses to start until you remove the weight. That is the intended trade-off for failing loudly.

You can set weights in two places, and a request overrides the deployment key by key:

```ts
// Deployment defaults
const engine = await createEngine({
  sourceDir: "./docs",
  retrieval: { weights: { recency: 0.1, "tag:runbook": 0.2, "tag:slack": -0.1 } },
});

// One request: changes only tag:slack, the other defaults stay
await engine.search({ query: "rotate signing keys", weights: { "tag:slack": 0 } });
```

```sh
npx markdown-rag search "rotate signing keys" --source-dir ./docs \
  --weight recency=0.1 --weight tag:runbook=0.2 --weight tag:slack=-0.1
```

The CLI splits `--weight` at the first `=`, so it cannot weight a tag whose name contains `=`; set such a weight through HTTP or the library. `md-rag serve` takes the same repeatable `--weight` flag for the deployment's defaults. Over HTTP, send the same map as `weights` in the `POST /search` body to override them for one request. Setting a weight to `0` switches that nudge off; `recency: 0` turns recency off.

## How tags combine

A tag weight is a boost or a penalty, and a document can carry several tags. The rules:

1. A document uses only **one** of its weighted tags: the one with the largest weight by size, ignoring sign. Weights of several tags are never added up, so a document with many tags cannot collect an unbounded bonus.
2. On an exact tie in size, the penalty wins.
3. A document with none of the weighted tags gets no adjustment from tags. Its relevance share still shrinks by the same amount as every other document's, so the comparison stays fair.
4. The cap counts the strongest tag weight once. Five tags weighted at `0.2` cost `0.2` against the cap, not `1.0`.

## Example

Four documents answer the same question equally well, with relevance `0.5` each and the same date:

| Document | Tags |
| --- | --- |
| `plain.md` | none |
| `runbook.md` | `runbook` |
| `slack.md` | `slack` |
| `both.md` | `runbook`, `slack` |

With `tag:runbook = 0.2`, `tag:slack = -0.1` and recency off, the strongest tag weight is `0.2`, so relevance keeps 80% of the score. Each final score is 80% of the relevance plus the document's tag adjustment:

| Document | What happens | Final |
| --- | --- | --- |
| `plain.md` | no weighted tag | 0.40 |
| `runbook.md` | boosted by `0.2` | 0.60 |
| `slack.md` | penalised by `0.1` | 0.30 |
| `both.md` | `runbook`'s `0.2` is larger than `slack`'s `0.1`, so only the boost applies | 0.60 |

The order is `runbook`, `both`, `plain`, `slack`: the curated page outranks the chat thread. If the slack thread were a much better match (relevance `0.9` against `0.3`), it would still win, at `0.8 × 0.9 − 0.1 = 0.62` against `0.8 × 0.3 + 0.2 = 0.44`. With a smaller gap (`0.5` against `0.3`) the runbook would win, `0.44` against `0.8 × 0.5 − 0.1 = 0.30`.

Adding `recency = 0.1` makes relevance keep 70% (100% minus 10% for recency minus 20% for the strongest tag). Each document then also earns up to `0.1` for freshness. The cap check is `0.1 + 0.2 = 0.3`, which is valid.

## Reading a result's scores

Every search result reports how it was scored under `scores`:

| Field | Meaning |
| --- | --- |
| `relevance` | The reranker's judgement, from 0 to 1. This is what `min_score` compares against. Without a reranker it is relative to the best candidate. |
| `signals.recency` | The recency value, from 0 to 1. Present while `recency` has a weight. |
| `signals.tags` | The tag adjustment as a fraction of the strongest tag weight, from -1 (the full penalty) to 1 (the full boost). Present while any tag has a weight. |
| `final` | The blended score the results are ordered by. A penalised result can fall below 0. |

Check these first when a result ranks somewhere surprising.
