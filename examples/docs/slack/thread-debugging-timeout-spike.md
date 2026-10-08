---
title: "Slack thread: gateway 504 spike this morning"
updated_at: "2026-06-11"
channel: "#incident-pay-1042"
tags: [payments, incidents, slack]
---

# Slack thread: gateway 504 spike this morning

**miguel:** paging everyone into this channel, we've got a real spike in
`ERR_GATEWAY_TIMEOUT_504` on the charges endpoint starting about 8 minutes
ago. dashboard shows p99 well over 8s against the acquirer.

**dana:** on it. checking pod health now.

**dana:** pods look okay, cpu isn't pinned, no crashloop. feels more like
something upstream is slow rather than our side being overloaded.

**miguel:** yeah agreed, acquirer status page shows nothing though. gonna
try a rolling restart of the gateway deployment anyway per the runbook,
sometimes it clears a stuck connection pool even when it's not obviously
our fault.

**miguel:** restart done, watching the synthetic probe now.

**dana:** still seeing timeouts on real traffic, restart didn't fix it.

**miguel:** okay, failing over to the secondary acquirer connection then.
running the failover command now.

**miguel:** failover done. probe results look clean, 20/20 successful
charges under 500ms.

**priya:** confirmed on the customer-facing dashboard too, error rate back
to baseline. nice work. i'll open the postmortem doc, this is incident
PAY-1042 for the tracker.

**dana:** should we also loop in the acquirer's support contact? this is
the third TLS-handshake-looking timeout issue with them this quarter.

**priya:** yes, adding that to the postmortem action items. worth asking
them directly whether something changed on their end around handshake
renegotiation, since that's the pattern in the last couple of these.
