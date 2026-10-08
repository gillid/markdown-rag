---
title: "Team: Payments Platform"
updated_at: "2026-05-20"
tags: [payments, team]
---

# Team: Payments Platform

## Mission

The Payments Platform team owns the reliability and correctness of every
charge, refund and payout that moves through Orbitside. We exist so that
product teams never have to think about acquirer failover, idempotency or
reconciliation themselves — they call our APIs and trust the money lands
in the right place, on time, exactly once. Our north star is zero
customer-visible payment incidents caused by our own infrastructure, and
we measure ourselves against the `payments-gateway-slo-burn` error budget
every quarter.

## Owned services

- `payments-gateway` — the charge and refund path in front of the
  acquirer, including retry and failover logic.
- `webhook-dispatcher` — delivers `payment.*` webhook events to
  integrators, with signing and redelivery.
- `ledger-reconciler` — nightly job that reconciles internal ledger
  entries against the acquirer's settlement reports.

## Contacts

- Slack channel: `#payments-platform`
- PagerDuty escalation: "Payments Platform" (see
  [on-call-escalation-policy.md](../runbooks/on-call-escalation-policy.md)
  for the general paging tiers)
- Team lead: Priya Nataraj
- Engineering manager: Owen Aldridge
