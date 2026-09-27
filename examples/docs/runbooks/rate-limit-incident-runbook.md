---
title: "Handling Rate-Limit Storm Incidents"
source: runbook
updated_at: "2025-11-05"
tags: [api, incidents, on-call]
---

# Handling Rate-Limit Storm Incidents

This runbook covers incidents where a large share of API traffic is being
rejected with `ERR_RATE_LIMIT_EXCEEDED_429`, as opposed to a single
integrator being throttled as expected.

## Distinguishing a storm from expected throttling

Check the ratio of 429s to total requests on the `api-gateway` dashboard:

- Below 2% of total traffic: normal throttling of a handful of noisy
  integrators. No action needed.
- Above 10% of total traffic, or a sudden step change: treat as an incident,
  tracked here as class `INC-1877`.

## Likely causes

1. A shared rate-limit bucket key collision after a config deploy (multiple
   integrators mapped to the same bucket).
2. The rate limiter's Redis backend running hot, causing it to fail closed.
3. A single integrator's retry storm consuming a disproportionate share of a
   shared-tier bucket that other integrators also draw from.

## Mitigation

1. Check the rate limiter's Redis latency; if it is elevated, that is almost
   always the cause, since the limiter fails closed under Redis pressure by
   design.
2. If a specific integrator is responsible, temporarily move them to an
   isolated bucket so they stop starving others:

   ```bash
   orbitctl ratelimit isolate --client-id=<id> --bucket=incident-quarantine
   ```

3. If the cause is a bad bucket-key deploy, roll back the gateway
   configuration to the previous revision.

## Related decisions

The default limits referenced by this runbook are defined in
[0002-revised-rate-limits.md](../decisions/0002-revised-rate-limits.md),
which superseded the original 2023 policy.
