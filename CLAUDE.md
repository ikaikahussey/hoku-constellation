@AGENTS.md

# Hoku Constellation — Data & Analytics

Hoku Constellation is a power tracker for Hawaiʻi public life and a premium subscription product for Hoku.FM.

Production: https://constellation.hoku.fm  ·  Repo: https://github.com/ikaikahussey/hoku-constellation

## Stack

Next.js 16 (App Router), TypeScript, React 19, Supabase (Postgres + Auth + RLS + SSR), Stripe, D3 v7, Recharts v3, Fuse.js, Tailwind CSS v4, Vercel.

## Schema (migrations 001–015)

Use existing table/column names exactly.

- **Core entities**: `person` (`full_name`, `aliases` text[], `entity_types` text[]), `organization` (`name`, `aliases` text[], `org_type`, plus `ein` / `dcca_file_number` / `sec_cik` / `fec_committee_id` added in 015)
- **Relationships**: `relationship` — polymorphic edge table with `source_person_id`, `source_org_id`, `target_person_id`, `target_org_id`, `relationship_type`, `title`, `start_date`, `end_date`, `is_current`. Handles officer/director roles, board appointments, lobbyist-client, person-person, org-org.
- **Campaign finance**: `contribution` — `donor_name_raw`, `recipient_name_raw`, `donor_person_id`, `donor_org_id`, `recipient_person_id`, `recipient_org_id`, `match_confidence`, `match_status`, `amount`, `contribution_date`, `election_period`, `source`, `raw_record` jsonb
- **Lobbying**: `lobbyist_registration`, `lobbyist_expenditure`, `org_lobbying_expenditure`
- **Ethics**: `financial_disclosure` — `financial_interests` jsonb
- **PUC**: `puc_docket`, `puc_participant`
- **Editorial**: `article`, `article_entity_mention`
- **Timeline**: `timeline_event`
- **Auth/billing**: `user_profile` (`subscription_tier`, Stripe fields, `alert_person_ids`), `staff_role`
- **Ingestion state**: `import_cursor` (`source`, `cursor_offset`, `last_run_at`, `status`, `metadata` jsonb)
- **New in 015**:
  - Canonical ingestion targets: `legislative_testimony`, `government_contract`, `property_ownership`, `data_source_record`
  - Analytics derived (writable only by service role, can be dropped and rebuilt): `ax_influence_score`, `ax_relationship_edge`, `ax_alert`, `ax_graph_snapshot`

All new ingestion tables follow the `match_status` / `match_confidence` / `*_name_raw` / `raw_record` pattern from `contribution`.

## Architecture — two separate modules

### Ingestion — `scripts/import/`

Standalone TypeScript scripts. Write to canonical tables via `SUPABASE_SERVICE_ROLE_KEY`. Never import from `lib/analytics/`.

Phase 1 sources (already present): `campaign-finance.ts`, `lobbyist-registrations.ts`, `articles.ts`, `financial-disclosures.ts`, `lobbyist-expenditures.ts`.

Added in 015: `usaspending.ts`, `propublica-990.ts`, `sec-edgar.ts`, `testimony.ts`, `property.ts`, `state-procurement.ts`.

Every fetcher is idempotent: SHA-256 checksum dedup via `data_source_record` (helper `scripts/import/utils/dedup.ts`), cursor via `import_cursor`.

Entity resolution lives in `lib/entity-match.ts` — exact-match on structured identifiers (`matchOrganizationByExternalId`) before fuzzy Levenshtein fallback (`matchEntity`). `normalize()` handles ʻokina variants and kahakō so "Kauaʻi" matches "Kauai".

### Analytics — `lib/analytics/`

TypeScript library. Reads canonical tables, writes `ax_*` tables. Never imports from `scripts/`. All exported functions take `SupabaseClient` as first argument — never call `createClient()` internally.

```
lib/analytics/
├── types.ts
├── scoring/           # score-config, dimension-scores, influence-score
├── graph/             # builder, centrality (Brandes + eigenvector, pure TS), pathfinder, clusters, serializer
├── alerts/            # alert-rules, change-detector, alert-store
├── profiles/          # person-profile, org-profile, comparison
├── reports/           # power-map, money-flow (getBillLandscape), issue-tracker, network-report
└── index.ts
```

API routes in `app/api/analytics/`:

- `GET /person/[id]/profile` · `GET /person/[id]/score` · `GET /person/[id]/network`
- `GET /org/[id]/profile`
- `GET /connect/[idA]/[idB]`
- `GET /power-map` · `GET /money-flow/bill/[billNumber]` · `GET /alerts` · `GET /clusters`
- `POST /admin/recompute-scores` · `POST /admin/rebuild-graph` · `POST /admin/detect-changes` (Bearer `CRON_SECRET`, service role)

React components in `components/analytics/`: `NetworkGraph.tsx` (D3 force), `InfluenceScoreCard.tsx` (Recharts radar), `PowerMapTable.tsx`, `AlertFeed.tsx`.

Vercel Cron (`vercel.json`): graph rebuild 09:00 UTC, scores 10:00 UTC, change detection hourly.

## Rules

- Use existing table and column names exactly. `full_name`, not `canonical_name`. `aliases`, not `name_variants`. `relationship`, not `person_organization_role`.
- Board appointments go in `relationship` with `relationship_type = 'appointed_to'` and `title` = board name.
- `relationship` = observed factual connections. `ax_relationship_edge` = analytically derived connections. Do not conflate.
- Analytics functions accept `SupabaseClient` as first parameter. Ingestion scripts use `SUPABASE_SERVICE_ROLE_KEY`. Analytics API routes use user auth context except admin/cron routes, which use `Bearer CRON_SECRET` + service role.
- Graph algorithms are pure TypeScript; no additional npm packages.
- Tests: Vitest + Supabase local dev. No production data in tests.

## Key files

- `supabase/migrations/015_add_ingestion_and_analytics_tables.sql`
- `lib/entity-match.ts`, `scripts/import/utils/dedup.ts`
- `lib/analytics/**`
- `app/api/analytics/**`
- `components/analytics/**`
- `vercel.json`
