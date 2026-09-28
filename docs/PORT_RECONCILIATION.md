# Port reconciliation — legacy → core

> **Sample-dataset run.** This report was produced from the in-repo legacy fixture (tests/helpers/legacy.ts) on PGlite because the build container cannot reach Neon or Supabase. At rehearsal and again at cutover, regenerate it against the real `legacy` schema with `npx tsx scripts/db/port-legacy.ts --markdown docs/PORT_RECONCILIATION.md`. The production legacy row counts to reconcile against are recorded in docs/MIGRATION_INVENTORY.md §5 (person 33,724; organization 717; relationship 6; contribution 221,344 / Σ $159,536,564.20; lobbyist_registration 3,932; puc_docket 12; puc_participant 22; timeline_event 7; government_contract 100 / Σ $14,663,541,674.00; data_source_record 107; import_cursor 7; all other tables 0).

Generated 2026-09-28T03:05:51.275Z by `scripts/db/port-legacy.ts`.

| Legacy table | Legacy rows | Documents | Edges | Entities | Σ amount (legacy) | Σ amount (core) | matched | review | unmatched | distinct entities (legacy → core) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| article | 1 | 1 | 0 | 0 | — | — | 0 | 0 | 0 | 0 → 0 |
| article_entity_mention | 2 | 0 | 2 | 0 | — | — | 0 | 0 | 0 | 2 → 2 |
| contribution | 6 | 6 | 6 | 0 | 3,380.5 | 3,380.5 | 2 | 2 | 2 | 4 → 4 |
| data_source_record | 2 | 2 | 0 | 0 | — | — | 0 | 0 | 0 | 0 → 0 |
| financial_disclosure | 1 | 1 | 1 | 0 | — | — | 0 | 1 | 0 | 1 → 1 |
| government_contract | 2 | 2 | 2 | 0 | 2,772,175,518.15 | 2,772,175,518.15 | 1 | 0 | 1 | 1 → 2 |
| import_cursor | 2 | 0 | 0 | 0 | — | — | 0 | 0 | 0 | 0 → 0 |
| legislative_testimony | 3 | 3 | 3 | 2 | — | — | 2 | 0 | 1 | 2 → 4 |
| lobbyist_expenditure | 1 | 1 | 1 | 0 | 1,234.56 | 1,234.56 | 1 | 0 | 0 | 2 → 2 |
| lobbyist_registration | 2 | 2 | 2 | 0 | — | — | 1 | 0 | 1 | 2 → 2 |
| org_lobbying_expenditure | 1 | 1 | 1 | 0 | 50,000 | 50,000 | 0 | 1 | 0 | 1 → 1 |
| organization | 6 | 0 | 0 | 6 | — | — | 0 | 0 | 0 | 6 → 6 |
| person | 5 | 0 | 0 | 5 | — | — | 0 | 0 | 0 | 5 → 5 |
| property_ownership | 2 | 2 | 2 | 1 | — | — | 1 | 1 | 0 | 1 → 2 |
| puc_docket | 2 | 2 | 0 | 2 | — | — | 0 | 0 | 0 | 2 → 2 |
| puc_participant | 2 | 2 | 2 | 0 | — | — | 2 | 0 | 0 | 2 → 3 |
| relationship | 8 | 8 | 8 | 0 | — | — | 8 | 0 | 0 | 10 → 10 |
| timeline_event | 2 | 2 | 2 | 0 | — | — | 2 | 0 | 0 | 2 → 2 |
| user_profile | 2 | 0 | 0 | 0 | — | — | 0 | 0 | 0 | 0 → 0 |

## Rows inserted by this run

entity 16, document 35, edge 32, user_account 1, import_cursor 2

## Re-run (idempotency check)

entity 0, document 0, edge 0, user_account 0, import_cursor 0 rows inserted

## Unexplained differences

None.

## Explained differences

- `article_entity_mention` rows do not get their own document: the mention edge cites the article document (one document per article, one edge per mention).
- `user_profile` rows are ported only where `migration_user_map` maps the legacy `auth.users` id to a Neon Auth user id. Production had 0 users at inventory time.
- `ax_*` tables are not ported; they are rebuilt by `rebuild-graph` and `recompute-scores` after cutover.
- `legislative_testimony`, `property_ownership`, `puc_participant` and `government_contract` reference new `bill` / `parcel` / `docket` / agency entities, so core distinct-entity counts exceed the legacy count by the number of such entities created.
- Legacy `contribution.match_status = recipient_matched` (recipient resolved, donor not) maps to core `review`; `rejected` maps to `unmatched`. Both endpoints resolved → `matched`.
- `import_cursor` rows are carried over and later extended by new sources, so core may hold more rows than legacy.
