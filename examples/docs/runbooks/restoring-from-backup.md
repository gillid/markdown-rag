---
title: "Restoring the Primary Database from Backup"
updated_at: "2026-02-14"
tags: [database, infra, disaster-recovery, runbook]
---

# Restoring the Primary Database from Backup

Use this runbook only when both the primary and every standby are lost, so a
normal failover (see
[database-failover-runbook.md](database-failover-runbook.md)) is not
possible. This is the slowest recovery path and should be a last resort.

## Before you start

Restoring from backup means accepting data loss for everything written since
the most recent backup plus any WAL archive lag. Confirm with the incident
commander that this is genuinely the last resort before proceeding, since
there is no undo once a restore begins.

## Locate the most recent good backup

```bash
orbitctl backups list --instance=orbitside-prod-pg-0 --limit=10
```

Backups run every six hours, plus continuous WAL archiving in between. Pick
the most recent full backup whose checksum verification passed:

```bash
orbitctl backups verify --backup-id=<id>
```

## Restore to a new instance

Never restore onto the failed instance in place; always provision a new one
so a bad restore can be discarded without losing the ability to retry:

```bash
orbitctl db restore \
  --backup-id=<id> \
  --target-instance=orbitside-prod-pg-restore \
  --zone=us-east-1b
```

## Replay WAL archive up to the last known-good point

```bash
orbitctl db replay-wal \
  --instance=orbitside-prod-pg-restore \
  --until="<timestamp of last known-good state>"
```

If you do not have a precise timestamp, replay to the latest available WAL
segment and accept whatever loss window that implies.

## Validate before cutover

Run the full data-integrity check before pointing production traffic at the
restored instance:

```bash
orbitctl db integrity-check --instance=orbitside-prod-pg-restore --full
```

This checks:

- row counts on core tables against the last known-good snapshot
- foreign key consistency across the `payments`, `accounts` and `webhooks`
  schemas
- that the most recent successfully processed webhook delivery ID in the
  restored data is not ahead of what downstream systems have acknowledged

Do not skip this step even under time pressure. A restore that silently
loses foreign-key consistency is worse than a slower, correct restore,
because it corrupts data quietly instead of failing loudly.

## Cutover

Once validation passes:

```bash
orbitctl db set-primary --instance=orbitside-prod-pg-restore --propagate
orbitctl db add-replica --from=orbitside-prod-pg-restore --zone=us-east-1c
orbitctl db add-replica --from=orbitside-prod-pg-restore --zone=us-east-1d
```

## Communicating data loss

If any writes were lost, the incident commander must draft a customer
communication describing the affected time window before the incident is
closed. Engineering does not decide unilaterally that a data loss window is
"small enough" not to disclose; this can only be handled through the
customer communication process.

## Post-incident

Every backup restore, successful or not, requires a postmortem. Past
restores that used this runbook:

| Date | Instance | Cause | Data loss window |
| --- | --- | --- | --- |
| 2024-07-03 | orbitside-prod-pg-0 | Availability zone outage took out primary and standby together | 4 minutes |
| 2025-05-22 | orbitside-prod-pg-0 | Operator error during a maintenance window deleted both volumes | 22 minutes |

## Preventing repeat causes

The 2025-05-22 incident led to a change requiring two-person approval for
any `orbitctl db` command tagged `destructive` against a production
instance. The 2024-07-03 incident led to standbys being spread across three
availability zones instead of two, so a single zone outage can no longer
take out both the primary and every standby at once.

## Frequently asked questions during an incident

**Can we restore a subset of tables instead of the whole instance?**
No. The restore tooling operates at the instance level. If only one schema
is affected, prefer a logical restore from a `pg_dump` snapshot instead of
this runbook; ask the database on-call lead before choosing that path,
since logical restores have different consistency guarantees than a
physical WAL-based restore.

**How long does a full restore take?**
Historically between 25 and 90 minutes depending on database size and how
far the WAL replay has to catch up. Communicate a wide estimate to
stakeholders rather than a precise one.

**What if the checksum verification fails on the most recent backup?**
Fall back to the next most recent backup that passes verification, and
accept the larger data loss window. Do not restore from a backup that has
failed checksum verification under any circumstances, even if it is the
only option available, since a corrupted restore can be harder to detect
and recover from than simply accepting more data loss up front.

**Who has authority to approve starting a restore?**
The incident commander for a `sev-1`, or the database on-call lead for
anything lower severity. See
[on-call-escalation-policy.md](on-call-escalation-policy.md) for how
severity is assigned.
