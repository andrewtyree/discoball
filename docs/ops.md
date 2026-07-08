# DiscoBall — Operations Runbook

How to back up and restore DiscoBall, what the Phase-5 hardening features
(rate limiting, webhooks, structured logging) do, and where the deliberate
demo-scale simplifications are — with their production upgrades.

1. [Backup & restore](#1-backup--restore)
2. [Scheduling backups](#2-scheduling-backups)
3. [Uploaded files](#3-uploaded-files)
4. [Rate limiting](#4-rate-limiting)
5. [Webhooks](#5-webhooks)
6. [Logging & error reporting](#6-logging--error-reporting)
7. [Import / export conventions](#7-import--export-conventions)

---

## 1. Backup & restore

Everything except uploaded files lives in PostgreSQL (compose service
`discoball-db`). Backups use `pg_dump` custom format (`-Fc`): compressed,
consistent snapshots that `pg_restore` can restore selectively.

```bash
npm run db:backup     # → ./backups/discoball-<yyyymmdd-hhmmss>.dump
```

The script (`scripts/db-backup.mjs`) runs `pg_dump` inside the container, so
no local Postgres tooling is needed, and prunes to the newest 14 dumps
(override with `BACKUP_KEEP`).

### The restore drill (safe — run it routinely)

A backup you've never restored is a hope, not a backup:

```bash
npm run db:restore    # newest dump → scratch DB, verify, drop
```

`scripts/db-restore.mjs` restores into a **scratch database**
(`discoball_restore_check`), prints row counts from the restored copy next to
the live database's, and drops the scratch DB. The live database is never
touched. Useful flags: `-- --file backups/discoball-… .dump`, `-- --keep`
(keep the scratch DB to poke at), `-- --target <name>`.

### Restoring for real

Overwriting the live database is deliberately not automated. When you truly
mean it:

```bash
# 1. Stop the app so nothing writes mid-restore.
# 2. Recreate the database and restore:
docker exec discoball-db psql -U discoball -d postgres \
  -c "DROP DATABASE discoball WITH (FORCE)"
docker exec discoball-db psql -U discoball -d postgres \
  -c "CREATE DATABASE discoball"
docker exec -i discoball-db pg_restore -U discoball -d discoball --no-owner \
  < backups/discoball-<stamp>.dump
# 3. Restore the uploads directory from the same point in time (§3).
```

For a hosted Postgres (Neon, Supabase, RDS) use the provider's point-in-time
recovery as the primary mechanism and keep `pg_dump` as the portable,
provider-independent fallback.

## 2. Scheduling backups

**Windows (Task Scheduler)** — daily at 02:00:

```powershell
schtasks /create /tn "DiscoBall backup" /sc daily /st 02:00 `
  /tr "cmd /c cd /d C:\dev\discoball && npm run db:backup"
```

**Linux/macOS (cron)** — daily at 02:00:

```cron
0 2 * * * cd /srv/discoball && npm run db:backup >> backups/backup.log 2>&1
```

`./backups/` is git-ignored; ship dumps off the machine (object storage,
another host) for real durability.

## 3. Uploaded files

Templates, generated artifacts, and import CSVs live on disk under
`STORAGE_DIR` (default `./data/uploads`), **not** in Postgres — `pg_dump`
does not include them. Back the directory up alongside each dump:

```powershell
robocopy .\data\uploads D:\backups\discoball-uploads /MIR      # Windows
```

```bash
rsync -a --delete ./data/uploads/ /backups/discoball-uploads/  # POSIX
```

A database restored without its uploads directory will show templates and
runs whose "Download" 404s — harmless, but restore both from the same point
in time.

## 4. Rate limiting

Sliding-window limits (`src/lib/rate-limit.ts`) on the endpoints worth
abusing:

| Bucket | Key | Limit |
|---|---|---|
| Sign-in attempts | ip + email | 10 / minute |
| Record export | user | 30 / minute |
| Import commit | user | 10 / hour |
| Generation runs | user | 30 / hour |
| Webhook test / redeliver | user | 30 / hour |

Over-limit sign-ins return the same generic "invalid credentials" as a wrong
password (no oracle for attackers) and emit a `warn` log line. Route
handlers return `429` with `Retry-After`; form actions surface a friendly
banner.

**Demo-scale simplification:** counters are in-memory and per-process —
correct for a single instance, reset on restart. Horizontal scaling swaps
the storage behind the same `check(key)` contract for Redis
(`INCR` + `EXPIRE`, or a sorted-set sliding window) without touching call
sites.

## 5. Webhooks

Configured per-org at **Settings → Webhooks** (`config:write` required).
On subscribed events — `record.created`, `record.updated`,
`record.archived`, `record.imported` (one batch event per import, never
per-row), plus `ping` from the Test button — DiscoBall POSTs JSON:

```
POST <your url>
Content-Type: application/json
X-Discoball-Event: record.created
X-Discoball-Delivery: <delivery uuid>
X-Discoball-Signature: sha256=<hex HMAC-SHA256(secret, raw body)>

{"event":"record.created","deliveryId":"…","payload":{…}}
```

**Verify the signature before trusting a payload** — recompute the HMAC of
the *raw body* with your copy of the secret and compare constant-time.
Reference receiver: `scripts/webhook-receiver.mjs`:

```bash
WEBHOOK_SECRET=<secret from settings> node scripts/webhook-receiver.mjs 9999
```

Dispatch runs after the response is sent (`next/server after()`), with a
10-second timeout, and every attempt is recorded under "Recent deliveries" —
there are **no automatic retries**; failed deliveries have a manual
Redeliver button.

**SSRF guard:** in production, webhook URLs must be public — private,
loopback, and link-local hosts are rejected at creation and again at
delivery. Local demos post to a localhost receiver, so development skips the
check (or set `ALLOW_PRIVATE_WEBHOOKS=1` explicitly).

**Demo-scale simplifications:** secrets are stored plaintext in Postgres
(production: envelope-encrypt or store a hash + show-once); the guard checks
the literal URL host, not what DNS resolves to at delivery time (production:
resolve-and-pin to defeat DNS rebinding); dispatch is in-process
fire-after-response (production: transactional outbox table + queue worker
with retries/backoff).

## 6. Logging & error reporting

Server logs are single-line JSON (`src/lib/logger.ts`):

```json
{"time":"2026-07-08T12:00:00.000Z","level":"info","msg":"import completed","module":"import","importRunId":"…","imported":4}
```

`LOG_LEVEL` (`debug`|`info`|`warn`|`error`, default `info`) sets the
threshold; `warn`/`error` go to stderr. Pipe `docker logs` / process output
straight into Loki, CloudWatch, or `jq`.

Unhandled server errors flow through `src/instrumentation.ts`
(`onRequestError`) as structured `error` lines. To ship them to a SaaS
instead, that one file is the whole integration — e.g. Sentry:

```ts
import * as Sentry from "@sentry/nextjs";
export const onRequestError = Sentry.captureRequestError;
```

## 7. Import / export conventions

The CSV dialect both features share (`src/lib/csv.ts`, RFC 4180):

- **Dates** are `yyyy-mm-dd` (UTC).
- **Multi-select** values are one cell, `; `-separated: `red; blue`.
- **Booleans** export as `true`/`false`; import also accepts `yes/no/1/0`.
- **Custom fields** are `cf_<key>` columns; **status** is matched by name
  (case-insensitive), **assignee** by member email.
- Export caps at 10,000 rows (413 beyond — narrow the filter); import caps
  at 5,000 rows / 5 MB per file.
- Round-trip: filter the records list to one type → Export CSV → edit →
  Import CSV. Exported headers auto-map; `recordType`/`archived` columns are
  informational and ignored on import.
- Reference collisions (against the workspace or within the file) are
  reported per-row and never auto-renamed; imports are all-or-nothing unless
  "skip invalid rows" is ticked.
