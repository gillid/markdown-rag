---
title: "Rate Limits"
source: api
updated_at: "2026-08-05"
url: "https://docs.orbitside.dev/api/rate-limits"
tags: [api, rate-limiting]
---

# Rate Limits

Every API key is limited by plan, using a sliding one-minute window:

| Plan | Requests / minute | Burst allowance |
| --- | --- | --- |
| Starter | 300 | 50 |
| Growth | 1,000 | 200 |
| Enterprise | 5,000 | 1,000 |

These limits are set by
[0002-revised-rate-limits.md](../decisions/0002-revised-rate-limits.md).

## Reading the response headers

Every response includes headers describing your current standing against
the limit:

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 942
X-RateLimit-Reset: 1717689600
```

## When you're throttled

If you exceed your limit, the API responds with `ERR_RATE_LIMIT_EXCEEDED_429`
and a `Retry-After` header giving the number of seconds to wait:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 12
Content-Type: application/json

{ "error": { "code": "ERR_RATE_LIMIT_EXCEEDED_429", "retry_after": 12 } }
```

## Avoiding throttling

- Respect the `Retry-After` header rather than retrying immediately; a tight
  retry loop against an already-exhausted bucket only makes the wait longer
  for everyone sharing that bucket during an incident.
- Use bulk endpoints where available (for example, list charges with
  pagination) instead of looping over individual per-item requests.
- If your legitimate sustained traffic regularly approaches your limit,
  request a higher tier rather than optimizing around the ceiling; contact
  support with your account ID and typical request volume.

## Special case: batch jobs

If you run a nightly batch job that legitimately needs a short burst well
above your sustained rate, the burst allowance in the table above covers
brief spikes. For a batch job that needs sustained high throughput for more
than a few minutes, contact support in advance to arrange a temporary
limit increase rather than relying on the burst allowance, which is not
sized for sustained load.
