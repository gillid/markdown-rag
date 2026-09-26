---
title: "On-Call Escalation Policy"
source: runbook
updated_at: "2026-04-18"
tags: [on-call, process]
---

# On-Call Escalation Policy

## Paging tiers

1. **Primary on-call** — paged immediately by PagerDuty for any triggered
   alert. Expected acknowledgement within 5 minutes.
2. **Secondary on-call** — paged automatically if the primary has not
   acknowledged within 5 minutes.
3. **Team lead** — paged manually by whoever is running the incident if it
   is not mitigated within 30 minutes, or immediately for a `sev-1`.

## Severity definitions

- **sev-1**: customer-facing outage or data loss risk. Page the team lead
  immediately, open an incident channel, and start a postmortem doc.
- **sev-2**: degraded service for a subset of customers. Primary on-call
  handles it, with the secondary as backup.
- **sev-3**: internal-only or non-urgent issue. Can wait for business hours.

## Opening an incident channel

```bash
orbitctl incident open --title="<short summary>" --severity=sev-1
```

This creates a dedicated Slack channel, invites the paged responders, and
posts a link to the relevant runbook if one is detected from the alert
name.

## Handoff

At the end of an on-call shift with an open incident, the outgoing
responder must post a written handoff in the incident channel covering
current state, what has been tried, and what the next step is, before the
incoming responder takes over.
