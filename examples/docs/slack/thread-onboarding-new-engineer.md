---
title: "Slack thread: onboarding checklist questions"
updated_at: "2026-05-14"
channel: "#eng-onboarding"
tags: [process, slack]
---

# Slack thread: onboarding checklist questions

**sam (new hire):** hi all, starting today on the payments team! going
through the onboarding doc now, quick question — do I need prod db access
on day one or does that come later?

**priya:** welcome! prod db access is granted after you've shadowed at
least one on-call shift, usually week 2 or 3. it's not a trust thing, it's
just that the failover tooling has some sharp edges and we'd rather you see
someone else use it first.

**sam:** makes sense, thanks. also is there a single doc that explains what
all the internal `orbitctl` subcommands do, or do I just learn them as I
go?

**miguel:** mostly learn-as-you-go honestly, but the runbooks under the
runbook source all show real invocations in context, which is a decent way
to pick them up without reading a full reference doc. the database
failover and backup restore ones in particular use most of the common
flags.

**sam:** cool, will read through those. one more thing — is there a staging
environment i can safely poke at, or is everything either local or prod?

**dana:** there's a staging env, ask in #infra-access for credentials. it
mirrors prod config pretty closely except it points at the sandbox payment
acquirer, so you can't accidentally move real money there.

**sam:** perfect, thank you both!
