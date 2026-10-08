---
title: "Decision: Deprecate the v1 REST API"
updated_at: "2026-05-01"
tags: [api, decision]
---

# Decision: Deprecate the v1 REST API

## Decision

The `v1` REST API is deprecated as of this decision and will be removed 12
months from this date. All new integrations must use `v2`. Existing `v1`
integrators are notified via email and a banner in the developer dashboard.

## Why

`v1` predates idempotency keys, cursor-based pagination and the tiered rate
limits described in
[0002-revised-rate-limits.md](0002-revised-rate-limits.md). Maintaining
feature parity across both versions has become a meaningful maintenance
tax, and several production incidents have traced back to behavioral
differences between the two versions that were easy to miss during code
review.

A 12-month window was chosen based on usage data showing that most active
`v1` integrators would need 6-9 months to migrate at a typical pace, with
margin added for integrators who have not yet started.

## Rejected alternatives

- **Immediate removal**: rejected as unacceptably disruptive to integrators
  with production traffic on `v1`.
- **Indefinite support for both versions**: rejected because the ongoing
  maintenance and incident-risk cost was judged higher than the migration
  cost imposed on integrators.
- **A shorter 6-month window**: rejected as insufficient based on the usage
  data showing typical migration effort.

## Migration support

The developer relations team will reach out directly to the top 20
`v1` integrators by volume to offer migration assistance. A migration guide
mapping each `v1` endpoint to its `v2` equivalent is published alongside
this decision.
