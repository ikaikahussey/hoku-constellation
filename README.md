# HOKU Insider

HOKU Insider maps Hawaiʻi's power structure — offices, campaign money, lobbying, contracts,
property, board seats, and the documents behind each connection. Built and published by Hoku.fm at
https://constellation.hoku.fm.

## Develop

```bash
cp .env.example .env.local        # Neon, Neon Auth, Stripe, PostHog keys
npm install
npm run dev
```

`npm test` runs the Vitest suite on an embedded PGlite Postgres (no Docker). `npm run build`,
`npm run lint`, and `npm run typecheck` must pass before pushing. `npx playwright test tests/e2e`
runs browser smoke, accessibility, visual, and analytics-proxy checks.

## Data

- Schema: `db/migrations/001_core_schema.sql` — `entity`, `document`, `edge`, `summary`, `user_account`.
- Ingestion: `lib/import/sources/*` with CLIs in `scripts/import/` and Mac mini workers in `workers/`.
  Source coverage and status: `lib/import/source-registry.ts`, `docs/INGESTION_AUDIT.md`.
- Analytics: `lib/analytics/` (influence scores, network graph, alerts, reports).

## Documentation

`CLAUDE.md` (architecture and rules), `docs/NEON_CUTOVER.md`, `docs/EDGE_TYPES.md`,
`docs/REBRAND.md`, `docs/ANALYTICS_EVENTS.md`, `docs/INGESTION_REPORT.md`.
