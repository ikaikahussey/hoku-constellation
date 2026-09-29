# HOKU Insider operations

This runbook covers the Part E services: alerts, reports, briefings, Q&A, billing, and monitoring. It also covers backups and the checks that must pass before launch.

## Status summary

| Area | Status |
|---|---|
| Alert pipeline (matcher, delivery, digests) | Implemented and tested, including a latency test and a 500 × 5,000 load simulation |
| Reports, briefings, Q&A | Implemented. Needs `ANTHROPIC_API_KEY`; without it, reports and briefings are compiled from facts only |
| Billing (Stripe test mode) | Implemented. Live objects wait on the owner; see `docs/PRICING.md` |
| Sentry | Wired in. Needs `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` from the owner's Sentry project |
| Uptime and status page | `/api/health` is ready. The Better Stack account is owner-provided; steps below |
| Neon point-in-time restore | **Not verified from this environment** (no Neon console access). Steps and the drill procedure are below |
| Session-mode legislative polling (E1) | **Deferred.** E1 was skipped in this build. Bill alerts use `capitol_measures` status text |
| Legal | Drafts are in place. **Launch is blocked on media-law counsel sign-off** (`docs/LEGAL_REVIEW_PACKET.md`) |

## Processes

| Process | Where | Cadence |
|---|---|---|
| Importers | `workers/import-<source>.ts` (Mac mini launchd) or `/api/cron/ingest` (Vercel, every 15 min) | Per the source registry |
| Alert pipeline, first pass | Runs inside every importer after each committed batch (`runImporter(..., { onBatchCommitted })`) | Per batch |
| Alert worker | `workers/alerts.ts` (launchd `fm.hoku.constellation.alerts`, KeepAlive) or `/api/cron/alerts` (Vercel, every minute) | 15 s tick |
| Digests | Same alert worker tick. Daily at 07:00 HST; weekly on Mondays at 07:00 HST | |
| Ops | `workers/alerts.ts` hourly tick, or `/api/cron/ops` (Vercel, hourly at :05) | Tier 1 freshness check every hour. Mondays 07:xx HST: report auto-drafts and partner summary |

Run either the Mac mini workers or the Vercel crons for alerts and ops, not both. Both paths are idempotent, but running both can send the weekly draft notice twice.

### Alert latency

The target is commit to email under 60 seconds at p95. Three things keep it there:

- The matcher runs as soon as an ingestion batch commits.
- Delivery drains in chunks of 2,000.
- Resend batch sends go out 100 at a time.

`tests/alerts.test.ts` measures a single synthetic document. `tests/alerts-load.test.ts` simulates 500 watchlists over 5,000 bills with a burst of 1,000 status changes; on PGlite it ran at p95 of about 2 s. Production latency is on `/admin/alerts`, measured from `document.fetched_at` to `alert_delivery.sent_at`.

### Retiring `ax_alert`

`app.alert_event` replaces the analytics-generated `ax_alert` feed for subscribers. Plan:

1. Run both for two weeks. `/admin/alerts` shows `app.alert_event` volume; `/admin/workers` shows `ax_alert`.
2. Parity check: every `ax_alert` of type `new_contribution`, `new_lobbying`, or `new_appointment` in the window should have an `app.alert_event` of type `entity.new_edge` for teams watching that entity. Query:
   ```sql
   select a.id from ax_alert a
    where a.created_at > now() - interval '14 days' and a.entity_id in (select entity_id from app.watchlist_item where entity_id is not null)
      and not exists (select 1 from app.alert_event e where e.entity_id = a.entity_id and e.detected_at between a.created_at - interval '1 day' and a.created_at + interval '1 day');
   ```
3. If the query returns zero rows, stop `workers/detect-changes.ts` and its launchd job, remove `/api/analytics/admin/detect-changes` from `vercel.json`, and point `components/analytics/AlertFeed.tsx` at `app.alert_event`. Keep the `ax_alert` table until the next schema cleanup; it is rebuildable.

## Secrets

These are the new variables; `.env.example` lists them all.

