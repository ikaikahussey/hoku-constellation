# Migration inventory — Supabase → Neon

Snapshot taken 2026-09-28 against Supabase project `fdphdzbjdtbxxexgyfba` ("Hoku Constellation", us-east-2, Postgres 17). The project was **paused (INACTIVE)** when the inventory started and was restored to read it. Every fact below was read live via the Supabase management API or from the repository at commit `73dbd8c`.

## 1. Supabase touchpoints in code (102 files referenced Supabase)

### Clients

| File | Call | Purpose |
|---|---|---|
| `lib/supabase/server.ts` | `createServerClient` (@supabase/ssr) with cookie adapter | RSC / route-handler client bound to the user session (anon key + cookies) |
| `lib/supabase/client.ts` | `createBrowserClient` | Browser client for login/signup/admin forms |
| `lib/supabase/admin.ts` | `createClient(url, SUPABASE_SERVICE_ROLE_KEY)` | Privileged client for imports, cron, webhook, analytics batch |
| `workers/lib/supabase.ts` | `createClient(url, SUPABASE_SERVICE_ROLE_KEY)` | Mac mini workers |

### Auth calls

| File | Call |
|---|---|
| `lib/auth.ts` | `auth.getUser()` |
| `app/api/analytics/_lib/auth.ts` | `auth.getUser()` |
| `app/api/v1/_lib/auth.ts` | `auth.getUser()` |
| `app/account/page.tsx` | `auth.getUser()`, `auth.signOut()` |
| `app/auth/login/page.tsx` | `auth.signInWithPassword()` |
| `app/auth/signup/page.tsx` | `auth.signUp()` (with `options.data.full_name`) |
| `app/auth/callback/route.ts` | `auth.exchangeCodeForSession(code)` |

No Supabase Storage, Realtime, or `rpc()` calls exist. No OAuth providers were configured (`auth.identities` is empty).

### PostgREST table access (`.from(...)`) by file

| File | Tables |
|---|---|
| `lib/auth.ts` | user_profile, staff_role |
| `lib/entity-match.ts` | organization |
| `lib/import/auto-create.ts` | person |
| `lib/import/sources/csc.ts` | person (via ensurePersons), contribution |
| `lib/import/sources/fec.ts` | person, contribution |
| `lib/import/sources/lobbyist.ts` | organization, lobbyist_registration |
| `lib/import/sources/puc.ts` | puc_docket |
| `lib/search.ts` | person, organization (textSearch) |
| `lib/analytics/scoring/batch-recompute.ts` | person, contribution, organization, relationship, lobbyist_registration, lobbyist_expenditure, legislative_testimony, property_ownership, government_contract, article_entity_mention, ax_relationship_edge, ax_influence_score |
| `lib/analytics/scoring/dimension-scores.ts` | contribution, relationship, person, lobbyist_registration, lobbyist_expenditure, legislative_testimony, property_ownership, government_contract, ax_influence_score, article_entity_mention |
| `lib/analytics/scoring/influence-score.ts` | ax_influence_score, person |
| `lib/analytics/graph/builder.ts` | contribution, relationship, legislative_testimony, lobbyist_registration, ax_relationship_edge |
| `lib/analytics/graph/pathfinder.ts` | ax_relationship_edge, person |
| `lib/analytics/alerts/alert-rules.ts` | contribution, lobbyist_registration, relationship, government_contract, property_ownership, legislative_testimony |
| `lib/analytics/alerts/alert-store.ts`, `change-detector.ts` | ax_alert |
| `lib/analytics/profiles/person-profile.ts` | person, relationship, contribution, lobbyist_registration, legislative_testimony, property_ownership, financial_disclosure, ax_influence_score, ax_relationship_edge, ax_alert, government_contract |
| `lib/analytics/profiles/org-profile.ts` | organization, contribution, lobbyist_registration, relationship, government_contract, property_ownership, article_entity_mention |
| `lib/analytics/profiles/comparison.ts` | ax_influence_score, person |
| `lib/analytics/reports/issue-tracker.ts` | lobbyist_registration, legislative_testimony |
| `lib/analytics/reports/money-flow.ts` | legislative_testimony, lobbyist_registration, relationship, contribution |
| `lib/analytics/reports/network-report.ts` | ax_relationship_edge, person, ax_influence_score |
| `lib/analytics/reports/power-map.ts` | ax_influence_score (+ embedded person) |
| `app/api/admin/import-source/route.ts` | contribution, lobbyist_registration, puc_docket, person |
| `app/api/admin/worker-status/route.ts` | import_cursor, ax_influence_score, ax_graph_snapshot, ax_alert, person, organization, relationship, contribution, lobbyist_registration, puc_docket, ax_relationship_edge |
| `app/api/analytics/**` (12 routes) | via lib/analytics + ax_influence_score, ax_graph_snapshot, user_profile, staff_role |
| `app/api/cron/import-{csc,fec,lobbyist,puc}/route.ts` | import_cursor |
| `app/api/import/route.ts` | contribution, lobbyist_registration, lobbyist_expenditure, financial_disclosure |
| `app/api/search/route.ts` | person, organization |
| `app/api/v1/**` (13 routes) | person, organization, contribution, relationship, puc_docket, puc_participant, article_entity_mention, timeline_event, user_profile |
| `app/api/webhook/stripe/route.ts` | user_profile |
| `app/admin/**` (13 pages) | person, organization, article, contribution, relationship, timeline_event, article_entity_mention, import_cursor |
| `app/account/page.tsx` | user_profile |
| `app/explore/page.tsx`, `app/search/page.tsx`, `app/person/[slug]/page.tsx`, `app/org/[slug]/page.tsx` | person, organization, relationship, article_entity_mention, timeline_event, contribution, puc_participant |
| `components/admin/PersonForm.tsx`, `OrgForm.tsx` | person, organization (browser writes) |
| `scripts/import/*.ts` (11), `scripts/seed.ts`, `scripts/import/utils/*` | all canonical tables via service role |
| `scripts/*.mjs` (5) | REST calls with a **hard-coded service-role JWT** (see §8) |
| `workers/*.ts` (7) | import_cursor, ax_* via lib/analytics |
| `next.config.ts` | `images.remotePatterns` for `**.supabase.co` |

