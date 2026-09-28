# Ingestion audit

Scope: every ingestion path that existed before this branch, what it actually fetched, how it fits
the core schema, and the complete evaluation of public Hawaiʻi and federal sources that HOKU Insider
can lawfully ingest. Live verification of every URL is produced by
`scripts/import/verify-sources.ts` into `docs/INGESTION_REPORT.md` (it needs outbound network access,
which the authoring environment did not have; the report records the run status).

## 1. Legacy importers (before this branch)

Source of truth for the row counts: `docs/MIGRATION_INVENTORY.md` §10 (queried on the Supabase project
before it was retired).

| Legacy path | What it fetched | Outcome | Disposition |
|---|---|---|---|
| `lib/import/sources/csc.ts` + `workers/import-csc.ts` | CKAN `datastore_search` on one contributions resource discovered by search; 2,000-row batches | 220,344 `contribution` rows; per-batch dedup on `_id` only; the cursor reset daily | **Replaced** by `csc` (all resources: contributions, expenditures, loans; checksum dedup; cursor per resource) |
| `lib/import/sources/fec.ts` + `workers/import-fec.ts` | OpenFEC Schedule A for three hard-coded candidates (Schatz, Hirono, Case), 10 pages × 100 | 1,000 rows, duplicated on every run (no dedup) | **Replaced** by `fec` (all `state=HI` committees, keyset cursor, checksum dedup) |
| `lib/import/sources/lobbyist.ts` + `workers/import-lobbyist.ts` | CKAN resource `aed69d13-…` (registrations) | 3,932 rows, inserted without dedup; exact lowercase org match | **Replaced** by `ethics_lobbyists` (registrations + expenditure statements, fuzzy resolution, lobbyists created as persons) |
| `lib/import/sources/puc.ts` + `workers/import-puc.ts` | nothing — six hard-coded dockets | curated rows only | **Replaced** by `puc` (DMS docket search + parties) |
| `scripts/import/usaspending.ts` | `spending_by_award` contracts, HI place of performance | ran once, 100 rows | **Replaced** by `usaspending` (contracts and grants, paging, UEI identifiers) |
| `scripts/import/propublica-990.ts` | Nonprofit Explorer search + organization detail | ran once, 5 orgs | **Replaced** by `propublica_990` (officers → `officer_of`/`director_of`) |
| `scripts/import/sec-edgar.ts` | submissions JSON for 2 CIKs; DEF 14A parse stubbed | ran once | **Replaced** by `sec_edgar` (DEF 14A director/officer tables parsed) |
| `scripts/import/state-procurement.ts`, `property.ts`, `testimony.ts` | file-input scaffolds, `TODO` fetchers | never ran | **Replaced** by `spo_hands`, `property_hnl`, `capitol_testimony` (live fetchers) |
| `scripts/import/campaign-finance.ts`, `financial-disclosures.ts`, `lobbyist-expenditures.ts`, `lobbyist-registrations.ts`, `articles.ts` | CSV scaffolds | never ran (0 rows) | **Removed**; CSV intake survives only for the manual UIPA source (`employee_compensation`) |
| `scripts/*.mjs` (5 files) | ad-hoc fetchers with a hard-coded service-role JWT | — | **Removed**; key rotation required (MIGRATION_INVENTORY §8) |
| Vercel cron `/api/cron/*` | empty | — | **Removed**; workers run on the Mac mini via launchd |

Common defects fixed by the new framework: no shared HTTP client (no User-Agent, no rate limit, no
robots.txt), inconsistent dedup (three different schemes), entity matching by exact lowercase name,
cursor semantics differing per importer, and `--dry` unsupported.

## 2. Conventions every importer follows

1. `document` first: `checksum = sha256(canonicalized raw record)`; `ON CONFLICT DO NOTHING` on
   `(source, checksum)`; same `source_record_id` with new content updates in place.
