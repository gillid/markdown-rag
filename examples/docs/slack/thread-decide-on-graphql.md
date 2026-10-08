---
title: "Slack thread: do we really need a query language for the dashboard API"
updated_at: "2026-08-20"
channel: "#api-platform"
tags: [api, slack]
---

# Slack thread: do we really need a query language for the dashboard API

**priya:** so the dashboard team is making like 5 separate calls just to
render one account overview page. account info, then recent charges, then
recent refunds, then webhook status, one after another. it's slow and it's
annoying to maintain on their side.

**tomas:** could we just add one bigger REST endpoint that bundles all of
that into a single response? feels simpler than bringing in a whole new
query layer.

**priya:** we talked about that, but then every time a dashboard view needs
slightly different fields we'd be adding another bespoke bundled endpoint,
or bloating one giant endpoint that returns way more than most callers
need. a query layer where the client says exactly which fields it wants
avoids that growth entirely.

**tomas:** fair. does this affect how creating a charge or a refund works
at all?

**priya:** no, writes stay exactly as they are today, same endpoints, same
idempotency handling. this is purely for reading data efficiently in one
round trip, nothing about how money actually moves changes.

**tomas:** okay, that eases my worry a lot, i was picturing having to redo
all our write-path safety guarantees on a new system. if it's read-only i'm
on board.

**priya:** yep, that's exactly the boundary we're drawing. writing up the
formal decision doc now, will link it here once it's up.
