---
title: "Idempotency Keys"
source: api
updated_at: "2025-08-19"
url: "https://docs.orbitside.dev/api/idempotency-keys"
tags: [api]
---

# Idempotency Keys

Any `POST` request that creates money-moving state (charges, refunds,
payouts) accepts an `Idempotency-Key` header. Use it so that retrying a
request after a network error or timeout can never create a duplicate
charge.

## Usage

```http
POST /v2/charges HTTP/1.1
Idempotency-Key: 6c3a1e2f-6b3e-4a0a-9f0e-2e6c1f9b7a11
Content-Type: application/json

{ "amount": 4200, "currency": "usd", "customer": "cus_9f8e7d" }
```

Generate a fresh UUID per logical operation, and reuse the exact same key
(and the exact same request body) if you retry that same operation. If a
request with a given key has already succeeded, retrying it with the same
key and body returns the original result without creating a second charge.

## Conflicting reuse

If you send the same `Idempotency-Key` with a *different* request body than
the original request, the API rejects it rather than silently applying
whichever body arrived first, since it cannot tell which one you actually
intended:

```json
{ "error": { "code": "ERR_IDEMPOTENCY_CONFLICT_409" } }
```

## How long keys are remembered

Idempotency keys are stored for 24 hours. After that window, reusing a key
is treated as a brand new request rather than a retry, so it is safe to
reuse UUIDs that were only ever used more than 24 hours ago, though
generating a fresh one is simpler than tracking that.

## Which endpoints require it

`POST /v2/charges`, `POST /v2/refunds` and `POST /v2/payouts` all require an
`Idempotency-Key`; requests to these endpoints without one are rejected.
Read-only `GET` endpoints and `POST /v2/customers` (creating a customer
record, which is not money-moving) do not require it, though you may still
send one if convenient for your client library.
