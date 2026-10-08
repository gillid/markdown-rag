---
title: "Error Reference"
updated_at: "2026-08-20"
tags: [api]
---

# Error Reference

Every error response from the Orbitside API follows the same shape:

```json
{
  "error": {
    "code": "ERR_SOME_ERROR_CODE_XXX",
    "message": "Human-readable description",
    "request_id": "req_8f3a1c9e"
  }
}
```

Always include the `request_id` when contacting support about a specific
failed request; it lets us pull the exact request from our logs without
you needing to describe the timing or payload. This page catalogs every
error code the API can return, grouped by category.

## Authentication errors (401, 403)

### `ERR_AUTH_MISSING_TOKEN_401`

No `Authorization` header was present on the request. Every endpoint except
`GET /healthz` requires authentication.

### `ERR_AUTH_INVALID_TOKEN_401`

The bearer token does not match any known API key or OAuth access token. If
you recently rotated a key, confirm you're using the new one; see
[authentication.md](authentication.md).

### `ERR_AUTH_EXPIRED_TOKEN_401`

An OAuth access token's one-hour lifetime has passed. Exchange the refresh
token for a new access token rather than retrying with the expired one.

### `ERR_AUTH_INSUFFICIENT_SCOPE_403`

The token is valid but was not granted the OAuth scope this endpoint
requires. Re-run the authorization flow requesting the additional scope.

### `ERR_AUTH_KEY_REVOKED_401`

The API key was explicitly revoked, either by you from the dashboard or
automatically after being flagged as leaked.

## Validation errors (400, 422)

### `ERR_VALIDATION_MISSING_FIELD_400`

A required field was absent from the request body. The `message` field
names the specific missing field.

### `ERR_VALIDATION_INVALID_TYPE_400`

A field was present but of the wrong type, for example a string where an
integer was expected.

### `ERR_VALIDATION_UNKNOWN_FIELD_422`

The request body contained a field the API doesn't recognize. This is
returned rather than silently ignored, since an unrecognized field is
usually a client-side typo that would otherwise fail silently.

### `ERR_VALIDATION_AMOUNT_TOO_SMALL_422`

A charge or refund amount was below the minimum (currently 50 cents in any
supported currency, to stay above typical card-network minimums).

### `ERR_VALIDATION_CURRENCY_MISMATCH_422`

A refund's currency did not match the original charge's currency. Refunds
must always be issued in the same currency as the original charge.

## Idempotency errors (409)

### `ERR_IDEMPOTENCY_CONFLICT_409`

The same `Idempotency-Key` was reused with a different request body than
the original request that used that key. See
[idempotency-keys.md](idempotency-keys.md) for the full behavior.

### `ERR_IDEMPOTENCY_IN_PROGRESS_409`

A request with this `Idempotency-Key` is already being processed
concurrently. This can happen if a client retries very quickly, before the
first attempt has finished. Wait briefly and retry with the same key.

## Rate-limit errors (429)

### `ERR_RATE_LIMIT_EXCEEDED_429`

Your API key has exceeded its plan's requests-per-minute limit. See
[rate-limits.md](rate-limits.md) for the limits by plan and how to avoid
this.

### `ERR_RATE_LIMIT_CONCURRENT_EXCEEDED_429`

Your API key has too many requests in flight at once. This is a separate
limit from the requests-per-minute limit, and is currently fixed at 50
concurrent requests regardless of plan.

## Payment processing errors (402, 502)

### `ERR_PAYMENT_CARD_DECLINED_402`

The card issuer declined the charge. The `message` field includes the
decline reason where the issuer provides one (`insufficient_funds`,
`do_not_honor`, `fraud_suspected`, and others); many issuers return only a
generic decline with no further reason, which we cannot make more specific
on our end.

### `ERR_PAYMENT_CARD_EXPIRED_402`

The card's expiration date has passed as of the charge attempt.

### `ERR_PAYMENT_ACQUIRER_UNAVAILABLE_502`

The upstream payment processor could not be reached or timed out. This is
retried automatically with the configured acquirer failover before being
surfaced to you; if you see this error, both the primary and secondary
acquirer path failed. See
[incident-response-payment-gateway-timeouts.md](../runbooks/incident-response-payment-gateway-timeouts.md)
for the corresponding internal runbook, which is triggered by a spike in
this error code as well as by direct latency alerts.

### `ERR_PAYMENT_ALREADY_REFUNDED_409`

A refund was attempted against a charge that has already been fully
refunded. Partial refunds up to the remaining refundable amount are still
allowed; only a second full refund attempt against an already-fully-refunded
charge is rejected.

## Webhook errors (400, 502, 504)

### `ERR_WEBHOOK_SIGNATURE_MISMATCH_400`

Logged on our side when a retry probe or delivery inspection detects a
signature mismatch; see [webhooks.md](webhooks.md) for signature
verification on your side.

### `ERR_WEBHOOK_ENDPOINT_UNREACHABLE_502`

Your configured webhook URL's DNS resolution or TCP connection failed
during a delivery attempt.

### `ERR_WEBHOOK_TIMEOUT_504`

Your webhook endpoint did not respond within the 10-second delivery
timeout.

## Not found errors (404)

### `ERR_RESOURCE_NOT_FOUND_404`

The requested resource ID does not exist, or does not belong to the
authenticated account. We deliberately return the same error for "doesn't
exist" and "belongs to someone else" rather than distinguishing them, to
avoid leaking which resource IDs exist on other accounts.

## Server errors (500, 503)

### `ERR_INTERNAL_500`

An unexpected server-side error. Every occurrence is logged and paged to
the on-call engineer; if you see this repeatedly, contact support with the
`request_id` from the error body.

### `ERR_SERVICE_UNAVAILABLE_503`

The API is in a temporary maintenance window or is shedding load during an
incident. The response includes a `Retry-After` header.

## Gateway timeout errors (504)

### `ERR_GATEWAY_TIMEOUT_504`

The API gateway did not receive a response from an internal service within
the request timeout. For payment-related endpoints specifically, this is
the error code covered by
[incident-response-payment-gateway-timeouts.md](../runbooks/incident-response-payment-gateway-timeouts.md).

## Deprecation notices embedded in errors

### `ERR_DEPRECATED_ENDPOINT_410`

Returned by `v1` endpoints that have been fully removed after their
deprecation window closed. See
[deprecate-v1-rest-api.md](../decisions/deprecate-v1-rest-api.md) for the
timeline. The `message` field includes the `v2` replacement endpoint where
one exists.

## A note on retrying

Only `5xx` errors and `ERR_RATE_LIMIT_EXCEEDED_429` are safe to retry
automatically. Retrying a `4xx` validation or authentication error without
changing anything about the request will simply fail the same way every
time, and for state-changing requests you should always retry with the
same `Idempotency-Key` you used originally rather than generating a new
one, so a retried request can never be mistaken for a second, unrelated
operation.
