---
title: "Decision: Tiered Public API Rate Limits"
updated_at: "2026-08-01"
tags: [api, rate-limiting, decision]
---

# Decision: Tiered Public API Rate Limits

**Status:** Current. Supersedes
[0001-initial-rate-limits.md](0001-initial-rate-limits.md).

## Decision

Rate limits are now tiered by plan, enforced with a sliding one-minute
window per API key:

| Plan | Requests / minute | Burst allowance |
| --- | --- | --- |
| Starter | 300 | 50 |
| Growth | 1,000 | 200 |
| Enterprise | 5,000 | 1,000 |

The flat 100 requests/minute limit from the original 2023 policy is
retired for all plans, including Starter, which now gets a strictly higher
limit than the original flat policy.

## Why

Three years of production data showed the flat limit under-served larger
integrators while doing little to protect against the actual failure mode
we cared about, which was a small number of misbehaving clients in retry
storms rather than legitimate high-volume usage. A sliding window also
smooths out the edge-of-window burst problem the fixed window had, where a
client could send 100 requests in the last second of one window and another
100 in the first second of the next.

Burst allowances were added after support tickets showed legitimate clients
being throttled during brief, expected spikes (for example, a batch job
kicking off) even though their sustained rate was well under the limit.

## Rejected alternatives

- **Raising the flat limit instead of tiering**: rejected because it would
  have under-protected the gateway against Enterprise-scale misbehaving
  clients while still being needlessly generous to low-volume clients.
- **Token-bucket per endpoint**: rejected pending evidence from
  [rate-limit-incident-runbook.md](../runbooks/rate-limit-incident-runbook.md)
  incidents that any specific endpoint needs its own limit.
- **Usage-based dynamic limits**: interesting for the future but too complex
  to ship alongside this migration; tracked as a follow-up, not part of this
  decision.

## Rollout

Existing clients are moved to their plan's new limit automatically; no
action is required on their side. The change is backward compatible in the
sense that no client's limit decreases.
