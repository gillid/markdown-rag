---
title: "Decision: Use Stripe for Internal Subscription Billing"
source: decision
updated_at: "2024-12-01"
tags: [billing]
---

# Decision: Use Stripe for Internal Subscription Billing

## Decision

Orbitside's own customer subscription billing (charging customers for their
Orbitside plan) runs on Stripe Billing. This is separate from the payment
processing capability Orbitside sells to its own customers, which supports
multiple acquirers, not just Stripe.

## Why

This is a case where we should not eat our own dog food: our product exists
because payment processing has enough edge cases (dunning, proration, tax,
card-network compliance changes) that most companies shouldn't build it
themselves, and that argument applies just as much to our own internal
billing as it does to our customers. Building our own subscription billing
on top of our own platform would also create an awkward dependency where a
billing bug could look like a product outage to our own finance team.

## Rejected alternatives

- **Building subscription billing on our own platform**: rejected for the
  reasons above; it also would have meant our own platform's early defects
  directly affected our ability to collect revenue.
- **A different billing provider (Chargebee, Recurly)**: not rejected on
  technical grounds; Stripe was chosen mainly for the team's existing
  familiarity with its dashboard and APIs from previous roles.