## 2. RLS policies and functions using `auth.*`

47 `auth.uid()` references across `012_rls_policies.sql`, `014_fix_staff_role_recursion.sql`, `015_add_ingestion_and_analytics_tables.sql`. Live `pg_policies` for schema `public` (49 policies):

| Table | Policies (cmd → rule) |
|---|---|
| person, organization, relationship, puc_docket, puc_participant, article, article_entity_mention, timeline_event | SELECT `true` (public); ALL `auth.uid() in staff_role` |
| contribution, lobbyist_registration, lobbyist_expenditure, org_lobbying_expenditure, financial_disclosure, legislative_testimony, government_contract, property_ownership | SELECT: `auth.uid()` in user_profile with tier ∈ {individual, professional, institutional} and status ∈ {active, trialing}, or staff; ALL staff |
| data_source_record | SELECT staff; ALL staff |
| ax_influence_score, ax_relationship_edge, ax_alert, ax_graph_snapshot | SELECT subscribers or staff; ALL `to service_role using(true)` |
| user_profile | SELECT own or staff; UPDATE own; ALL `using(true)` ("Service role can manage profiles" — effectively open to any role, a latent defect) |
| staff_role | SELECT own (014 replaced the recursive staff-reads-staff policy) |

No functions in `public` reference `auth.*` (checked `pg_proc`). No triggers.

**Core-schema equivalents** (`db/migrations/001_core_schema.sql`): public read for `entity`; type-gated read for `document`/`edge` via `app.can_read_doc_type` / `app.can_read_edge_type` (paid types = the eight subscriber-only legacy tables); `summary` free/paid/draft rules; `user_account` owner-only + staff; `ax_*` paid/staff read; no user write grants anywhere. The open `user_profile ALL using(true)` policy is **not** replicated. All legacy rules are expressible; none required a workaround. `subscription_status` was added to `user_account` because the legacy gate depends on it.

## 3. Foreign keys to `auth.users`

