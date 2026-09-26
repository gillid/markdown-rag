---
title: "Slack thread: Q2 incident recap before the all-hands"
source: slack
updated_at: "2026-06-25"
channel: "#eng-leads"
tags: [incidents, process]
---

# Slack thread: Q2 incident recap before the all-hands

**priya:** putting together the incident recap slide for the all-hands,
want to make sure I'm not missing anything from Q2. I have the gateway
timeout incident and the rate-limit storm, anything else?

**miguel:** those are the two big customer-facing ones. PAY-1042 (gateway
timeouts, acquirer TLS issue) and INC-1877 (rate-limit storm from the bad
bucket-key deploy).

**dana:** don't forget the near-miss with the database failover drill in
May — nothing customer-facing happened, but we found the fencing step
wasn't actually blocking writes from the old primary in one edge case. Might
be worth a mention since it changed how we test the failover runbook, even
though it wasn't a real incident.

**priya:** good call, adding it as a "caught before it mattered" bullet
rather than a real incident.

**miguel:** also small thing, not really incident-worthy, but the webhook
signature confusion ticket from a customer mixing up staging and prod
secrets led to a docs update. probably not slide-worthy but wanted it on
the record somewhere.

**priya:** noted, I'll fold that into the "docs and tooling improvements
from support tickets" section instead of the incident list. thanks both,
slide's in decent shape now.
