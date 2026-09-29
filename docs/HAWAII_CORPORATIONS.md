# Hawaiʻi corporations: sources and ingestion

What HOKU Insider can lawfully ingest about entities formed or operating in Hawaiʻi, verified against
the live sites on 2026-09-29, and how each source is loaded.

## Summary

| Source | Key | Coverage | Access | Status |
|---|---|---|---|---|
| DCCA Business Registration Division (the state registry) | `dcca_breg` | every corporation, LLC, partnership, and trade name registered in Hawaiʻi, with officers and agents | Entity List Builder purchase or UIPA extract, loaded as CSV | **manual** |
| IRS Exempt Organizations Business Master File | `irs_eo` | ≈9,700 tax-exempt organizations with a Hawaiʻi address | public CSV, monthly | **live** |
| SEC Form D data sets | `sec_form_d` | private offerings by Hawaiʻi issuers since 2008, with executive officers and directors | quarterly ZIPs under sec.gov/files | **live** |
| SEC EDGAR proxy statements | `sec_edgar` | directors and officers of Hawaiʻi public companies | data.sec.gov JSON + DEF 14A | **live** |
| GLEIF Legal Entity Identifiers | `gleif` | ≈430 entities formed under Hawaiʻi law; carries the DCCA file number; reported parent companies | public API, CC0 | **live** |
| ProPublica Nonprofit Explorer (Form 990) | `propublica_990` | officers, directors, and pay at Hawaiʻi nonprofits | public API | **live** |

Every source stores its identifier on the org (`identifiers.dcca`, `ein`, `sec_cik`, `lei`), and
resolution matches on any of them, so a company seen by several sources converges on one entity.
GLEIF matters here because it is the only open source that carries the DCCA file number: when a
registry export is loaded later, GLEIF-sourced orgs attach to it automatically.

## The state registry (DCCA BREG)

**The portal cannot be fetched.** Hawaii Business Express moved from `hbe.ehawaii.gov` to
`https://hbe.dcca.hawaii.gov` (a Salesforce Experience Cloud site). Its `robots.txt` is:

```
User-agent: *
Disallow: /
```

The site also loads Google reCAPTCHA. The project rules forbid working around either, so no importer
requests anything from that host. The old `hbe.ehawaii.gov` pages now only redirect there.
`opendata.hawaii.gov` has a single BREG dataset, "Business Name Search", which is a link to the portal
rather than data.

**Two lawful routes to the full registry:**

1. **Entity List Builder** (`https://hbe.dcca.hawaii.gov/entity-list-builder`). DCCA advertises it as the
   way to "buy custom lists of local businesses and professionals." A staff member builds the list in a
   browser, pays, and downloads it. Pricing and the exact column set are only visible inside the portal,
   so confirm both on the first purchase.
2. **UIPA request** to BREG under HRS chapter 92F for an electronic extract of the registry. A draft
   request follows. BREG may answer by pointing to the list builder or by quoting fees under HAR §2-71.

**Loading either file.** Save it as CSV, then:

```
npx tsx --tsconfig tsconfig.scripts.json scripts/import/dcca-breg.ts --file=breg-export.csv --dry
npx tsx --tsconfig tsconfig.scripts.json scripts/import/dcca-breg.ts --file=breg-export.csv
```

or upload it at `/admin/import` (staff only, up to 20 MB; if the summary says `done: false`, upload the
same file again and it resumes). The dry run's first log line lists which columns were recognised and
which were ignored. Columns are matched by header name, so the list builder's layout and a UIPA layout
both load without code changes; `lib/import/sources/dcca-breg.ts` lists the recognised headers. If a
real export uses a header the loader does not know, add a pattern there and a fixture row to
`tests/importers/dcca-breg.test.ts`.

What the loader writes: one `business_registration` document per file number; an org with
`identifiers.dcca` (normalised to `372533 C5` form), entity type, status, registration date, place of
incorporation, address, island, and registered agent; and `officer_of` / `director_of` edges for listed
officers, managers, and directors. Officer names resolve against existing people but never create new
ones, so unmatched officers stay as raw names in the review queue.

