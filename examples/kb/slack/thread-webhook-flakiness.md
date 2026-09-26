---
title: "Slack thread: integrator says our webhooks look forged"
source: slack
updated_at: "2026-04-03"
channel: "#dev-support"
tags: [api]
---

# Slack thread: integrator says our webhooks look forged

**tomas:** got an odd support ticket — an integrator says they're seeing
webhook deliveries that fail their check for "is this really from
Orbitside" but the payload looks legit to them otherwise. worried someone
is spoofing us.

**dana:** did you ask what library or code they're using to do that check?

**tomas:** they pasted a snippet, they're comparing the header value to
what they compute using regular string equality.

**dana:** that's probably not the actual bug, just a minor style issue —
the real thing to check is whether they're hex-decoding both sides before
comparing, or comparing raw strings. if they compare the raw hex string
straight up it should still technically work, so let's dig more.

**dana:** actually, can you ask if they rotated their endpoint's signing
secret recently, or if they have multiple endpoints configured with
different secrets and might be mixing them up?

**tomas:** asking now.

**tomas:** yep, that was it — they'd set up a second webhook endpoint for a
staging environment with its own secret, and their verification code was
using the staging secret against production deliveries by accident.

**dana:** classic. worth adding a callout in the docs that each endpoint
has its own independent secret, not a shared account-level one, since this
is apparently not obvious.

**tomas:** agreed, i'll file that as a docs follow-up.
