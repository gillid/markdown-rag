---
title: "Slack thread: why did that customer get charged twice"
updated_at: "2026-07-09"
channel: "#payments-eng"
tags: [payments, slack]
---

# Slack thread: why did that customer get charged twice

**dana:** hey, support just forwarded me something weird. a customer says
their card got hit twice for the same order, same amount, a few seconds
apart. anyone seen this before?

**miguel:** yeah this usually happens when the checkout page's "pay now"
button gets clicked twice, or the request times out on the client side so
their frontend fires it again thinking the first one failed, but the first
one actually went through fine on our end.

**dana:** so the money really did move twice? not just a display glitch?

**miguel:** right, two separate attempts, two separate completed
transactions, both real. the fix is on their side: they need to tag each
"attempt" with a unique marker before sending it, and reuse that exact same
marker if they resend the same attempt. if we see the same marker come in
twice with the exact same details, we just hand back the result from the
first one instead of doing it all over again.

**dana:** oh that's the thing we ask integrators to send on every request
that moves money?

**miguel:** yep, that one. it's opt-in from their side though, we don't
force it, so if their frontend team never wired it up, this is exactly what
happens. worth flagging to their dev contact.

**priya:** for what it's worth, we did talk about making it mandatory for
every write instead of leaving it optional. decided against it because a
lot of smaller integrators would have broken overnight without warning.
might be worth revisiting once more of the big accounts have adopted it
voluntarily.

**dana:** makes sense. i'll send the customer's dev team a note pointing at
the right header to use and close this out.

**miguel:** 👍 also worth double-checking whether their retry actually used
a *different* marker than the first attempt, vs. reusing the same one with
a slightly different payload — if the payload changed even a little bit
between the two attempts, we'd reject the second one outright instead of
quietly deduping it, so that'd point to a different bug on their end.
