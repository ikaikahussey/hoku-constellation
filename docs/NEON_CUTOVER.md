# Neon cutover runbook

Target: move production from Supabase project `fdphdzbjdtbxxexgyfba` (us-east-2) to Neon Postgres + Neon Auth (Managed Better Auth) + Neon Data API, on the five-table core schema in `db/migrations/001_core_schema.sql`.

State at inventory (2026-09-28): the Supabase project was **paused (INACTIVE)**; it was restored for the inventory. `auth.users` has **0 rows**, `user_profile` 0, `staff_role` 0. There are no accounts to migrate and no password hashes to consider. Production traffic to the current site therefore has no signed-in users to disrupt.

## 0. Prerequisites (owner, Neon console)

1. Create a Neon project **hoku-insider** in AWS `us-east-2` (same region as Vercel functions and the old Supabase project). Postgres 17. Branch `main` = production.
2. Enable extensions on `main`: `pgvector`, `pg_trgm` (the migration runs `create extension if not exists`; the owner role can do this).
3. Enable **Data API** on `main` → check **Use Managed Better Auth** → leave **Grant public schema access unchecked** (the migration grants exactly what `authenticated` / `anonymous` may read). Copy the Data API URL (`https://ep-….apirest.….neon.tech/neondb/rest/v1`).
4. In **Auth → Configuration**: copy the Auth URL (`https://ep-….neonauth.….neon.tech/neondb/auth`). Enable **Email & password**. Enable **Email verification** and **Password reset** emails. Set sender name **HOKU Insider** and the email templates (see docs/REBRAND.md). Add OAuth providers only if any were configured in Supabase (none were: `auth.identities` is empty).
   - Add trusted origins: `https://constellation.hoku.fm`, `https://*.vercel.app` (preview), `http://localhost:3000`.
5. Create a limited role for ingestion (optional but recommended): `create role ingest_writer login password '…'; grant usage on schema public to ingest_writer; grant select, insert, update on entity, document, edge, import_cursor to ingest_writer; grant select on ax_influence_score to ingest_writer;` — no grants on `summary` or `ax_*` writes. Workers use this role's connection string as `DATABASE_URL`.
6. Install the **Neon ↔ Vercel integration** on the `hoku-constellation` Vercel project (team *Add Homonym*) with **Preview Branching** enabled so every preview deployment gets its own Neon branch and Neon Auth instance.

## 1. Rehearsal (Neon branch `rehearsal` from `main`)

```bash
# 1. Dump Supabase public schema (unpooled connection; restore project first if paused)
pg_dump --schema=public --no-owner --no-privileges -Fc "$SUPABASE_DB_URL" -f legacy.dump

# 2. Apply core schema to the rehearsal branch
psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f db/migrations/001_core_schema.sql

# 3. Restore the dump into a `legacy` schema:
#    pg_restore cannot rename schemas, so restore into a scratch database and move it, or:
createdb -h … scratch && pg_restore --no-owner --no-acl -d "$SCRATCH_URL" legacy.dump
psql "$SCRATCH_URL" -c 'alter schema public rename to legacy'
pg_dump --schema=legacy --no-owner --no-privileges "$SCRATCH_URL" | psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1
#    (or run scripts/db/restore-legacy.sh which performs these steps)

# 4. Port + reconcile (idempotent; re-run inserts 0 rows)
npx tsx scripts/db/port-legacy.ts --markdown docs/PORT_RECONCILIATION.md

# 5. Rebuild analytics
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<preview>/api/analytics/admin/rebuild-graph
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<preview>/api/analytics/admin/recompute-scores

# 6. Tests against the branch
TEST_DATABASE_URL="$DATABASE_URL_UNPOOLED" npm test          # schema, RLS, port, analytics suites on real Neon roles
npm run lint && npm run typecheck && npm run build
npx playwright test tests/e2e                                 # auth flows, smoke, a11y, PostHog ingest
```

Vercel preview env for the rehearsal: `DATABASE_URL`, `DATABASE_URL_UNPOOLED` (injected by the integration), `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `NEXT_PUBLIC_NEON_AUTH_URL`, `NEXT_PUBLIC_NEON_DATA_API_URL`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, Stripe test keys, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`.

Analytics parity: `scripts/db/parity-snapshot.ts --entities <10 ids> --base https://constellation.hoku.fm --out parity/before.json` before the port and `--out parity/after.json` on the preview; `scripts/db/parity-diff.ts parity/before.json parity/after.json` lists differences, each of which must be explained in docs/PORT_RECONCILIATION.md (expected: ids identical for person/org; `relationship_type` values remapped per docs/EDGE_TYPES.md; `recipient_matched` → `review`).

## 2. Production cutover (in order)

