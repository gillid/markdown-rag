---
title: "Decision: Add a GraphQL Endpoint Alongside REST"
updated_at: "2025-09-15"
tags: [api, decision]
---

# Decision: Add a GraphQL Endpoint Alongside REST

## Decision

Orbitside ships a GraphQL endpoint (`/graphql`) for read-heavy dashboard and
reporting use cases, in addition to the existing REST API. GraphQL does not
replace REST; write operations (creating charges, refunds, webhooks) remain
REST-only.

## Why

Integrators building dashboards were making 4-6 sequential REST calls to
assemble a single account overview page (account, recent charges, recent
refunds, webhook delivery status), each an extra network round trip. A
single GraphQL query collapses that into one request with exactly the
fields the client needs, which matters more for dashboard-style read
patterns than for the transactional write path.

Keeping writes on REST avoids the complexity of designing idempotent
GraphQL mutations and keeps our existing idempotency-key handling
(see [idempotency-keys.md](../api/idempotency-keys.md)) as the single
pattern for write safety, rather than maintaining two.

## Rejected alternatives

- **GraphQL for writes too**: rejected to avoid duplicating idempotency and
  validation logic across two API styles.
- **Replacing REST entirely with GraphQL**: rejected because several
  integrators depend on REST's cacheable, resource-oriented URLs, and a
  full migration was judged not worth breaking them.
- **A dedicated BFF (backend-for-frontend) per dashboard** instead of
  GraphQL: rejected as more code to maintain than a single generic query
  layer.