2. Resolve entities with `resolveRef`: identifier match → fuzzy (ʻokina/kahakō aware) → thresholds
   0.95 matched / 0.70 review. Create only from authoritative rosters (legislators, candidates by
   registration number, committees by FEC id, agencies, boards, bills, dockets, parcels) or when an
   identifier is present. Never auto-create an individual donor, testifier, or property owner.
3. `edge` per fact, unique on `(document_id, type, from_name_raw, to_name_raw, role)`; unresolved
   sides keep `*_name_raw` and `match_status = review | unmatched` for `/admin/match-review`.
4. Cursor in `import_cursor` (`cursor_offset`, `status`, `metadata`), advanced per batch by
   `runImporter`; `--dry` wraps the connection so nothing is written.
5. `lib/import/http.ts` only: `HokuInsiderBot/1.0 (+https://constellation.hoku.fm)`, 1 request/s
   per host (SEC 8/s, Socrata and CKAN 2/s), exponential backoff on 429/5xx honoring `Retry-After`,
   robots.txt fetched and obeyed, `.cache/ingest/` in development.
6. Never bypass a login, CAPTCHA, or terms of service. The voter registration file is never ingested
   (HRS §11-97 restricts use; the Office of Elections source only covers candidate filings and results).

## 3. Source evaluation

Status values: **live** (importer in `lib/import/sources/`), **planned** (registered, importer not yet
written; the registry row carries the access method and entity mapping), **blocked** (login wall,
CAPTCHA, paid, or terms forbid automated access), **manual** (UIPA request; CSV intake).

### Tier 1

