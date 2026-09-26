---
title: "Database Failover Runbook"
source: runbook
updated_at: "2026-03-02"
url: "https://runbooks.internal.orbitside.dev/database-failover"
tags: [database, infra, on-call]
---

# Database Failover Runbook

Use this runbook when the primary Postgres instance (`orbitside-prod-pg-0`)
becomes unreachable or its replication lag exceeds five minutes. The failover
procedure is tracked under the identifier `RDS-FAILOVER-07`.

## When to trigger a failover

- The `pg-primary-health` check has failed for more than two consecutive
  minutes.
- `pg_stat_replication` lag on the standby exceeds 300 seconds and is not
  recovering.
- The primary's underlying instance has been marked `impaired` by the cloud
  provider's health dashboard.

## Pre-checks

Run these before promoting the standby, to avoid a split-brain situation:

```sql
-- On the current primary, confirm no in-flight transactions are pending
SELECT pid, state, query_start, query
FROM pg_stat_activity
WHERE state <> 'idle'
ORDER BY query_start;

-- Confirm the standby has applied the latest WAL segment we can see
SELECT pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn();
```

If the primary is fully unreachable, skip the transaction check and proceed
directly to promotion; the WAL fencing step below will prevent inconsistent
writes.

## Promotion procedure

1. Fence the old primary so it can never accept writes again, even if it
   comes back online:

   ```bash
   orbitctl db fence --instance=orbitside-prod-pg-0 --reason="RDS-FAILOVER-07"
   ```

2. Promote the standby:

   ```bash
   orbitctl db promote --instance=orbitside-prod-pg-1
   ```

3. Update the connection routing so application pods pick up the new
   primary without a redeploy:

   ```bash
   orbitctl db set-primary --instance=orbitside-prod-pg-1 --propagate
   ```

4. Verify application health:

   ```bash
   kubectl -n core get pods -l tier=backend
   orbitctl synthetics run write-probe --env=prod --count=10
   ```

5. Provision a fresh standby from the newly promoted primary so the cluster
   returns to a redundant state:

   ```bash
   orbitctl db add-replica --from=orbitside-prod-pg-1 --zone=us-east-1c
   ```

## Rollback

There is no rollback once fencing has run. The old primary must be rebuilt
as a fresh replica; it can never rejoin as primary directly.

## Related

See [restoring-from-backup.md](restoring-from-backup.md) for the separate
procedure used when both the primary and the standby are lost, rather than
just the primary.