| Variable | Used for |
|---|---|
| `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS` | Alerts, digests, invitations, client reports. Verify the sending domain in Resend (SPF, DKIM, DMARC for `hoku.fm`) |
| `APP_ENCRYPTION_KEY` | 32 bytes, base64. Encrypts Slack webhooks. **Rotating it makes stored webhooks unreadable**, so teams would need to reconnect Slack |
| `APP_SIGNING_SECRET` | Unsubscribe and open-tracking link signatures. Rotating it invalidates links already in inboxes |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Narratives. `ANTHROPIC_MODEL` defaults to `claude-opus-5-5`. Requests use structured output and server-side refusal fallback |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Error monitoring |
| `OWNER_EMAIL` | Feedback, weekly partner summary, freshness alarms |
| `STRIPE_PRICE_*`, `STRIPE_COUPON_*` | See `docs/PRICING.md` |

## Monitoring

### Sentry

1. Create a Sentry project (platform: Next.js) in the owner's organization.
2. Set `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` in Vercel production and preview, and in `workers/.env`.
3. Optional: source-map upload. Add `SENTRY_AUTH_TOKEN`, then wrap `next.config.ts` with `withSentryConfig` from `@sentry/nextjs`. This build does not do that, so no build-time token is required.
4. Configuration: `instrumentation.ts` (server and edge) and `instrumentation-client.ts` (browser). Request bodies and cookies are stripped before sending.

### Uptime check and public status page (Better Stack)

This is an owner-provided account. Steps:

1. Create a Better Stack Uptime account and add these monitors:
   - `https://constellation.hoku.fm/api/health`: HTTP 200 and keyword `"database":"ok"`, every 1 minute, from 3 regions.
   - `https://constellation.hoku.fm/`: HTTP 200, every 3 minutes.
2. Add a status page at `status.hoku.fm` (CNAME to Better Stack) with both monitors. `/api/health` returns `status: "degraded"` and the list of stale Tier 1 sources. Add a keyword monitor on `"status":"ok"` as a separate "Data freshness" component.
3. Send incident alerts to `OWNER_EMAIL` and the on-call phone.

### Freshness alarm

`checkFreshness()` emails `OWNER_EMAIL` when a Tier 1 live source is more than twice past its freshness target. The target is the source's registry cadence, and the alarm fires at most once per source per 24 hours. The public view is `/coverage`.

### Corrections

Staff work the queue at `/admin/corrections`. The target is acknowledgement within one business day (HST). Overdue items are highlighted.

## Backups and restore

Neon provides point-in-time restore (PITR) through branch history. The retention window depends on the plan, and the owner must confirm it in the Neon console under **Project → Settings → Storage → History retention**. As of this build, Neon's published defaults are:

- Launch: 7 days
- Scale: 14 days, configurable to 30
- Business: 30 days

**Action for the owner:** record the current setting here, and set it to at least 14 days before launch.

| Item | Value |
|---|---|
| Neon plan | _to be filled in by owner_ |
| History retention | _to be filled in by owner_ |
| Last restore drill | **Not yet performed.** This build environment has no Neon access. |

### Restore drill (run quarterly and before launch)

1. In the Neon console, create a branch from `main` at a timestamp 24 hours ago (**Branches → New branch → Point in time**). Name it `restore-drill-YYYYMMDD`.
2. Copy the branch connection string. Run:
   ```
   DATABASE_URL_UNPOOLED=<branch url> npx tsx --tsconfig tsconfig.scripts.json scripts/db/migrate.ts --dry
   psql <branch url> -c "select count(*) from entity; select count(*) from document; select count(*) from app.team; select max(fetched_at) from document;"
   ```
   Confirm that the counts are plausible and that `max(fetched_at)` is about 24 hours old.
3. Run the RLS suite against the branch: `TEST_DATABASE_URL=<branch url> npx vitest run tests/rls.test.ts tests/workspace-rls.test.ts`. Use a disposable branch only, because the suite writes test rows.
4. Record the date, duration, and row counts in the table above, then delete the branch.

## Load and capacity notes

- The matcher loads every active rule and its watch items each pass. At 500 watchlists and 25,000 items, a pass takes about 1 s on PGlite. Past about 50,000 items, move rules and items into a cached in-memory index keyed by `updated_at`.
- `app.alert_delivery` grows by about one row per recipient per event. Archive rows older than 180 days to cold storage.
- Report and briefing PDFs are stored in `app.stored_file` (Postgres `bytea`). Move them to object storage once they exceed about 5 GB.
