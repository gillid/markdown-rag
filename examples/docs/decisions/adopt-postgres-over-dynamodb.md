---
title: "Decision: Adopt Postgres Over DynamoDB for Core Data"
updated_at: "2025-06-01"
tags: [database, infra, decision]
---

# Decision: Adopt Postgres Over DynamoDB for Core Data

## Decision

Core account, payments and webhook data is stored in Postgres (Amazon RDS),
not DynamoDB. DynamoDB remains in use only for the idempotency-key cache,
where its access pattern fits well.

## Why

The core data model is heavily relational: payments reference accounts,
webhooks reference payments, and refunds reference the original charge.
Modeling that in DynamoDB would mean either denormalizing aggressively or
running multiple queries with application-side joins for almost every
request that touches more than one entity. Postgres gives us transactions
across those relationships for free, which matters a lot for anything
touching money.

The team's existing operational experience is also overwhelmingly with
relational databases, which lowers the risk of an operational surprise
compared to adopting a new storage paradigm at the same time as scaling up.

## Rejected alternatives

- **DynamoDB for everything**: rejected for the reasons above; the access
  patterns don't fit a single-table design without significant complexity.
- **Postgres for everything, including the idempotency-key cache**:
  rejected because the idempotency cache is a pure key-value, high-write,
  short-TTL workload that DynamoDB (or Redis) handles more cheaply than
  Postgres at our write volume.
- **A dedicated graph database** for the account/payment relationship
  modeling: rejected as solving a problem we don't have; our relationships
  are shallow and well served by foreign keys.
