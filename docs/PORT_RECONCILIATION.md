# Port reconciliation — legacy → core

> **Production run.** Generated against the real Supabase data copied into the `legacy` schema of the
> Neon project (`neon-claret-bucket`) via `scripts/db/export-supabase-rest.ts`, then ported with
> `scripts/db/port-legacy.ts` from a Vercel Sandbox on 2026-09-28. Every legacy row count equals the
> production inventory in docs/MIGRATION_INVENTORY.md §5, and the export table (below) shows the REST
> copy matched the Supabase source exactly.

Generated 2026-09-28T21:10:38.418Z by `scripts/db/port-legacy.ts`.

| Legacy table | Legacy rows | Documents | Edges | Entities | Σ amount (legacy) | Σ amount (core) | matched | review | unmatched | distinct entities (legacy → core) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| article | 0 | 0 | 0 | 0 | — | — | 0 | 0 | 0 | 0 → 0 |
| article_entity_mention | 0 | 0 | 0 | 0 | — | — | 0 | 0 | 0 | 0 → 0 |
| contribution | 221,344 | 221,344 | 221,344 | 0 | 159,536,564.2 | 159,536,564.2 | 220,344 | 1,000 | 0 | 33,235 → 33,235 |
| data_source_record | 107 | 107 | 0 | 0 | — | — | 0 | 0 | 0 | 0 → 0 |
| financial_disclosure | 0 | 0 | 0 | 0 | — | — | 0 | 0 | 0 | 0 → 0 |
| government_contract | 100 | 100 | 100 | 0 | 14,663,541,674 | 14,663,541,674 | 0 | 3 | 97 | 2 → 2 |
| import_cursor | 7 | 0 | 0 | 0 | — | — | 0 | 0 | 0 | 0 → 0 |
| legislative_testimony | 0 | 0 | 0 | 0 | — | — | 0 | 0 | 0 | 0 → 0 |
| lobbyist_expenditure | 0 | 0 | 0 | 0 | — | — | 0 | 0 | 0 | 0 → 0 |
| lobbyist_registration | 3,932 | 3,932 | 3,932 | 0 | — | — | 3,932 | 0 | 0 | 1,541 → 1,541 |
| org_lobbying_expenditure | 0 | 0 | 0 | 0 | — | — | 0 | 0 | 0 | 0 → 0 |
| organization | 717 | 0 | 0 | 717 | — | — | 0 | 0 | 0 | 717 → 717 |
| person | 33,724 | 0 | 0 | 33,724 | — | — | 0 | 0 | 0 | 33,724 → 33,724 |
| property_ownership | 0 | 0 | 0 | 0 | — | — | 0 | 0 | 0 | 0 → 0 |
| puc_docket | 12 | 12 | 0 | 12 | — | — | 0 | 0 | 0 | 12 → 12 |
| puc_participant | 22 | 22 | 22 | 0 | — | — | 22 | 0 | 0 | 2 → 14 |
| relationship | 6 | 6 | 6 | 0 | — | — | 6 | 0 | 0 | 8 → 8 |
| timeline_event | 7 | 7 | 7 | 0 | — | — | 7 | 0 | 0 | 7 → 7 |
| user_profile | 0 | 0 | 0 | 0 | — | — | 0 | 0 | 0 | 0 → 0 |

## Rows inserted by this run

entity 34453, document 225530, edge 225411, user_account 0, import_cursor 7

## Re-run (idempotency check)

entity 0, document 0, edge 0, user_account 0, import_cursor 0 rows inserted

## Unexplained differences

None.

## Explained differences

- `article_entity_mention` rows do not get their own document: the mention edge cites the article document (one document per article, one edge per mention).
- `user_profile` rows are ported only where `migration_user_map` maps the legacy `auth.users` id to a Neon Auth user id. Production had 0 users at inventory time.
- `ax_*` tables are not ported; they are rebuilt by `rebuild-graph` and `recompute-scores` after cutover.
- `legislative_testimony`, `property_ownership`, `puc_participant` and `government_contract` reference new `bill` / `parcel` / `docket` / agency entities, so core distinct-entity counts exceed the legacy count by the number of such entities created (`puc_participant`: 2 → 14 includes the 12 docket entities).
- Legacy `contribution.match_status = recipient_matched` (recipient resolved, donor not) maps to core `review`; `rejected` maps to `unmatched`. Both endpoints resolved → `matched`. The 1,000 `review` rows are the FEC Schedule A rows the legacy importer inserted without donor resolution.
- `government_contract`: 97 of 100 legacy rows had no resolved vendor, so their edges are `unmatched` with the vendor name kept in `to_name_raw`; the new `usaspending` importer re-resolves vendors by UEI.
- `import_cursor` rows are carried over and later extended by new sources, so core may hold more rows than legacy.

## Source copy (Supabase REST → legacy schema)

| table | source rows | copied |
|---|---:|---:|
| person | 33,724 | 33,724 |
| organization | 717 | 717 |
| relationship | 6 | 6 |
| contribution | 221,344 | 221,344 |
| lobbyist_registration | 3,932 | 3,932 |
| puc_docket | 12 | 12 |
| puc_participant | 22 | 22 |
| timeline_event | 7 | 7 |
| government_contract | 100 | 100 |
| data_source_record | 107 | 107 |
| import_cursor | 7 | 7 |
| all other legacy tables | 0 | 0 |

Notes from the run: Supabase REST offset pagination timed out near row 141,000, so the export uses
keyset pagination on `id` and resumes after the rows already copied. The Neon free plan's 512 MB project
cap was reached during the first port attempt (the legacy copy alone is 237 MB); the project was moved to
the Launch plan and the port completed on the second attempt.