### Draft UIPA request

> **To:** Business Registration Division, Department of Commerce and Consumer Affairs,
> 335 Merchant Street, Honolulu, HI 96813 (breg@dcca.hawaii.gov)
>
> **Re:** Request to access government records under HRS chapter 92F
>
> I request an electronic copy of the Business Registration Division's registry of business entities,
> covering every entity on file (active and inactive), with the following fields where maintained:
> file number; legal name; entity type; status; date of registration or incorporation; place of
> incorporation or formation; principal office and mailing addresses; registered agent name and address;
> and the names and titles of officers, directors, managers, members, or general partners as shown on the
> most recent annual filing. Trade name registrations with their registrant may be included as a separate
> file.
>
> I ask that the records be provided in a machine-readable format (CSV or Excel) by electronic delivery.
> If any field is withheld, please identify the field and the statutory basis. If fees apply, please
> provide an estimate under HAR §2-71 before incurring them; I request the fee waiver for requests made
> in the public interest under HAR §2-71-32.
>
> [Name, organization, contact information, date]

The Office of Information Practices' standard request form (`https://oip.hawaii.gov`) can carry the same
text.

## Open sources

**IRS BMF (`irs_eo`).** `https://www.irs.gov/pub/irs-soi/eo_hi.csv`; robots.txt permits `/pub`. Each row
gives EIN, legal name, address, 501(c) subsection, ruling date, NTEE code, and latest assets, income, and
revenue. One document per EIN; orgs attach to existing Form 990 orgs by EIN. The BMF names no people.

**SEC Form D (`sec_form_d`).** About 780 EDGAR filers list a Hawaiʻi business address, and a sample showed
most are private companies whose filings are Form D offering notices. EDGAR's company browse
(`/cgi-bin/browse-edgar`) is disallowed by sec.gov's robots.txt, so it is not used. The SEC's quarterly
Form D data sets (`https://www.sec.gov/data-research/sec-markets-data/form-d-data-sets`, files under
`/files/`, which robots.txt permits) carry the same filings as tables: issuer name, CIK, address, entity
type, jurisdiction and year of formation; offering size and industry; and related persons with their
roles. Each batch reads one quarter (≈3–4 MB) and keeps filings whose primary issuer is in Hawaiʻi. The
issuer resolves by CIK; executive officers and directors become `officer_of` / `director_of` edges
(people resolve-only); promoters stay in the document. The cursor counts quarters, so later runs pick up
only new quarters.

**GLEIF (`gleif`).** `filter[entity.jurisdiction]=US-HI` returns ≈430 records. 345 are registered at
`RA000605`, the GLEIF code for the Hawaiʻi DCCA registry, and carry the DCCA file number in `registeredAs`.
27 report a direct accounting-consolidation parent, which becomes an `owns` edge (for example, a Hawaiʻi
captive insurer owned by a mainland payments company).

**Not used.** OpenCorporates holds Hawaiʻi registry data but requires an API key and licenses its database
under share-alike terms that do not suit a subscription product. SAM.gov entity registrations need an API
key (`SAM_API_KEY`) and are registered as `sam` (planned).

## Data-quality fix made alongside

`sec_edgar`'s default company list pointed "HEI", "A&B", and "Matson" at the CIKs of HEICO Corp, Allied
Capital, and Axalta Coating Systems. The list now holds verified Hawaiʻi registrants. Production still
contains the two entities the old list created (HEICO CORP, Axalta Coating Systems Ltd.) and their proxy
documents; they have no edges and can be deleted:

```sql
delete from document where source = 'sec_edgar' and source_record_id like any (array['0000046619:%', '0001616862:%']);
delete from entity where identifiers->>'sec_cik' in ('0000046619', '0001616862')
  and not exists (select 1 from edge where from_id = entity.id or to_id = entity.id);
```
