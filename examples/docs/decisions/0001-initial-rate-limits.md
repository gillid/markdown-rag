---
title: "Decision: Initial Public API Rate Limits"
source: decision
updated_at: "2023-02-10"
tags: [api, rate-limiting]
---

# Decision: Initial Public API Rate Limits

**Status:** Superseded by
[0002-revised-rate-limits.md](0002-revised-rate-limits.md).

## Decision

Every API client is limited to 100 requests per minute, enforced with a
fixed one-minute window per API key. There are no separate tiers; every
client gets the same limit regardless of plan.

## Why

At launch we have a small number of integrators and no usage data to base
tiered limits on. A single flat limit is simple to implement and simple to
explain in the documentation. 100 requests per minute is roughly 3x the peak
observed usage of our largest design-partner integration, which gives
comfortable headroom without the risk of a single client overwhelming the
gateway.

## Rejected alternatives

- **No rate limiting at launch**: rejected because a single misbehaving
  integrator's retry loop could otherwise degrade the gateway for everyone.
- **Per-endpoint limits**: rejected as unnecessary complexity before we have
  evidence that any specific endpoint is disproportionately expensive.
