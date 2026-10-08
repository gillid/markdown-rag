---
title: "Pagination"
updated_at: "2025-10-11"
tags: [api]
---

# Pagination

List endpoints (`GET /v2/charges`, `GET /v2/refunds`, and so on) use
cursor-based pagination rather than page numbers, since offset-based paging
becomes inconsistent when new items are created while you're paging through
results.

## Requesting a page

```http
GET /v2/charges?limit=50 HTTP/1.1
```

The response includes a `next_cursor` you pass back to get the following
page:

```json
{
  "data": [ ... ],
  "next_cursor": "eyJpZCI6ImNoX...",
  "has_more": true
}
```

```http
GET /v2/charges?limit=50&cursor=eyJpZCI6ImNoX... HTTP/1.1
```

When `has_more` is `false`, `next_cursor` will be `null` and there is no
further page.

## Why not offset pagination

With offset pagination (`?offset=50&limit=50`), an item created while you
are paging shifts every subsequent item's position, which can cause you to
see the same item twice or skip one entirely. Cursor pagination is stable
against concurrent writes because each cursor encodes a specific position
relative to a specific item, not a numeric offset.

## Limits

`limit` defaults to 20 and can be set up to 100. Requesting a value above
100 does not error; it is silently capped at 100.