| Key | Source | Agency | Access | Cadence | Status | Documents → edges | Notes |
|---|---|---|---|---|---|---|---|
| `csc` | Campaign Spending Commission — contributions, expenditures, loans | Hawaiʻi Campaign Spending Commission (state) | ckan — https://opendata.hawaii.gov | daily | **live** | contribution, expenditure, loan → contributed_to, spent_with, loaned_to | Four known resource ids; the rest discovered via package_search "campaign spending". Socrata mirror at hicscdata.hawaii.gov. |
| `ethics_lobbyists` | State Ethics Commission — lobbyist registrations & expenditure statements | Hawaiʻi State Ethics Commission (state) | ckan — https://opendata.hawaii.gov | weekly | **live** | lobbyist_registration, lobbyist_expenditure → lobbied_for, spent_with, lobbied_on |  |
| `ethics_disclosures` | State Ethics Commission — financial & gift disclosures, charges | Hawaiʻi State Ethics Commission (state) | html — https://ethics.hawaii.gov | weekly | **planned** | financial_disclosure, gift_disclosure, ethics_charge → disclosed_interest, sanctioned_by | Disclosures are PDFs on a Salesforce (force.com) public site; parse with lib/import/clients/pdf.ts. |
| `capitol_measures` | Legislature — measures, introducers, status | Hawaiʻi State Legislature (state) | api — https://data.capitol.hawaii.gov | daily | **live** | measure → sponsored |  |
| `capitol_votes` | Legislature — committee and floor votes | Hawaiʻi State Legislature (state) | html — https://www.capitol.hawaii.gov | daily | **planned** | vote → voted_on |  |
| `capitol_testimony` | Legislature — testimony PDFs | Hawaiʻi State Legislature (state) | pdf — https://www.capitol.hawaii.gov | daily | **live** | testimony → testified_on | Replaces the file-input scaffold in scripts/import/testimony.ts. |
| `capitol_committees` | Legislature — committee membership | Hawaiʻi State Legislature (state) | html — https://www.capitol.hawaii.gov | monthly | **planned** | committee_roster → member_of |  |
| `capitol_gm` | Legislature — Governor’s Messages & Senate confirmations | Hawaiʻi State Legislature (state) | html — https://www.capitol.hawaii.gov | weekly | **planned** | governors_message → appointed_to, confirmed_by |  |
| `capitol_gia` | Legislature — Grants-in-Aid | Hawaiʻi State Legislature (state) | html — https://www.capitol.hawaii.gov | annual | **planned** | grant_in_aid → awarded_grant |  |
| `boards` | Boards & Commissions — appointments | Office of the Governor (state) | html — https://boards.hawaii.gov | weekly | **live** | appointment → appointed_to |  |
| `governor_orders` | Governor — executive orders & proclamations | Office of the Governor (state) | html — https://governor.hawaii.gov | weekly | **planned** | executive_order, proclamation → mentioned_in |  |
| `spo_hands` | State Procurement Office — HANDS awards, exemptions, sole-source, debarments | State Procurement Office (state) | html — https://hands.ehawaii.gov | daily | **live** | contract, sole_source_notice, debarment → awarded_contract, sanctioned_by | Converts scripts/import/state-procurement.ts to a live fetcher. |
| `puc` | Public Utilities Commission — dockets & parties | Hawaiʻi Public Utilities Commission (state) | html — https://dms.puc.hawaii.gov | daily | **live** | docket_filing → party_to | DMS docket search HTML tables; replaces the hard-coded docket list in the legacy importer. |
| `elections` | Office of Elections — candidate filings & results | Office of Elections (state) | html — https://elections.hawaii.gov | weekly | **planned** | candidate_filing, election_result → member_of | Never ingests the voter registration file (HRS §11-97). |
| `sunshine_calendar` | Sunshine calendar — meeting agendas | Office of Information Practices / eHawaii (state) | html — https://calendar.ehawaii.gov | daily | **planned** | agenda → mentioned_in |  |
| `fec` | FEC — Schedule A contributions (Hawaiʻi committees) | Federal Election Commission (federal) | api — https://api.open.fec.gov | daily | **live** | contribution → contributed_to | Coverage: all committees with state=HI plus the delegation’s principal committees. Secrets: FEC_API_KEY. |
| `lda` | Lobbying Disclosure Act — LD-1 / LD-2 / LD-203 | U.S. Senate / House (LDA.gov) (federal) | api — https://lda.gov | weekly | **planned** | lda_filing → lobbied_for, lobbied_on, contributed_to | lda.senate.gov retired 2026-06-30; filter client/registrant state = HI. Secrets: LDA_API_TOKEN. |
| `usaspending` | USAspending — federal awards with Hawaiʻi place of performance | U.S. Treasury (federal) | api — https://api.usaspending.gov | weekly | **live** | contract, grant → awarded_contract, awarded_grant |  |
| `sam` | SAM.gov — entity registrations & exclusions | GSA (federal) | api — https://api.sam.gov | weekly | **planned** | entity_registration, exclusion → sanctioned_by |  Secrets: SAM_API_KEY. |
| `irs_eo` | IRS — Exempt Organizations BMF & 990 e-file | Internal Revenue Service (federal) | bulk_download — https://www.irs.gov | monthly | **planned** | irs_990 → officer_of, director_of |  |
| `propublica_990` | ProPublica Nonprofit Explorer | ProPublica (federal) | api — https://projects.propublica.org | monthly | **live** | irs_990 → officer_of, director_of |  |
| `sec_edgar` | SEC EDGAR — submissions & DEF 14A officers/directors | U.S. Securities and Exchange Commission (federal) | api — https://data.sec.gov | weekly | **live** | sec_filing → officer_of, director_of | Requires descriptive User-Agent; ≤ 10 req/s. |
| `hnl_permits` | Honolulu — building permits | City & County of Honolulu DPP (honolulu) | socrata — https://data.honolulu.gov | weekly | **planned** | permit → owns |  Secrets: SOCRATA_APP_TOKEN. |
| `hnl_council` | Honolulu City Council — legislation & votes | Honolulu City Council (honolulu) | html — https://hnldoc.ehawaii.gov | weekly | **planned** | measure, vote → sponsored, voted_on |  |
| `hnl_ethics` | Honolulu Ethics Commission — lobbyists & disclosures | Honolulu Ethics Commission (honolulu) | html — https://www.honolulu.gov/ethics | monthly | **planned** | lobbyist_registration, financial_disclosure → lobbied_for, disclosed_interest |  |
| `hnl_boards` | Honolulu — boards & commissions | City & County of Honolulu (honolulu) | html — https://www.honolulu.gov | monthly | **planned** | appointment → appointed_to |  |
| `hnl_purchasing` | Honolulu — purchasing awards | City & County of Honolulu BFS Purchasing (honolulu) | html — https://www.honolulu.gov/pur | weekly | **planned** | contract → awarded_contract |  |
| `maui_council` | Maui County Council — Legistar | Maui County Council (maui) | legistar — https://webapi.legistar.com/v1/mauicounty | weekly | **planned** | measure, vote → sponsored, voted_on | Legistar client name to verify live: "mauicounty". |
| `hawaii_council` | Hawaiʻi County Council — Legistar | Hawaiʻi County Council (hawaii) | legistar — https://webapi.legistar.com/v1/hawaiicounty | weekly | **planned** | measure, vote → sponsored, voted_on | Legistar client name to verify live: "hawaiicounty". |
| `kauai_council` | Kauaʻi County Council — agendas & minutes | Kauaʻi County Council (kauai) | html — https://www.kauai.gov/Government/Council | weekly | **planned** | measure, vote, agenda → sponsored, voted_on | Platform to verify (CivicPlus vs Granicus). |
| `property_hnl` | Honolulu real property assessment | City & County of Honolulu RPAD (honolulu) | bulk_download — https://www.realpropertyhonolulu.com | monthly | **live** | property_record → owns | Bulk files where offered; otherwise per-parcel only for TMKs linked to tracked entities. |
| `property_maui` | Maui real property assessment | County of Maui RPA (maui) | html — https://qpublic.schneidercorp.com/Application.aspx?AppID=1032 | monthly | **planned** | property_record → owns |  |
| `property_hawaii` | Hawaiʻi County real property assessment | County of Hawaiʻi RPT (hawaii) | html — https://qpublic.schneidercorp.com/Application.aspx?AppID=1048 | monthly | **planned** | property_record → owns |  |
| `property_kauai` | Kauaʻi real property assessment | County of Kauaʻi RPA (kauai) | html — https://qpublic.schneidercorp.com/Application.aspx?AppID=1083 | monthly | **planned** | property_record → owns |  |

