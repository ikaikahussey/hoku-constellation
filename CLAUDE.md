@AGENTS.md

# HOKU Insider

HOKU Insider maps Hawaiʻi's power structure: who holds office, who funds whom, who lobbies, who
owns what, and how they connect. It is a premium subscription product from Hoku.fm.

Production: https://constellation.hoku.fm (domain unchanged by the rebrand; `NEXT_PUBLIC_SITE_URL`
is the single source of truth). Repo: https://github.com/ikaikahussey/hoku-constellation.

## Stack

Next.js 16 (App Router, `proxy.ts` not middleware, async `params`/`cookies()`), React 19,
TypeScript, Tailwind CSS v4 (`@theme` tokens), Neon Postgres (pgvector, pg_trgm, RLS),
Neon Auth (Managed Better Auth), Neon Data API (PostgREST), Stripe, PostHog, Vercel Speed Insights,
D3 v7, Recharts v3. Tests: Vitest on PGlite (no Docker), Playwright for e2e.

## Schema — five core tables (`db/migrations/001_core_schema.sql`)

| table | purpose |
|---|---|
| `entity` | people, organizations, bills, dockets, parcels, offices. `kind`, `name`, `aliases`, `identifiers` jsonb (ein, fec_id, sec_cik, measure, docket_number, tmk, csc_reg_no…), `attributes` jsonb validated per kind by `lib/schema/attributes.ts`, `merged_into_id` |
| `document` | every source record: `source`, `source_record_id`, `doc_type`, `checksum` (sha256 of the canonicalized raw record), `raw` jsonb, `body_text`, `embedding` vector(1024) |
| `edge` | one fact from one document: `type` (23-value vocabulary, `docs/EDGE_TYPES.md`), `from_id`/`to_id`, `from_name_raw`/`to_name_raw`, `role`, `amount`, dates, `match_status` (matched/review/unmatched), `match_confidence`, `document_id`. Unique on (document_id, type, from_name_raw, to_name_raw, role) |
| `summary` | generated narrative per entity with `tier` and `status` |
| `user_account` | Neon Auth user id → `subscription_tier`, Stripe fields, `is_staff`, `watch_entity_ids` |

Team workspace data lives in the `app` schema (`db/migrations/003_app_workspace.sql`): `app.team`,
`team_member`, `invitation`, `client`, `watchlist`, `watchlist_item`, `alert_rule`, `alert_event`,
`alert_delivery`, `note`, `report`, `briefing`, `correction`, plus `stored_file`, `user_pref`, `ask_log`,
`usage_event`, `matcher_state`. RLS on every table: members see only their team; staff read all.
Entitlements come from `app.entitlements(user_id)` (team plan → tier + feature flags; legacy
`user_account` tiers map onto it), mirrored in `lib/entitlements.ts`. Never check `subscription_tier` directly.

Supporting: `import_cursor`, `migration_user_map`, and the derived `ax_influence_score`,
`ax_relationship_edge`, `ax_alert`, `ax_graph_snapshot` (rebuildable; service role only).
Legacy Supabase migrations are archived in `db/legacy_migrations/` and are not applied.

Access is gated in SQL (`app.is_paid()`, `app.paid_doc_types()`, `app.paid_edge_types()`) and
mirrored in `lib/db/gating.ts`. Free tier sees public doc/edge types; paid sees money, lobbying,
property, and ethics types; staff sees everything including `review`/`unmatched` edges.

## Code layout

- `lib/db/` — `Db` interface (`query`, `one`, `many`, `transaction`, `end`); `getServiceDb()`
  (service role, server only), `getUserClient()` (Data API with the session JWT, RLS enforced),
  `queries/` (entities, edges, money, documents, summaries, search, accounts). Every analytics or
  query function takes `Db` as its first argument. Never create a connection inside a library function.
- `lib/auth.ts` — `getAuth()`, `getCurrentUser()` → `{ account, entitlements, isStaff, canAccessGated, … }`.
  Offline e2e sessions (`E2E_TEST_AUTH_SECRET`, localhost only) are the only non-Neon sign-in path.
- `lib/workspace.ts` — `requireWorkspace()` → user, active team, team features. `lib/teams.ts` (membership,
  invitations, seats), `lib/billing/` (Stripe seats/invoices/webhook; prices in `config/pricing.json`).
- `lib/alerts/` — matcher (new documents/edges → `app.alert_event`), delivery (Resend, Slack, digests,
  burst collapse, quiet hours), called after each import batch and by `workers/alerts.ts`.
