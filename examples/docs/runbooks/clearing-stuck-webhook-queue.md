---
title: "Clearing a Stuck Webhook Delivery Queue"
updated_at: "2026-05-30"
tags: [runbook]
---

# Clearing a Stuck Webhook Delivery Queue

If the `webhooks-dispatcher` delivery queue depth keeps climbing instead of
draining, check for a poison message first before assuming the whole queue
is broken:

```bash
orbitctl queue peek webhooks-dispatcher --count=5
```

A single malformed event can block the workers behind it if retries aren't
isolated per-message. If you find one, remove it from the head of the queue
and requeue it at the tail so it doesn't block everything else:

```bash
orbitctl queue requeue-to-tail webhooks-dispatcher --message-id=<id>
```

If there's no poison message and the queue is just backed up, scale the
worker pool temporarily:

```bash
orbitctl scale webhooks-dispatcher-worker --replicas=8
```
