---
title: "API Changelog"
source: api
updated_at: "2026-08-25"
url: "https://docs.orbitside.dev/api/changelog"
tags: [api]
---

# API Changelog

> Heads up: entries older than 12 months are archived to the developer
> portal and no longer shown on this page.

## 2026-08-25 — Multi-currency support for EU customers

Charges can now be created in additional currencies for customers billed in
the EU:

- Added support for €, £ and additional ISO-4217 currencies beyond USD.
  - Amounts are still expressed in the smallest unit of the currency (for
    example, cents for EUR, pence for GBP), matching existing USD
    behavior.
  - Refunds must use the same currency as the original charge, per
    `ERR_VALIDATION_CURRENCY_MISMATCH_422`.
- Existing integrations that assume USD-only will continue to work
  unchanged; the new currencies are opt-in per charge request.

Before:

```
{ "amount": 4200, "currency": "usd" }
```

After (unchanged shape, new currency values accepted):

```
{ "amount": 4200, "currency": "eur" }
```

## 2026-06-01 — GraphQL endpoint generally available

The `/graphql` endpoint, previously in closed beta, is now available to all
accounts. See
[use-graphql-for-public-api.md](../decisions/use-graphql-for-public-api.md)
for the reasoning behind adding it.

## 2026-02-14 — Cursor pagination replaces offset pagination

- All list endpoints now return `next_cursor` instead of accepting `offset`.
  - `offset` is still accepted for one more release for backward
    compatibility, but is ignored if `cursor` is also present.
  - New integrations should use `cursor` exclusively; see
    [pagination.md](pagination.md).

## 2025-09-15 — Idempotency keys required for payouts

`POST /v2/payouts` now requires an `Idempotency-Key` header, matching the
existing requirement on charges and refunds.