- `lib/ai/` (Claude client + citation validator), `lib/reports/`, `lib/briefings/`, `lib/ask/`,
  `lib/render/` (PDF/DOCX), `lib/export/` (CSV/ICS), `lib/ops/` (coverage, freshness, partner usage),
  `lib/corrections/`. Every AI sentence cites a document id or the output is rejected.
- `lib/entity-match.ts` — `normalize()` (ʻokina/kahakō aware), `matchByIdentifier(s)`,
  `fuzzyMatch`, `resolveEntity` (identifier → fuzzy; bills/dockets/parcels never fuzzy-merge;
  follows `merged_into_id`).
- `lib/analytics/` — scoring, graph (pure TS centrality/pathfinding), alerts, profiles, reports.
  Reads core tables, writes `ax_*`. Never imports from `lib/import/`.
- `lib/import/` — ingestion: `http.ts` (polite client), `clients/`, `pipeline.ts`
  (`upsertDocument` → `resolveRef` → `insertEdge`, `processRecord`), `run.ts` (`runImporter`,
  `--dry`), `source-registry.ts`, `sources/<source>.ts` exporting `SOURCE_KEY` + `importBatch(db, offset, batchSize, opts)`,
  `priority.ts` (targeted csc/fec pass for staff-flagged `attributes.is_priority` entities, run daily ahead of the sweeps;
  flag with `scripts/db/prioritize.ts`, see `docs/OPERATIONS.md`). Never imports from `lib/analytics/`.
- `scripts/import/<source>.ts` CLI wrappers; `workers/import-<source>.ts` + `workers/launchd/*.plist`
  for the Mac mini; `scripts/db/` port, reconcile, user migration, parity tools.
- `app/api/analytics/**` (subscriber routes), `app/api/v1/**` (API tier), `app/api/admin/**`
  (staff session), `app/api/auth/[...path]` (Neon Auth handler), `app/api/webhook/stripe`.
- `components/brand/Wordmark.tsx`, `components/ui/*`, `components/graph/*`, `components/analytics/*`.
- `app/providers.tsx` + `lib/analytics-events.ts` — PostHog. Event names only from `EVENTS`.

## Rules

- Use existing table and column names exactly. `entity.name`, not `full_name`; `edge`, not `relationship`.
- Observed facts go in `edge`; analytically derived links go in `ax_relationship_edge`. Never conflate.
- Importers: document first (checksum dedup), then resolve entities, then edges. Only create entities
  from authoritative rosters or when an identifier is present; otherwise leave `*_name_raw` for review.
- Design: black and white only, red `#CC0000` for links only, colors defined once in
  `app/globals.css` `@theme`, weights 400/700, Helvetica stack. `tests/design-tokens.test.ts` and
  the ESLint `no-restricted-syntax` rule fail on literals elsewhere. `docs/REBRAND.md` has the details.
- Product name is "HOKU Insider" (HOKU uppercase). `tests/brand-name.test.ts` fails on
  the former product name outside the domain, repo name, launchd labels, and env/DB identifiers.
- AI output: only facts from the database go to the model; every sentence must cite a supplied
  document (`lib/ai/citations.ts`); fall back to facts-only. Nothing is emailed to a client without approval.
- Analytics events: names from `EVENTS`; never send emails, names, or raw search text; identify with
  `subscription_tier`, `is_staff`, `signup_date` only.
- Never bypass auth, CAPTCHA, or terms of service when fetching. Never ingest the voter registration file.
- Tests run on PGlite (`tests/helpers/pglite.ts`); set `TEST_DATABASE_URL` to run them on a Neon branch.
  No production data in tests.

## Commands

```
npm run dev · npm run build · npm run lint · npm run typecheck · npm test
npx tsx --tsconfig tsconfig.scripts.json scripts/import/<source>.ts --dry --limit=50
npx tsx --tsconfig tsconfig.scripts.json scripts/db/port-legacy.ts --markdown docs/PORT_RECONCILIATION.md
npx playwright test tests/e2e
```

## Key docs

`docs/NEON_CUTOVER.md`, `docs/MIGRATION_INVENTORY.md`, `docs/PORT_RECONCILIATION.md`,
`docs/EDGE_TYPES.md`, `docs/REBRAND.md`, `docs/ANALYTICS_EVENTS.md`, `docs/INGESTION_AUDIT.md`,
`docs/INGESTION_REPORT.md`, `docs/HAWAII_CORPORATIONS.md`, `docs/PRICING.md`, `docs/OPERATIONS.md`,
`docs/LEGAL_REVIEW_PACKET.md`.
