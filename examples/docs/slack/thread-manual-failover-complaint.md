---
title: "Slack thread: promoting a replica is way too manual right now"
source: slack
updated_at: "2023-09-05"
channel: "#infra"
---

# Slack thread: promoting a replica is way too manual right now

**miguel:** just had a scare, primary looked unhealthy for a few minutes.
turned out to be a false alarm but it made me realize we have zero tooling
for promoting the replica if it had been real. i had to ssh into the box
and run raw sql by hand to even check replication lag.

**dana:** yeah same, last time i did this i was just eyeballing
`pg_stat_replication` output and guessing whether it was safe to promote.
no fencing either, so if the old primary came back it could've started
accepting writes again and we'd have had two primaries.

**miguel:** should we write this up as a project? feels like the kind of
thing that's fine until the one time it really isn't.

**dana:** agreed, let's get it on the roadmap. for now if it happens for
real, go slow, double check replication lag manually before promoting
anything, and physically stop the old instance if you can, don't just trust
that it'll behave.
