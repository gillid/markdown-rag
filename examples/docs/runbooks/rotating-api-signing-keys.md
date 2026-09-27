---
title: "Rotating API Signing Keys"
source: runbook
updated_at: "2026-01-20"
tags: [security, api, on-call]
---

# Rotating API Signing Keys

Orbitside signs outbound webhooks with an HMAC key pair. Rotate it on a
quarterly schedule, or immediately if a key is suspected to have leaked.

## Generate the new key pair

```bash
openssl rand -hex 32 > new-signing-key.hex
orbitctl secrets set webhook-signing-key-next --file=new-signing-key.hex
shred -u new-signing-key.hex
```

## Dual-sign during the overlap window

For at least 72 hours, sign every webhook with both the current and the next
key so integrators have time to add the new key on their side without
dropped verifications:

```yaml
# config/webhooks.yaml
signing:
  active_keys:
    - id: key-2026-01
      ref: webhook-signing-key
    - id: key-2026-02
      ref: webhook-signing-key-next
  overlap_window_hours: 72
```

Deploy this configuration with:

```bash
orbitctl config apply config/webhooks.yaml --service=webhooks-dispatcher
orbitctl config verify --service=webhooks-dispatcher
```

## Promote and retire

Once the overlap window has passed and delivery logs show no verification
failures against the new key:

```bash
orbitctl secrets promote webhook-signing-key-next --to=webhook-signing-key
orbitctl secrets delete webhook-signing-key-next
```

Update the public documentation's key fingerprint listing so integrators can
confirm which key is currently active. See
[webhooks.md](../api/webhooks.md) for the verification steps integrators
follow on their side.

## If a key has leaked

Skip the overlap window. Rotate immediately, notify affected integrators
through the status page, and file a security incident regardless of whether
any unauthorized deliveries were observed.
