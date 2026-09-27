---
title: "Webhooks"
source: api
updated_at: "2026-03-28"
url: "https://docs.orbitside.dev/api/webhooks"
tags: [api]
---

# Webhooks

Orbitside sends webhooks for events like `charge.succeeded`,
`charge.failed`, and `refund.created` to a URL you configure in the
dashboard.

## Verifying the signature

Every webhook request includes an `X-Orbitside-Signature` header. Verify it
before trusting the payload, since anyone can send a POST request to your
endpoint claiming to be Orbitside:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verifySignature(payload, signatureHeader, signingSecret) {
  const expected = createHmac("sha256", signingSecret)
    .update(payload)
    .digest("hex");
  const provided = Buffer.from(signatureHeader, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  return (
    provided.length === expectedBuf.length &&
    timingSafeEqual(provided, expectedBuf)
  );
}
```

Always use a constant-time comparison, not `===` or `Buffer.equals`, to
avoid a timing side channel on the signature check.

## Retry behavior

If your endpoint does not respond with a `2xx` status within 10 seconds,
the delivery is retried with exponential backoff: 1 minute, 5 minutes, 30
minutes, then every 2 hours for up to 24 hours. After 24 hours of failed
deliveries, the webhook is marked `abandoned` and you must manually replay
it from the dashboard.

## Errors your endpoint may see referenced in delivery logs

| Code | Meaning |
| --- | --- |
| `ERR_WEBHOOK_SIGNATURE_MISMATCH_400` | The signature we computed didn't match the header on retry inspection (logged on our side, for your visibility). |
| `ERR_WEBHOOK_ENDPOINT_UNREACHABLE_502` | Your endpoint's DNS or TCP connection failed. |
| `ERR_WEBHOOK_TIMEOUT_504` | Your endpoint didn't respond within 10 seconds. |

## Idempotent handling

Because of retries, your endpoint may receive the same event more than
once. Use the `id` field on the event payload to deduplicate; do not assume
one delivery equals one occurrence. This is unrelated to the
`Idempotency-Key` header used for outbound API requests; see
[idempotency-keys.md](idempotency-keys.md) for that separate mechanism.
