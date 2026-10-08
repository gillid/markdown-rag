---
title: "Incident Response: Payment Gateway Timeouts"
updated_at: "2026-06-12"
tags: [payments, incidents, on-call, runbook]
---

# Incident Response: Payment Gateway Timeouts

This runbook covers the on-call response for `ERR_GATEWAY_TIMEOUT_504` errors
returned by the `payments-gateway` service. It was last exercised during
incident **PAY-1042**.

## Symptoms

- The public API returns `ERR_GATEWAY_TIMEOUT_504` for `POST /v1/charges`.
- The `payments-gateway` dashboard shows p99 latency above 8 seconds against
  the upstream acquirer.
- PagerDuty fires the `payments-gateway-slo-burn` alert.

## Immediate mitigation

1. Confirm the acquirer's status page isn't already reporting an outage.
2. Check pod health for the gateway deployment:

   ```bash
   kubectl -n payments get pods -l app=payments-gateway -o wide
   kubectl -n payments top pods -l app=payments-gateway
   ```

3. If more than half the pods are in `CrashLoopBackOff` or have CPU pinned at
   the limit, restart the deployment with a rolling restart so at least half
   of the pods stay serving traffic at all times:

   ```bash
   kubectl -n payments rollout restart deployment/payments-gateway
   kubectl -n payments rollout status deployment/payments-gateway --timeout=180s
   ```

4. If restarting does not clear the timeouts within five minutes, fail over
   the acquirer connection to the secondary processor:

   ```bash
   kubectl -n payments exec deploy/payments-gateway -- \
     orbitctl acquirer failover --to=secondary --reason="PAY-1042 mitigation"
   ```

5. Re-run the synthetic charge probe to confirm recovery:

   ```bash
   orbitctl synthetics run charge-probe --env=prod --count=20
   ```

## Root cause classes seen so far

| Date | Incident | Cause | Fix |
| --- | --- | --- | --- |
| 2025-11-02 | PAY-0981 | Acquirer-side outage | Failed over to secondary processor |
| 2026-03-19 | PAY-1005 | Connection pool exhaustion after a deploy | Rolled back, raised pool size |
| 2026-06-11 | PAY-1042 | Upstream TLS handshake renegotiation storm | Restarted gateway pods, opened ticket with acquirer |

## Escalation

If the failover does not clear `ERR_GATEWAY_TIMEOUT_504` within 15 minutes,
page the payments on-call lead directly and open an incident channel. See
[on-call-escalation-policy.md](on-call-escalation-policy.md) for the paging
tree.

## Postmortem

Every occurrence of this runbook must be followed by a postmortem filed
against the incident ID (for example `PAY-1042`) within two business days.