### Tier 2

| Key | Source | Agency | Access | Cadence | Status | Documents → edges | Notes |
|---|---|---|---|---|---|---|---|
| `dcca_breg` | DCCA Business Registration — officers & registered agents | DCCA BREG (state) | html — https://hbe.ehawaii.gov/documents/search.html | monthly | **planned** | business_registration → officer_of, director_of | Per-entity lookups for existing orgs only; UIPA bulk export is the alternative. |
| `dcca_pvl` | DCCA Professional & Vocational Licensing | DCCA PVL (state) | html — https://mypvl.dcca.hawaii.gov | monthly | **planned** | license → licensed_by |  |
| `dcca_enforcement` | DCCA RICO / OCP / Insurance / DFI / Securities enforcement | DCCA (state) | html — https://cca.hawaii.gov | monthly | **planned** | enforcement_action → sanctioned_by |  |
| `dcca_catv` | DCCA Cable Television dockets | DCCA CATV (state) | html — https://cca.hawaii.gov/catv | monthly | **planned** | docket_filing → party_to |  |
| `ag_charities` | AG Tax & Charities registrations | Department of the Attorney General (state) | html — https://ag.ehawaii.gov/charity | quarterly | **planned** | business_registration → officer_of |  |
| `dlnr` | DLNR — BLNR agendas, leases & revocable permits, CWRM, OCCL | Department of Land and Natural Resources (state) | html — https://dlnr.hawaii.gov | weekly | **planned** | agenda, lease → leases, party_to | Bureau of Conveyances: index metadata only. |
| `luc` | Land Use Commission dockets | Land Use Commission (state) | html — https://luc.hawaii.gov | weekly | **planned** | docket_filing → party_to |  |
| `opsd_env_notice` | OPSD Environmental Notice | Office of Planning and Sustainable Development ERP (state) | pdf — https://planning.hawaii.gov/erp | weekly | **planned** | agenda → mentioned_in, party_to |  |
| `state_boards_misc` | HCDA, HHFDC, HPHA, DHHL, OHA, ADC, HTA, UH Regents, BOE, Stadium Authority, HGIA, HSDC, ERS, EUTF — agendas & awards | Various state authorities (state) | html — https://portal.ehawaii.gov | weekly | **planned** | agenda, contract, grant → member_of, awarded_contract, awarded_grant |  |
| `dot_leases` | DOT Airports & Harbors leases and concessions | Department of Transportation (state) | html — https://hidot.hawaii.gov | quarterly | **planned** | lease → leases |  |
| `bf_cip` | Budget & Finance — CIP | Department of Budget and Finance (state) | pdf — https://budget.hawaii.gov | annual | **planned** | grant → awarded_grant |  |
| `tax_credits` | DBEDT / Taxation tax-credit reports | DBEDT & Department of Taxation (state) | pdf — https://tax.hawaii.gov | annual | **planned** | grant → awarded_grant |  |
| `hlrb` | Hawaiʻi Labor Relations Board decisions | HLRB (state) | html — https://labor.hawaii.gov/hlrb | monthly | **planned** | docket_filing → party_to |  |
| `auditor` | State Auditor reports | Office of the Auditor (state) | pdf — https://auditor.hawaii.gov | monthly | **planned** | article → mentioned_in |  |
| `jsc` | Judicial Selection Commission — nominee lists | Judicial Selection Commission (state) | html — https://www.courts.state.hi.us/judicial_selection_commission | monthly | **planned** | appointment → appointed_to |  |
| `dol_olms` | DOL OLMS union filings (LM-2/3/4) | U.S. Department of Labor (federal) | api — https://olmsapps.dol.gov | quarterly | **planned** | business_registration → officer_of |  |
| `fcc` | FCC licenses & ownership (HI) | Federal Communications Commission (federal) | api — https://www.fcc.gov | quarterly | **planned** | license → licensed_by, officer_of |  |
| `congress_disclosures` | House Clerk & Senate eFD financial disclosures (HI delegation) | U.S. House / Senate (federal) | pdf — https://disclosures-clerk.house.gov | annual | **planned** | financial_disclosure → disclosed_interest | Senate eFD requires a CAPTCHA/terms acknowledgement per session; treat as blocked if automation is disallowed. |
| `fac` | Federal Audit Clearinghouse single audits | GSA FAC (federal) | api — https://api.fac.gov | quarterly | **planned** | grant → awarded_grant |  Secrets: DATA_GOV_API_KEY. |
| `fara` | FARA registrations | U.S. Department of Justice (federal) | api — https://efile.fara.gov | quarterly | **planned** | lda_filing → lobbied_for |  |
| `eia_860` | EIA-860 generators & owners (HI) | U.S. Energy Information Administration (federal) | bulk_download — https://www.eia.gov/electricity/data/eia860 | annual | **planned** | license → owns |  |
| `sba_ppp` | SBA PPP / EIDL loans (HI) | U.S. Small Business Administration (federal) | bulk_download — https://data.sba.gov | annual | **planned** | loan → loaned_to |  |
| `nlrb` | NLRB cases (HI) | National Labor Relations Board (federal) | html — https://www.nlrb.gov | monthly | **planned** | docket_filing → party_to |  |
| `congress_gov` | Congress.gov — HI delegation bills & votes | Library of Congress (federal) | api — https://api.congress.gov | weekly | **planned** | measure, vote → sponsored, voted_on |  Secrets: CONGRESS_API_KEY. |
| `county_planning` | County planning commissions, ZBAs, SMA permits | County planning departments (honolulu) | html — https://www.honolulu.gov/dpp | weekly | **planned** | permit, agenda → party_to, owns |  |
| `liquor` | County liquor commissions — licenses & violations | County liquor commissions (honolulu) | html — https://www.honolulu.gov/liq | monthly | **planned** | license, enforcement_action → licensed_by, sanctioned_by |  |
| `bws` | Honolulu Board of Water Supply — board & contracts | Board of Water Supply (honolulu) | html — https://www.boardofwatersupply.com | monthly | **planned** | agenda, contract → member_of, awarded_contract |  |
| `hart` | HART — board & contracts | Honolulu Authority for Rapid Transportation (honolulu) | html — https://www.honolulutransit.org | monthly | **planned** | agenda, contract → member_of, awarded_contract |  |
| `county_ethics` | Maui, Hawaiʻi, Kauaʻi ethics boards | County boards of ethics (maui) | html — https://www.mauicounty.gov/103/Board-of-Ethics | quarterly | **planned** | financial_disclosure, ethics_charge → disclosed_interest, sanctioned_by | Verify which counties publish disclosures online. |