None in `public`. `user_profile.id` and `staff_role.user_id` are unconstrained `uuid` columns that the app filled with `auth.uid()`. The only FKs to `auth.users` are Supabase-internal (`auth.identities`, `auth.sessions`, `auth.mfa_*`, `auth.one_time_tokens`, `auth.oauth_*`, `auth.scim_users`, `auth.webauthn_*`).

## 4. Environment variables

| Variable | Where used | Vercel (Production) | Vercel (Preview/Dev) | Disposition |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | lib/supabase/*, scripts, workers | set | — | **remove** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | lib/supabase/client, server | set | — | **remove** |
| `SUPABASE_SERVICE_ROLE_KEY` | admin client, scripts, workers | set | — | **remove**, rotate |
| `SUPABASE_URL` | workers/lib/supabase.ts | — | — | remove |
| `NEXT_PUBLIC_SITE_URL` | layout metadataBase | set | — | keep; also Preview |
| `CRON_SECRET` | cron/admin routes | **not set** | set | add to Production |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_INDIVIDUAL_MONTHLY/YEARLY`, `STRIPE_PRICE_PROFESSIONAL_MONTHLY/YEARLY` | lib/stripe, webhook | **not set** | — | Stripe is not configured in Vercel; add when live |
| `FEC_API_KEY` | lib/import/sources/fec.ts | not set (falls back to DEMO_KEY) | — | keep |
| New: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `NEXT_PUBLIC_NEON_AUTH_URL`, `NEXT_PUBLIC_NEON_DATA_API_URL`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, `SAM_API_KEY`, `DATA_GOV_API_KEY`, `LDA_API_TOKEN`, `SOCRATA_APP_TOKEN`, `CONGRESS_API_KEY` | see `.env.example` | — | — | add |

Vercel project: `hoku-constellation` (`prj_tKAdZ41D1kCVAPRNwRGJ2DgbhEPA`, team *Add Homonym*). `vercel.json` had `"crons": []` — no Vercel cron was running; the Mac mini launchd agents were the only scheduler.

## 5. Row counts (live, exact)

| Table | Rows | Notes |
|---|---:|---|
| person | 33,724 | all `visibility = public`; 5 with `ein`-bearing org links |
| organization | 717 | 710 public / 7 gated; 5 with `ein` |
| relationship | 6 | types: executive_oversight 1, former_executive 1, former_member 2, leadership 2 |
| contribution | 221,344 | hawaii_csc 220,344 (Σ $159,062,121.80); fec 1,000 (Σ $474,442.40); all `match_status = recipient_matched`; `donor_org_id` null everywhere; 0 null raw_record; 0 null dates |
| lobbyist_registration | 3,932 | all have both person and org ids |
| lobbyist_expenditure | 0 | |
| org_lobbying_expenditure | 0 | |
| financial_disclosure | 0 | |
| puc_docket | 12 | curated list (no PUC API) |
| puc_participant | 22 | regulator 12, regulated_entity 7, applicant 3 |
| article | 0 | |
| article_entity_mention | 0 | |
| timeline_event | 7 | election 4, appointment 2, announcement 1 |
| user_profile | 0 | |
| staff_role | 0 | |
| import_cursor | 7 | hawaii_csc (offset 122,344), fec, lobbyist, puc, propublica_990, sec_edgar, usaspending — all `complete`, last runs 2026-04-14 → 04-17 |
| legislative_testimony | 0 | |
| government_contract | 100 | usaspending, Σ $14,663,541,674.00 |
| property_ownership | 0 | |
| data_source_record | 107 | usaspending 100, propublica_990 5, sec_edgar 2 |
| ax_influence_score | 33,430 | derived, rebuilt after port |
| ax_relationship_edge | 22,539 | derived |
| ax_alert | 100 | derived |
| ax_graph_snapshot | 2 | derived |

## 6. Auth users by provider

| Provider | Users |
|---|---:|
| (any) | **0** |

`auth.users` = 0, `auth.identities` = 0, `auth.sessions` = 0. No passwords to migrate, no OAuth providers to reconfigure. Sign-up had never completed on production.

## 7. Queries against tables that are removed

Every table other than `import_cursor` and the four `ax_*` tables is removed. All queries in `lib/analytics/**` and `app/api/**` listed in §1 therefore had to be rewritten; they now read `entity` / `document` / `edge` through `lib/db`. `lib/search.ts` (textSearch on person/organization) is replaced by `lib/db/queries/search.ts` (trigram + optional embeddings). `scripts/import/utils/dedup.ts` (data_source_record) is replaced by `lib/import/pipeline.ts` (document checksum).

## 8. Secrets committed to the repository

`scripts/fetch-fec-contributions.mjs`, `scripts/fetch-fec-edcase.mjs`, `scripts/import/csc-contributions-full.mjs`, `scripts/import/lobbyist-registrations.mjs`, `scripts/seed-puc-dockets.mjs` embedded the Supabase **service-role JWT** for the production project (exp 2036). The files are deleted in this migration; the key must still be rotated in the Supabase dashboard because it remains in git history. Owner action listed in `docs/NEON_CUTOVER.md` §2.12.

## 9. User-facing brand occurrences ("Hoku Constellation" / "Constellation" / logo)

| Location | Occurrence |
|---|---|
| `app/layout.tsx` | metadata title default + template, description, `openGraph.siteName` |
| `app/page.tsx` | hero paragraph, "Public data, finally connected" paragraph, CTA paragraph, constellation dot SVG art |
| `app/person/[slug]/page.tsx`, `app/org/[slug]/page.tsx` | generateMetadata description + OG title suffix |
| `app/search/page.tsx`, `app/pricing/page.tsx`, `app/explore/page.tsx` | metadata descriptions ("Explore … featured constellations") |
| `app/pricing/page.tsx` | feature copy "Relationship constellation maps"; mailto `constellation@hoku.fm` (kept) |
| `app/api/og/route.tsx` | default name, footer "HOKU / CONSTELLATION", navy/gold palette |
| `components/layout/Header.tsx`, `Footer.tsx`, `AdminNav.tsx` | wordmark "HOKU CONSTELLATION" |
| `components/layout/PaywallGate.tsx` | "available to Hoku Constellation subscribers" |
| `components/constellation/*` | component names ConstellationGraph / Legend / Wrapper; "render a constellation map" |
| `lib/stripe/config.ts` | feature "Relationship constellation maps" |
| `app/auth/login/page.tsx`, `signup/page.tsx` | wordmark |
| `public/logo-constellation.svg`, `app/favicon.ico` | logo / favicon |
| `README.md` | create-next-app boilerplate (no brand) |
| `workers/status.sh` | "Hoku Constellation Workers" banner |
| `scripts/import/sec-edgar.ts` | User-Agent "Hoku Constellation research@hoku.fm" |
| `CLAUDE.md` | product description |
| Internal holdovers (kept, see docs/REBRAND.md) | repo name `hoku-constellation`, launchd labels `fm.hoku.constellation.*`, Vercel project name, Supabase project name, domain `constellation.hoku.fm`, mailto `constellation@hoku.fm`, Neon project may be named `hoku-insider` |

## 10. Ingestion state

| Importer | Status | Notes |
|---|---|---|
| CSC (`lib/import/sources/csc.ts`) | live, worked | CKAN resource discovered by search; dedup by `raw_record->>_id` per batch; 220,344 rows; cursor offset 122,344 on last run |
| FEC (`lib/import/sources/fec.ts`) | live, worked | 3 hard-coded candidates, 10 pages × 100, no dedup (re-runs duplicate) — 1,000 rows |
| Lobbyist (`lib/import/sources/lobbyist.ts`) | live, worked | inserts registrations without dedup; 3,932 rows; org match by exact lowercase name |
| PUC (`lib/import/sources/puc.ts`) | curated | 6 hard-coded dockets upserted; no API |
| `scripts/import/usaspending.ts` | worked once | 100 rows, dedup via data_source_record |
| `scripts/import/propublica-990.ts` | worked once | 5 orgs enriched |
| `scripts/import/sec-edgar.ts` | worked once | 2 CIKs; DEF 14A parsing stubbed |
| `scripts/import/{state-procurement,property,testimony}.ts` | scaffolds | require `--file`; never ran (0 rows) |
| `scripts/import/{campaign-finance,financial-disclosures,lobbyist-expenditures,lobbyist-registrations,articles}.ts` | CSV scaffolds | never ran (0 rows in target tables) |