1. **Supabase read-only.** Supabase Dashboard → Project Settings → Database → *Read-only mode* on (or `alter database postgres set default_transaction_read_only = on;`). Note the time.
2. **Pause workers.** On the Mac mini: `workers/uninstall.sh` (unloads every `fm.hoku.constellation.*` launchd agent).
3. **Final dump** → `legacy` schema on Neon `main` (steps 1–3 above against `main`).
4. **Port + reconcile** on `main`: `npx tsx scripts/db/port-legacy.ts --markdown docs/PORT_RECONCILIATION.md`. Stop if the report lists unexplained differences or the re-run inserted rows.
5. **User migration.** `npx tsx scripts/db/migrate-users.ts` — with 0 `auth.users` this writes 0 rows to `migration_user_map` and prints the count. If users exist at cutover time: it creates each user in Neon Auth by email through the Better Auth admin API (`POST /admin/create-user`), records `migration_user_map`, then re-runs the `user_account` section of the port. Neon Auth does not import Supabase bcrypt hashes, so migrated users are created without a password and receive a password-reset email (`POST /request-password-reset`). Report the affected count before running.
6. **Vercel env.** Remove `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Add the Neon vars above for Production and Preview. Add `CRON_SECRET` to Production (it was only set for Preview/Development).
7. **Deploy** the `main` branch. Vercel Cron picks up `vercel.json` (graph 09:00 UTC, scores 10:00 UTC, change detection hourly).
8. **Rebuild analytics** (rebuild-graph, recompute-scores) once.
9. **Reload workers** against Neon: fill `workers/.env` from `workers/.env.example`, then `workers/install.sh`. Run each worker once with `--dry`.
10. **Smoke test** production: `BASE_URL=https://constellation.hoku.fm npx playwright test tests/e2e/smoke.spec.ts`.
11. **Stripe.** Point the webhook endpoint at the new deployment (same URL, so no change) and send a test event from the Stripe dashboard; confirm `user_account` updates.
12. **Rotate the leaked Supabase service-role key** (it was committed in four `.mjs` scripts, now deleted) — Supabase Dashboard → Settings → API → *Reset service_role key*. Do this even though the project will be retired.

## 3. Rollback (kept for 30 days)

- Supabase stays **read-only, not paused**, for 30 days after cutover.
- To roll back: redeploy the last pre-cutover commit (`73dbd8c`), restore the three Supabase env vars in Vercel, turn read-only off, and reload the old workers from that commit. Data written to Neon after cutover is not replayed to Supabase.
- After 30 days: `drop schema legacy cascade; drop table migration_user_map;` on Neon `main`, delete the Supabase project.

## 4. Verified Neon facts (recorded against the live docs on 2026-09-28)

| Claim in the brief | Verified | Note |
|---|---|---|
| Neon Auth is managed Better Auth | Yes | Now branded **"Managed Better Auth"** in Neon docs; packages remain `@neondatabase/auth` (0.5.0-beta) and `@neondatabase/neon-js` (0.7.0-beta). |
| Users, sessions, config live in `neon_auth` and branch with the database | Yes | `neon_auth."user"` (`id text`). Preview branches get their own Neon Auth instance and `NEON_AUTH_BASE_URL`. The `user_account.user_id` FK to `neon_auth."user"` is added conditionally by the migration. |
| Data API is PostgREST-compatible and enforces RLS via JWT `sub` and `auth.user_id()` | Yes | `auth.user_id()` returns `sub` as text; `auth.uid()` parses it as uuid. Roles are `authenticated` and `anonymous`. Data API is enabled per branch for one database. Not supported with IP Allow or Private Networking. |
| `@neondatabase/auth` includes a Supabase-compatible adapter | Yes | `SupabaseAuthAdapter` (`signInWithPassword`, `signUp`, `getSession`, …). Not used in this codebase: the app calls the Better Auth API directly (`signIn.email`, `signUp.email`, `signIn.social`, `requestPasswordReset`). |
| Next.js server SDK | Yes | `createNeonAuth` from `@neondatabase/auth/next/server` with `NEON_AUTH_BASE_URL` + `NEON_AUTH_COOKIE_SECRET` (≥ 32 chars); `.handler()` for `app/api/auth/[...path]/route.ts`, `.middleware()` for `proxy.ts`. |
| Password import | No import API | Neon Auth exposes `admin/create-user` and `admin/set-user-password` but no bcrypt-hash import. Migrated accounts get a reset email. Moot at present (0 users). |
| Serverless driver | Yes | `@neondatabase/serverless` Pool over WebSockets for `pg`-compatible transactions (`lib/db/service.ts`); `pg` Pool on the Mac mini. |
| Next.js 16 | — | `middleware.ts` is deprecated and renamed `proxy.ts` (used here). `cookies()`, `params`, `searchParams` are async. |

Discrepancy from the brief: the documentation URLs `neon.com/docs/neon-auth/*` and `/docs/ai/skills/*` now redirect to `/docs/auth/*` and the `neondatabase/agent-skills` repository. Docs were read from the public `neondatabase/website` and `neondatabase/agent-skills` GitHub sources because `neon.com` was unreachable from the build container.
