# Ingestion report

Generated on this branch after the Part D importers landed. Two kinds of evidence are recorded:
offline verification (fixture tests, dry runs, idempotency) and live verification
(`scripts/import/verify-sources.ts`), which requires outbound network access.

## Offline verification (this environment)

| Check | Result |
|---|---|
| `npm test` | 22 files, 132 tests passing on PGlite: schema, RLS, port, entity match, analytics, pipeline, embeddings, parity, brand, design tokens, analytics events, and one fixture suite per importer |
| Importer contract (every live source) | first run inserts N documents and ≥ N edges; second run inserts 0 documents, 0 edges, 0 entities; cursor ends at N with `status = complete`; `--dry` writes nothing |
| Entity routing | authoritative rosters create entities (candidates by CSC registration number, committees by FEC id, agencies, boards, legislators, bills, dockets, parcels, EIN/CIK/UEI organizations); individuals and unmatched vendors stay `review` with raw names |
| Identifier safety | bills/dockets/parcels never fuzzy-merge; an organization candidate carrying a different value for a supplied identifier scheme is rejected (`tests/entity-match.test.ts`) |
| Sample legacy port | `docs/PORT_RECONCILIATION.md`: 16 entities, 35 documents, 32 edges; re-run inserted 0; no unexplained differences |
| Playwright | smoke, auth pages, axe (WCAG 2.1 AA, serious/critical), visual baselines, analytics proxy — against a production build backed by the PGlite wire server (`tests/e2e/`) |

## Live verification

`scripts/import/verify-sources.ts --status=live --tier=1` was executed from the authoring sandbox,
whose egress proxy returns **403 for every government and third-party host**. The table below is
that run; every `403` is the sandbox, not the source. Re-run from the Mac mini or a Vercel preview:

```
npx tsx --tsconfig tsconfig.scripts.json scripts/import/verify-sources.ts --status=live --markdown docs/INGESTION_REPORT.md
```

| Source | Tier | Registry status | Verdict | HTTP status per URL | robots (a=allowed, u=unknown) | Missing secrets |
|---|---|---|---|---|---|---|
| `csc` | 1 | live | blocked | 403, 403, 403, 403, 403, 403 | aaaaaa | — |
| `ethics_lobbyists` | 1 | live | blocked | 403, 403, 403 | aaa | — |
| `capitol_measures` | 1 | live | blocked | 403, 403 | aa | — |
| `capitol_testimony` | 1 | live | blocked | 403 | a | — |
| `boards` | 1 | live | blocked | 403 | a | — |
| `spo_hands` | 1 | live | blocked | 403, 403 | aa | — |
| `puc` | 1 | live | blocked | 403, 403 | aa | — |
| `fec` | 1 | live | blocked | 403 | a | FEC_API_KEY |
| `usaspending` | 1 | live | blocked | 403 | a | — |
| `propublica_990` | 1 | live | blocked | 403 | a | — |
| `sec_edgar` | 1 | live | blocked | 403, 403 | aa | — |
| `property_hnl` | 1 | live | blocked | 403, 403 | aa | — |

Secrets marked missing were simply absent from the sandbox; `FEC_API_KEY` falls back to `DEMO_KEY`
(rate-limited) when unset.

## First production run checklist

For each live source, in this order, from the Mac mini with `workers/.env` filled:

```
npx tsx --tsconfig tsconfig.scripts.json scripts/import/<source>.ts --dry --limit=200   # parse + resolve, no writes
npx tsx --tsconfig tsconfig.scripts.json scripts/import/<source>.ts --limit=2000        # first real batch
npx tsx --tsconfig tsconfig.scripts.json scripts/import/<source>.ts --limit=2000        # must report 0 new documents
```

Record the three summaries per source in the table below, then `workers/install.sh` to schedule.

| Source | Dry seen / errors | First run documents / edges / entities | Re-run documents (must be 0) | Review-queue rows | Notes |
|---|---|---|---|---|---|
| csc | | | | | |
| ethics_lobbyists | | | | | |
| capitol_measures | | | | | |
| capitol_testimony | | | | | |
| boards | | | | | |
| spo_hands | | | | | |
| puc | | | | | |
| fec | | | | | |
| usaspending | | | | | |
| propublica_990 | | | | | |
| sec_edgar | | | | | |
| property_hnl | | | | | |

## Known parser assumptions to confirm on first live run

- `capitol_measures`: the `data.capitol.hawaii.gov/sessions/session<YYYY>/bills/` listing and the
  `<MEASURE>_.HTM` page ids (`ctl00_ContentPlaceHolderCol1_*`) — the parser also falls back to
  label-adjacent text, so a markup change degrades to fewer fields rather than zero records.
- `capitol_testimony`: packet file naming `<MEASURE>_TESTIMONY_<COMMITTEE>_<MM-DD-YY>_.PDF`; testifier
  splitting is heuristic and every edge keeps an excerpt in `attributes.excerpt` for review.
- `boards`: index path `/boards/` and roster tables with a Name column; list-style rosters handled.
- `spo_hands`: listing paths `/hands/{awards,exemptions,sole-source,debarred}?page=N&size=100`;
  columns matched by header text.
- `puc`: `DocketSearch?year=YYYY&page=N` and `DocketDetails?docketNumber=` on dms.puc.hawaii.gov.
- `property_hnl`: qPublic `KeyValue` parameter for per-parcel pages; bulk roll CSV column names
  matched by regex.
- `sec_edgar`: `data.sec.gov` requires the declared User-Agent with a contact address (set).
