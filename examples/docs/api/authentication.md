---
title: "API Authentication"
updated_at: "2026-04-02"
tags: [api, security]
---

# API Authentication

Orbitside's REST API supports two authentication methods: API keys for
server-to-server integrations, and OAuth 2.0 for integrations acting on
behalf of a customer's own users.

## API keys

Include your API key in the `Authorization` header on every request:

```http
GET /v2/accounts/acc_1a2b3c HTTP/1.1
Host: api.orbitside.dev
Authorization: Bearer sk_live_<your-secret-key>
```

API keys come in `sk_live_` (production) and `sk_test_` (sandbox) variants.
Never send a `sk_live_` key from client-side code; it has full account
access.

## OAuth 2.0

For integrations acting on behalf of a customer, use the standard
authorization code flow:

1. Redirect the customer to
   `https://connect.orbitside.dev/oauth/authorize` with your `client_id`,
   `redirect_uri` and requested `scope`.
2. Exchange the returned `code` for an access token at
   `POST https://connect.orbitside.dev/oauth/token`.
3. Use the returned access token as a bearer token exactly like an API key.

Access tokens expire after one hour. Use the accompanying refresh token to
obtain a new one without re-prompting the customer.

## Errors

| Code | Meaning |
| --- | --- |
| `ERR_AUTH_MISSING_TOKEN_401` | No `Authorization` header was present. |
| `ERR_AUTH_INVALID_TOKEN_401` | The token is malformed or does not match any known key. |
| `ERR_AUTH_EXPIRED_TOKEN_401` | An OAuth access token has expired; use the refresh token. |
| `ERR_AUTH_INSUFFICIENT_SCOPE_403` | The token is valid but lacks the scope required for this endpoint. |

See [errors-reference.md](errors-reference.md) for the full error catalog
across every endpoint.

## Rotating a leaked key

If an API key is exposed (for example, committed to a public repository),
revoke it immediately from the dashboard and issue a new one. Revocation
takes effect within a few seconds. There is no grace period for API keys,
unlike the dual-signing overlap used for webhook signing keys; see
[rotating-api-signing-keys.md](../runbooks/rotating-api-signing-keys.md).