### Tier 3

| Key | Source | Agency | Access | Cadence | Status | Documents → edges | Notes |
|---|---|---|---|---|---|---|---|
| `employee_compensation` | Public employee compensation (UIPA request) | Various (state) | manual_uipa — https://oip.hawaii.gov | annual | **manual** | record → employed_by | HRS §92F-12(a)(14). CSV importer for use once the data is obtained: scripts/import/employee-compensation.ts or the /admin/import CSV upload. |
| `judiciary_ecourt` | Judiciary eCourt Kokua / Hoʻohiki | Hawaiʻi State Judiciary (state) | html — https://www.courts.state.hi.us/legal_references/records/jims_system_availability | on_demand | **blocked** | docket_filing → party_to | Terms of use prohibit automated access unless a data agreement is in place. Not scraped. |
## 4. Build order (Tier 1 first; each importer is one commit `ingest(<key>): …`)

1. `csc` — highest-value money data, stable CKAN API. **Done.**
2. `ethics_lobbyists` — lobbying, stable CKAN API. **Done.**
3. `capitol_measures` → `capitol_testimony` — bills and positions; testimony depends on bills. **Done.**
4. `boards` — appointments. **Done.**
5. `spo_hands` — state contracts and debarments. **Done.**
6. `puc` — dockets and parties. **Done.**
7. `fec`, `usaspending`, `propublica_990`, `sec_edgar` — federal money and corporate governance. **Done.**
8. `property_hnl` — parcels for tracked entities. **Done.**
9. Next: `capitol_votes`, `capitol_committees`, `ethics_disclosures` (PDF), `elections`,
   `sunshine_calendar`, `lda`, `hnl_council`, `maui_council`, `hawaii_council` (Legistar client
   exists), `hnl_permits` (Socrata client exists), `dcca_breg`.

## 5. Scheduling

`workers/launchd/fm.hoku.constellation.import-<source>.plist` (installed by `workers/install.sh`):
daily 16:00–20:30 HST for Legislature, procurement, PUC, CSC, FEC; weekly Mondays for lobbyists,
boards, USAspending, SEC; monthly on the 1st for ProPublica and Honolulu property. Analytics jobs
(`rebuild-graph`, `recompute-scores`, `detect-changes`) run after the importers. `/admin/workers`
shows each source's last run, cursor, and overdue state from the same registry.

## 6. Embeddings

Separate job: `scripts/embeddings/backfill.ts` fills `document.embedding` and `summary.embedding`
(1024-d) for rows without one, resumable via `import_cursor` rows `embeddings:document` /
`embeddings:summary`. Importers never call an embedding API.
