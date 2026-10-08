---
title: "Primary On-Call Acknowledgement Window"
updated_at: "2022-08-01"
tags: [on-call, process, runbook]
---

# Primary On-Call Acknowledgement Window

Primary on-call has 15 minutes to acknowledge a page before it escalates to
the secondary responder. Acknowledgement happens directly in PagerDuty; no
other action is required to stop the escalation timer.

If the primary is unreachable (out of signal, phone off), the secondary
should acknowledge as soon as they receive the escalation and take over
incident ownership for that page.
