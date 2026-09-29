/**
 * Source Registry — every public government data source HOKU Insider ingests or has evaluated.
 * Read by /admin/workers and by scripts/import/verify-sources.ts (live URL + robots.txt check).
 *
 * `status`:
 *   live     — importer exists and fetches from the source
 *   planned  — registered, importer not yet written
 *   blocked  — login wall, CAPTCHA, paid, or terms forbid automated access (reason in notes)
 *   manual   — data obtained by request (UIPA); importer reads a supplied file
 *   retired  — source decommissioned (kept for provenance)
 */
import type { DocType, EdgeType, EntityKind } from '@/lib/schema/attributes'

export type AccessMethod = 'api' | 'ckan' | 'socrata' | 'legistar' | 'bulk_download' | 'html' | 'pdf' | 'rss' | 'manual_uipa'
export type Cadence = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual' | 'on_demand'
export type SourceStatus = 'live' | 'planned' | 'blocked' | 'manual' | 'retired'
export type Jurisdiction = 'state' | 'federal' | 'honolulu' | 'maui' | 'hawaii' | 'kauai'

export interface SourceDefinition {
  key: string
  name: string
  agency: string
  jurisdiction: Jurisdiction
  accessMethod: AccessMethod
  baseUrl: string
  /** Additional URLs to verify live (datasets, robots.txt is always checked at the host root). */
  urls?: string[]
  docTypes: DocType[]
  edgeTypes: EdgeType[]
  entityKinds: EntityKind[]
  cadence: Cadence
  tier: 1 | 2 | 3
  status: SourceStatus
  notes?: string
  /** Env var names that must be set for the importer. */
  secrets?: string[]
  /**
   * Snapshot sources: when the cadence comes due after a completed run, start again at offset 0 so the whole
   * source is re-read. Without it a completed cursor resumes at the end and the refresh reads nothing.
   */
  restartOnComplete?: boolean
}

export const SOURCE_REGISTRY: SourceDefinition[] = [
  // ============================================================ Tier 1 — State
  {
    key: 'csc', name: 'Campaign Spending Commission — contributions, expenditures, loans', agency: 'Hawaiʻi Campaign Spending Commission',
    jurisdiction: 'state', accessMethod: 'ckan', baseUrl: 'https://opendata.hawaii.gov',
    urls: [
      'https://opendata.hawaii.gov/api/3/action/datastore_search?resource_id=443bd998-1ef3-47da-9170-c2c376b2e41c&limit=1',
      'https://opendata.hawaii.gov/api/3/action/datastore_search?resource_id=bc5fae08-b97e-45fc-9c3b-f0883efad371&limit=1',
      'https://opendata.hawaii.gov/api/3/action/datastore_search?resource_id=ca3ac02a-eb44-4b44-b3a7-5f60653cc1d3&limit=1',
      'https://opendata.hawaii.gov/api/3/action/datastore_search?resource_id=f20b548a-83db-46e9-a0de-8bfd777ec89d&limit=1',
      'https://hicscdata.hawaii.gov',
    ],
    docTypes: ['contribution', 'expenditure', 'loan'], edgeTypes: ['contributed_to', 'spent_with', 'loaned_to'], entityKinds: ['person', 'org'],
    cadence: 'daily', tier: 1, status: 'live',
    notes: 'Four known resource ids; the rest discovered via package_search "campaign spending". Socrata mirror at hicscdata.hawaii.gov.',
  },
  {
    key: 'ethics_lobbyists', name: 'State Ethics Commission — lobbyist registrations & expenditure statements', agency: 'Hawaiʻi State Ethics Commission',
    jurisdiction: 'state', accessMethod: 'ckan', baseUrl: 'https://opendata.hawaii.gov',
    urls: ['https://opendata.hawaii.gov/api/3/action/datastore_search?resource_id=aed69d13-fe07-4e91-8abf-a51c8a408e1f&limit=1', 'https://ethics.hawaii.gov'],
    docTypes: ['lobbyist_registration', 'lobbyist_expenditure'], edgeTypes: ['lobbied_for', 'spent_with', 'lobbied_on'], entityKinds: ['person', 'org'],
    cadence: 'weekly', tier: 1, status: 'live',
  },
  {
    key: 'ethics_disclosures', name: 'State Ethics Commission — financial & gift disclosures, charges', agency: 'Hawaiʻi State Ethics Commission',
    jurisdiction: 'state', accessMethod: 'html', baseUrl: 'https://ethics.hawaii.gov', urls: ['https://hawaiiethics.force.com'],
    docTypes: ['financial_disclosure', 'gift_disclosure', 'ethics_charge'], edgeTypes: ['disclosed_interest', 'sanctioned_by'], entityKinds: ['person', 'org'],
    cadence: 'weekly', tier: 1, status: 'planned',
    notes: 'Disclosures are PDFs on a Salesforce (force.com) public site; parse with lib/import/clients/pdf.ts.',
  },
  {
    key: 'capitol_measures', name: 'Legislature — measures, introducers, status', agency: 'Hawaiʻi State Legislature',
    jurisdiction: 'state', accessMethod: 'api', baseUrl: 'https://data.capitol.hawaii.gov', urls: ['https://www.capitol.hawaii.gov'],
    docTypes: ['measure'], edgeTypes: ['sponsored'], entityKinds: ['bill', 'person'],
    cadence: 'daily', tier: 1, status: 'live',
  },
  {
    key: 'capitol_votes', name: 'Legislature — committee and floor votes', agency: 'Hawaiʻi State Legislature',
    jurisdiction: 'state', accessMethod: 'html', baseUrl: 'https://www.capitol.hawaii.gov',
    docTypes: ['vote'], edgeTypes: ['voted_on'], entityKinds: ['bill', 'person'], cadence: 'daily', tier: 1, status: 'planned',
  },
  {
    key: 'capitol_testimony', name: 'Legislature — testimony PDFs', agency: 'Hawaiʻi State Legislature',
    jurisdiction: 'state', accessMethod: 'pdf', baseUrl: 'https://www.capitol.hawaii.gov',
    docTypes: ['testimony'], edgeTypes: ['testified_on'], entityKinds: ['bill', 'person', 'org'], cadence: 'daily', tier: 1, status: 'live',
    notes: 'Replaces the file-input scaffold in scripts/import/testimony.ts.',
  },
  {
    key: 'capitol_committees', name: 'Legislature — committee membership', agency: 'Hawaiʻi State Legislature',
    jurisdiction: 'state', accessMethod: 'html', baseUrl: 'https://www.capitol.hawaii.gov',
    docTypes: ['committee_roster'], edgeTypes: ['member_of'], entityKinds: ['person', 'office'], cadence: 'monthly', tier: 1, status: 'planned',
  },
  {
    key: 'capitol_gm', name: 'Legislature — Governor’s Messages & Senate confirmations', agency: 'Hawaiʻi State Legislature',
    jurisdiction: 'state', accessMethod: 'html', baseUrl: 'https://www.capitol.hawaii.gov',
    docTypes: ['governors_message'], edgeTypes: ['appointed_to', 'confirmed_by'], entityKinds: ['person', 'office'], cadence: 'weekly', tier: 1, status: 'planned',
  },
  {
    key: 'capitol_gia', name: 'Legislature — Grants-in-Aid', agency: 'Hawaiʻi State Legislature',
    jurisdiction: 'state', accessMethod: 'html', baseUrl: 'https://www.capitol.hawaii.gov',
    docTypes: ['grant_in_aid'], edgeTypes: ['awarded_grant'], entityKinds: ['org'], cadence: 'annual', tier: 1, status: 'planned',
  },
  {
    key: 'boards', name: 'Boards & Commissions — appointments', agency: 'Office of the Governor',
    jurisdiction: 'state', accessMethod: 'html', baseUrl: 'https://boards.hawaii.gov',
    docTypes: ['appointment'], edgeTypes: ['appointed_to'], entityKinds: ['person', 'office'], cadence: 'weekly', tier: 1, status: 'live',
  },
  {
    key: 'governor_orders', name: 'Governor — executive orders & proclamations', agency: 'Office of the Governor',
    jurisdiction: 'state', accessMethod: 'html', baseUrl: 'https://governor.hawaii.gov',
    docTypes: ['executive_order', 'proclamation'], edgeTypes: ['mentioned_in'], entityKinds: ['person', 'org'], cadence: 'weekly', tier: 1, status: 'planned',
  },
  {
    key: 'spo_hands', name: 'State Procurement Office — HANDS awards, exemptions, sole-source, debarments', agency: 'State Procurement Office',
    jurisdiction: 'state', accessMethod: 'html', baseUrl: 'https://hands.ehawaii.gov', urls: ['https://spo.hawaii.gov'],
    docTypes: ['contract', 'sole_source_notice', 'debarment'], edgeTypes: ['awarded_contract', 'sanctioned_by'], entityKinds: ['org'],
    cadence: 'daily', tier: 1, status: 'live', notes: 'Converts scripts/import/state-procurement.ts to a live fetcher.',
  },
  {
    key: 'puc', name: 'Public Utilities Commission — dockets & parties', agency: 'Hawaiʻi Public Utilities Commission',
    jurisdiction: 'state', accessMethod: 'html', baseUrl: 'https://dms.puc.hawaii.gov', urls: ['https://puc.hawaii.gov'],
    docTypes: ['docket_filing'], edgeTypes: ['party_to'], entityKinds: ['docket', 'org', 'person'], cadence: 'daily', tier: 1, status: 'live',
    notes: 'DMS docket search HTML tables; replaces the hard-coded docket list in the legacy importer.',
  },
  {
    key: 'elections', name: 'Office of Elections — candidate filings & results', agency: 'Office of Elections',
    jurisdiction: 'state', accessMethod: 'html', baseUrl: 'https://elections.hawaii.gov',
    docTypes: ['candidate_filing', 'election_result'], edgeTypes: ['member_of'], entityKinds: ['person', 'office'], cadence: 'weekly', tier: 1, status: 'planned',
    notes: 'Never ingests the voter registration file (HRS §11-97).',
  },
  {
    key: 'sunshine_calendar', name: 'Sunshine calendar — meeting agendas', agency: 'Office of Information Practices / eHawaii',
    jurisdiction: 'state', accessMethod: 'html', baseUrl: 'https://calendar.ehawaii.gov',
    docTypes: ['agenda'], edgeTypes: ['mentioned_in'], entityKinds: ['office', 'org'], cadence: 'daily', tier: 1, status: 'planned',
  },
  // ============================================================ Tier 1 — Federal
  {
    key: 'fec', name: 'FEC — Schedule A contributions (Hawaiʻi committees)', agency: 'Federal Election Commission',
    jurisdiction: 'federal', accessMethod: 'api', baseUrl: 'https://api.open.fec.gov',
    docTypes: ['contribution'], edgeTypes: ['contributed_to'], entityKinds: ['person', 'org'], cadence: 'daily', tier: 1, status: 'live',
    secrets: ['FEC_API_KEY'], notes: 'Coverage: all committees with state=HI plus the delegation’s principal committees.',
  },
  {
    key: 'lda', name: 'Lobbying Disclosure Act — LD-1 / LD-2 / LD-203', agency: 'U.S. Senate / House (LDA.gov)',
    jurisdiction: 'federal', accessMethod: 'api', baseUrl: 'https://lda.gov',
    docTypes: ['lda_filing'], edgeTypes: ['lobbied_for', 'lobbied_on', 'contributed_to'], entityKinds: ['person', 'org'], cadence: 'weekly', tier: 1, status: 'planned',
    secrets: ['LDA_API_TOKEN'], notes: 'lda.senate.gov retired 2026-06-30; filter client/registrant state = HI.',
  },
  {
    key: 'usaspending', name: 'USAspending — federal awards with Hawaiʻi place of performance', agency: 'U.S. Treasury',
    jurisdiction: 'federal', accessMethod: 'api', baseUrl: 'https://api.usaspending.gov',
    docTypes: ['contract', 'grant'], edgeTypes: ['awarded_contract', 'awarded_grant'], entityKinds: ['org'], cadence: 'weekly', tier: 1, status: 'live',
  },
  {
    key: 'sam', name: 'SAM.gov — entity registrations & exclusions', agency: 'GSA',
    jurisdiction: 'federal', accessMethod: 'api', baseUrl: 'https://api.sam.gov',
    docTypes: ['entity_registration', 'exclusion'], edgeTypes: ['sanctioned_by'], entityKinds: ['org'], cadence: 'weekly', tier: 1, status: 'planned', secrets: ['SAM_API_KEY'],
  },
  {
    key: 'irs_eo', name: 'IRS — Exempt Organizations Business Master File (Hawaiʻi)', agency: 'Internal Revenue Service',
    jurisdiction: 'federal', accessMethod: 'bulk_download', baseUrl: 'https://www.irs.gov/pub/irs-soi/eo_hi.csv',
    docTypes: ['entity_registration'], edgeTypes: [], entityKinds: ['org'], cadence: 'monthly', tier: 1, status: 'live', restartOnComplete: true,
    notes: 'Every tax-exempt organization with a Hawaiʻi address (≈9,700): EIN, legal name, address, 501(c) subsection, ruling date, NTEE, assets/income. Public domain; refreshed monthly by the IRS.',
  },
  {
    key: 'gleif', name: 'GLEIF — Legal Entity Identifiers for Hawaiʻi-formed entities', agency: 'Global Legal Entity Identifier Foundation',
    jurisdiction: 'state', accessMethod: 'api', baseUrl: 'https://api.gleif.org/api/v1/lei-records?filter%5Bentity.jurisdiction%5D=US-HI',
    docTypes: ['entity_registration'], edgeTypes: ['owns'], entityKinds: ['org'], cadence: 'monthly', tier: 2, status: 'live', restartOnComplete: true,
    notes: 'CC0. ≈430 entities formed under Hawaiʻi law; records registered at RA000605 carry the DCCA BREG file number (registeredAs), the only open source of it. Level 2 direct parents become owns edges.',
  },
  {
    key: 'propublica_990', name: 'ProPublica Nonprofit Explorer', agency: 'ProPublica',
    jurisdiction: 'federal', accessMethod: 'api', baseUrl: 'https://projects.propublica.org',
    docTypes: ['irs_990'], edgeTypes: ['officer_of', 'director_of'], entityKinds: ['org', 'person'], cadence: 'monthly', tier: 1, status: 'live', restartOnComplete: true,
  },
  {
    key: 'sec_edgar', name: 'SEC EDGAR — submissions & DEF 14A officers/directors', agency: 'U.S. Securities and Exchange Commission',
    jurisdiction: 'federal', accessMethod: 'api', baseUrl: 'https://data.sec.gov', urls: ['https://efts.sec.gov'],
    docTypes: ['sec_filing'], edgeTypes: ['officer_of', 'director_of'], entityKinds: ['org', 'person'], cadence: 'weekly', tier: 1, status: 'live', restartOnComplete: true,
    notes: 'Requires descriptive User-Agent; ≤ 10 req/s.',
  },
  {
    key: 'sec_form_d', name: 'SEC Form D data sets — private offerings by Hawaiʻi issuers', agency: 'U.S. Securities and Exchange Commission',
    jurisdiction: 'federal', accessMethod: 'bulk_download', baseUrl: 'https://www.sec.gov/data-research/sec-markets-data/form-d-data-sets',
    docTypes: ['sec_filing'], edgeTypes: ['officer_of', 'director_of'], entityKinds: ['org', 'person'], cadence: 'monthly', tier: 1, status: 'live',
    notes: 'Quarterly ZIPs since 2008 (ISSUERS, OFFERING, RELATEDPERSONS). Primary issuer in HI → sec_filing document, issuer org by CIK, executive officers and directors as edges. Cursor counts quarters. EDGAR /cgi-bin company browse is robots-disallowed and not used.',
  },
  // ============================================================ Tier 1 — Counties
  {
    key: 'hnl_permits', name: 'Honolulu — building permits', agency: 'City & County of Honolulu DPP',
    jurisdiction: 'honolulu', accessMethod: 'socrata', baseUrl: 'https://data.honolulu.gov',
    docTypes: ['permit'], edgeTypes: ['owns'], entityKinds: ['parcel', 'org', 'person'], cadence: 'weekly', tier: 1, status: 'planned', secrets: ['SOCRATA_APP_TOKEN'],
  },
  {
    key: 'hnl_council', name: 'Honolulu City Council — legislation & votes', agency: 'Honolulu City Council',
    jurisdiction: 'honolulu', accessMethod: 'html', baseUrl: 'https://hnldoc.ehawaii.gov',
    docTypes: ['measure', 'vote'], edgeTypes: ['sponsored', 'voted_on'], entityKinds: ['bill', 'person'], cadence: 'weekly', tier: 1, status: 'planned',
  },
  {
    key: 'hnl_ethics', name: 'Honolulu Ethics Commission — lobbyists & disclosures', agency: 'Honolulu Ethics Commission',
    jurisdiction: 'honolulu', accessMethod: 'html', baseUrl: 'https://www.honolulu.gov/ethics',
    docTypes: ['lobbyist_registration', 'financial_disclosure'], edgeTypes: ['lobbied_for', 'disclosed_interest'], entityKinds: ['person', 'org'], cadence: 'monthly', tier: 1, status: 'planned',
  },
  {
    key: 'hnl_boards', name: 'Honolulu — boards & commissions', agency: 'City & County of Honolulu',
    jurisdiction: 'honolulu', accessMethod: 'html', baseUrl: 'https://www.honolulu.gov',
    docTypes: ['appointment'], edgeTypes: ['appointed_to'], entityKinds: ['person', 'office'], cadence: 'monthly', tier: 1, status: 'planned',
  },
  {
    key: 'hnl_purchasing', name: 'Honolulu — purchasing awards', agency: 'City & County of Honolulu BFS Purchasing',
    jurisdiction: 'honolulu', accessMethod: 'html', baseUrl: 'https://www.honolulu.gov/pur',
    docTypes: ['contract'], edgeTypes: ['awarded_contract'], entityKinds: ['org'], cadence: 'weekly', tier: 1, status: 'planned',
  },
  {
    key: 'maui_council', name: 'Maui County Council — Legistar', agency: 'Maui County Council',
    jurisdiction: 'maui', accessMethod: 'legistar', baseUrl: 'https://webapi.legistar.com/v1/mauicounty',
    docTypes: ['measure', 'vote'], edgeTypes: ['sponsored', 'voted_on'], entityKinds: ['bill', 'person'], cadence: 'weekly', tier: 1, status: 'planned',
    notes: 'Legistar client name to verify live: "mauicounty".',
  },
  {
    key: 'hawaii_council', name: 'Hawaiʻi County Council — Legistar', agency: 'Hawaiʻi County Council',
    jurisdiction: 'hawaii', accessMethod: 'legistar', baseUrl: 'https://webapi.legistar.com/v1/hawaiicounty',
    docTypes: ['measure', 'vote'], edgeTypes: ['sponsored', 'voted_on'], entityKinds: ['bill', 'person'], cadence: 'weekly', tier: 1, status: 'planned',
    notes: 'Legistar client name to verify live: "hawaiicounty".',
  },
  {
    key: 'kauai_council', name: 'Kauaʻi County Council — agendas & minutes', agency: 'Kauaʻi County Council',
    jurisdiction: 'kauai', accessMethod: 'html', baseUrl: 'https://www.kauai.gov/Government/Council',
    docTypes: ['measure', 'vote', 'agenda'], edgeTypes: ['sponsored', 'voted_on'], entityKinds: ['bill', 'person'], cadence: 'weekly', tier: 1, status: 'planned',
    notes: 'Platform to verify (CivicPlus vs Granicus).',
  },
  {
    key: 'property_hnl', name: 'Honolulu real property assessment', agency: 'City & County of Honolulu RPAD',
    jurisdiction: 'honolulu', accessMethod: 'bulk_download', baseUrl: 'https://www.realpropertyhonolulu.com', urls: ['https://qpublic.schneidercorp.com'],
    docTypes: ['property_record'], edgeTypes: ['owns'], entityKinds: ['parcel', 'person', 'org'], cadence: 'monthly', tier: 1, status: 'live',
    notes: 'Bulk files where offered; otherwise per-parcel only for TMKs linked to tracked entities.',
  },
  {
    key: 'property_maui', name: 'Maui real property assessment', agency: 'County of Maui RPA',
    jurisdiction: 'maui', accessMethod: 'html', baseUrl: 'https://qpublic.schneidercorp.com/Application.aspx?AppID=1032',
    docTypes: ['property_record'], edgeTypes: ['owns'], entityKinds: ['parcel', 'person', 'org'], cadence: 'monthly', tier: 1, status: 'planned',
  },
  {
    key: 'property_hawaii', name: 'Hawaiʻi County real property assessment', agency: 'County of Hawaiʻi RPT',
    jurisdiction: 'hawaii', accessMethod: 'html', baseUrl: 'https://qpublic.schneidercorp.com/Application.aspx?AppID=1048',
    docTypes: ['property_record'], edgeTypes: ['owns'], entityKinds: ['parcel', 'person', 'org'], cadence: 'monthly', tier: 1, status: 'planned',
  },
  {
    key: 'property_kauai', name: 'Kauaʻi real property assessment', agency: 'County of Kauaʻi RPA',
    jurisdiction: 'kauai', accessMethod: 'html', baseUrl: 'https://qpublic.schneidercorp.com/Application.aspx?AppID=1083',
    docTypes: ['property_record'], edgeTypes: ['owns'], entityKinds: ['parcel', 'person', 'org'], cadence: 'monthly', tier: 1, status: 'planned',
  },
  // ============================================================ Tier 2 — State
  {
    key: 'dcca_breg', name: 'DCCA Business Registration — registry export (Entity List Builder or UIPA)', agency: 'DCCA BREG',
    jurisdiction: 'state', accessMethod: 'manual_uipa', baseUrl: 'https://hbe.dcca.hawaii.gov/entity-list-builder',
    docTypes: ['business_registration'], edgeTypes: ['officer_of', 'director_of'], entityKinds: ['org', 'person'], cadence: 'monthly', tier: 1, status: 'manual',
    notes: 'The portal (hbe.dcca.hawaii.gov, formerly hbe.ehawaii.gov) is robots.txt "Disallow: /" and reCAPTCHA-protected: never fetched. Load a purchased Entity List Builder export or a UIPA extract as CSV via scripts/import/dcca-breg.ts --file= or the /admin/import upload. See docs/HAWAII_CORPORATIONS.md.',
  },
  {
    key: 'dcca_pvl', name: 'DCCA Professional & Vocational Licensing', agency: 'DCCA PVL',
    jurisdiction: 'state', accessMethod: 'html', baseUrl: 'https://mypvl.dcca.hawaii.gov',
    docTypes: ['license'], edgeTypes: ['licensed_by'], entityKinds: ['person', 'org'], cadence: 'monthly', tier: 2, status: 'planned',
  },
  {
    key: 'dcca_enforcement', name: 'DCCA RICO / OCP / Insurance / DFI / Securities enforcement', agency: 'DCCA',
    jurisdiction: 'state', accessMethod: 'html', baseUrl: 'https://cca.hawaii.gov',
    docTypes: ['enforcement_action'], edgeTypes: ['sanctioned_by'], entityKinds: ['person', 'org'], cadence: 'monthly', tier: 2, status: 'planned',
  },
  {
    key: 'dcca_catv', name: 'DCCA Cable Television dockets', agency: 'DCCA CATV',
    jurisdiction: 'state', accessMethod: 'html', baseUrl: 'https://cca.hawaii.gov/catv',
    docTypes: ['docket_filing'], edgeTypes: ['party_to'], entityKinds: ['docket', 'org'], cadence: 'monthly', tier: 2, status: 'planned',
  },
  {
    key: 'ag_charities', name: 'AG Tax & Charities registrations', agency: 'Department of the Attorney General',
    jurisdiction: 'state', accessMethod: 'html', baseUrl: 'https://ag.ehawaii.gov/charity',
    docTypes: ['business_registration'], edgeTypes: ['officer_of'], entityKinds: ['org', 'person'], cadence: 'quarterly', tier: 2, status: 'planned',
  },
  {
    key: 'dlnr', name: 'DLNR — BLNR agendas, leases & revocable permits, CWRM, OCCL', agency: 'Department of Land and Natural Resources',
    jurisdiction: 'state', accessMethod: 'html', baseUrl: 'https://dlnr.hawaii.gov',
    docTypes: ['agenda', 'lease'], edgeTypes: ['leases', 'party_to'], entityKinds: ['org', 'person', 'parcel', 'office'], cadence: 'weekly', tier: 2, status: 'planned',
    notes: 'Bureau of Conveyances: index metadata only.',
  },
  {
    key: 'luc', name: 'Land Use Commission dockets', agency: 'Land Use Commission',
    jurisdiction: 'state', accessMethod: 'html', baseUrl: 'https://luc.hawaii.gov',
    docTypes: ['docket_filing'], edgeTypes: ['party_to'], entityKinds: ['docket', 'org', 'parcel'], cadence: 'weekly', tier: 2, status: 'planned',
  },
  {
    key: 'opsd_env_notice', name: 'OPSD Environmental Notice', agency: 'Office of Planning and Sustainable Development ERP',
    jurisdiction: 'state', accessMethod: 'pdf', baseUrl: 'https://planning.hawaii.gov/erp',
    docTypes: ['agenda'], edgeTypes: ['mentioned_in', 'party_to'], entityKinds: ['org', 'parcel'], cadence: 'weekly', tier: 2, status: 'planned',
  },
  {
    key: 'state_boards_misc', name: 'HCDA, HHFDC, HPHA, DHHL, OHA, ADC, HTA, UH Regents, BOE, Stadium Authority, HGIA, HSDC, ERS, EUTF — agendas & awards', agency: 'Various state authorities',
    jurisdiction: 'state', accessMethod: 'html', baseUrl: 'https://portal.ehawaii.gov',
    docTypes: ['agenda', 'contract', 'grant'], edgeTypes: ['member_of', 'awarded_contract', 'awarded_grant'], entityKinds: ['office', 'org', 'person'], cadence: 'weekly', tier: 2, status: 'planned',
  },
  {
    key: 'dot_leases', name: 'DOT Airports & Harbors leases and concessions', agency: 'Department of Transportation',
    jurisdiction: 'state', accessMethod: 'html', baseUrl: 'https://hidot.hawaii.gov',
    docTypes: ['lease'], edgeTypes: ['leases'], entityKinds: ['org'], cadence: 'quarterly', tier: 2, status: 'planned',
  },
  {
    key: 'bf_cip', name: 'Budget & Finance — CIP', agency: 'Department of Budget and Finance',
    jurisdiction: 'state', accessMethod: 'pdf', baseUrl: 'https://budget.hawaii.gov',
    docTypes: ['grant'], edgeTypes: ['awarded_grant'], entityKinds: ['org'], cadence: 'annual', tier: 2, status: 'planned',
  },
  {
    key: 'tax_credits', name: 'DBEDT / Taxation tax-credit reports', agency: 'DBEDT & Department of Taxation',
    jurisdiction: 'state', accessMethod: 'pdf', baseUrl: 'https://tax.hawaii.gov',
    docTypes: ['grant'], edgeTypes: ['awarded_grant'], entityKinds: ['org'], cadence: 'annual', tier: 2, status: 'planned',
  },
  {
    key: 'hlrb', name: 'Hawaiʻi Labor Relations Board decisions', agency: 'HLRB',
    jurisdiction: 'state', accessMethod: 'html', baseUrl: 'https://labor.hawaii.gov/hlrb',
    docTypes: ['docket_filing'], edgeTypes: ['party_to'], entityKinds: ['docket', 'org'], cadence: 'monthly', tier: 2, status: 'planned',
  },
  {
    key: 'auditor', name: 'State Auditor reports', agency: 'Office of the Auditor',
    jurisdiction: 'state', accessMethod: 'pdf', baseUrl: 'https://auditor.hawaii.gov',
    docTypes: ['article'], edgeTypes: ['mentioned_in'], entityKinds: ['org'], cadence: 'monthly', tier: 2, status: 'planned',
  },
  {
    key: 'jsc', name: 'Judicial Selection Commission — nominee lists', agency: 'Judicial Selection Commission',
    jurisdiction: 'state', accessMethod: 'html', baseUrl: 'https://www.courts.state.hi.us/judicial_selection_commission',
    docTypes: ['appointment'], edgeTypes: ['appointed_to'], entityKinds: ['person', 'office'], cadence: 'monthly', tier: 2, status: 'planned',
  },
  // ============================================================ Tier 2 — Federal
  {
    key: 'dol_olms', name: 'DOL OLMS union filings (LM-2/3/4)', agency: 'U.S. Department of Labor',
    jurisdiction: 'federal', accessMethod: 'api', baseUrl: 'https://olmsapps.dol.gov',
    docTypes: ['business_registration'], edgeTypes: ['officer_of'], entityKinds: ['org', 'person'], cadence: 'quarterly', tier: 2, status: 'planned',
  },
  {
    key: 'fcc', name: 'FCC licenses & ownership (HI)', agency: 'Federal Communications Commission',
    jurisdiction: 'federal', accessMethod: 'api', baseUrl: 'https://www.fcc.gov',
    docTypes: ['license'], edgeTypes: ['licensed_by', 'officer_of'], entityKinds: ['org', 'person'], cadence: 'quarterly', tier: 2, status: 'planned',
  },
  {
    key: 'congress_disclosures', name: 'House Clerk & Senate eFD financial disclosures (HI delegation)', agency: 'U.S. House / Senate',
    jurisdiction: 'federal', accessMethod: 'pdf', baseUrl: 'https://disclosures-clerk.house.gov', urls: ['https://efdsearch.senate.gov'],
    docTypes: ['financial_disclosure'], edgeTypes: ['disclosed_interest'], entityKinds: ['person', 'org'], cadence: 'annual', tier: 2, status: 'planned',
    notes: 'Senate eFD requires a CAPTCHA/terms acknowledgement per session; treat as blocked if automation is disallowed.',
  },
  {
    key: 'fac', name: 'Federal Audit Clearinghouse single audits', agency: 'GSA FAC',
    jurisdiction: 'federal', accessMethod: 'api', baseUrl: 'https://api.fac.gov',
    docTypes: ['grant'], edgeTypes: ['awarded_grant'], entityKinds: ['org'], cadence: 'quarterly', tier: 2, status: 'planned', secrets: ['DATA_GOV_API_KEY'],
  },
  {
    key: 'fara', name: 'FARA registrations', agency: 'U.S. Department of Justice',
    jurisdiction: 'federal', accessMethod: 'api', baseUrl: 'https://efile.fara.gov',
    docTypes: ['lda_filing'], edgeTypes: ['lobbied_for'], entityKinds: ['org', 'person'], cadence: 'quarterly', tier: 2, status: 'planned',
  },
  {
    key: 'eia_860', name: 'EIA-860 generators & owners (HI)', agency: 'U.S. Energy Information Administration',
    jurisdiction: 'federal', accessMethod: 'bulk_download', baseUrl: 'https://www.eia.gov/electricity/data/eia860',
    docTypes: ['license'], edgeTypes: ['owns'], entityKinds: ['org'], cadence: 'annual', tier: 2, status: 'planned',
  },
  {
    key: 'sba_ppp', name: 'SBA PPP / EIDL loans (HI)', agency: 'U.S. Small Business Administration',
    jurisdiction: 'federal', accessMethod: 'bulk_download', baseUrl: 'https://data.sba.gov',
    docTypes: ['loan'], edgeTypes: ['loaned_to'], entityKinds: ['org'], cadence: 'annual', tier: 2, status: 'planned',
  },
  {
    key: 'nlrb', name: 'NLRB cases (HI)', agency: 'National Labor Relations Board',
    jurisdiction: 'federal', accessMethod: 'html', baseUrl: 'https://www.nlrb.gov',
    docTypes: ['docket_filing'], edgeTypes: ['party_to'], entityKinds: ['docket', 'org'], cadence: 'monthly', tier: 2, status: 'planned',
  },
  {
    key: 'congress_gov', name: 'Congress.gov — HI delegation bills & votes', agency: 'Library of Congress',
    jurisdiction: 'federal', accessMethod: 'api', baseUrl: 'https://api.congress.gov',
    docTypes: ['measure', 'vote'], edgeTypes: ['sponsored', 'voted_on'], entityKinds: ['bill', 'person'], cadence: 'weekly', tier: 2, status: 'planned', secrets: ['CONGRESS_API_KEY'],
  },
  // ============================================================ Tier 2 — Counties
  {
    key: 'county_planning', name: 'County planning commissions, ZBAs, SMA permits', agency: 'County planning departments',
    jurisdiction: 'honolulu', accessMethod: 'html', baseUrl: 'https://www.honolulu.gov/dpp',
    docTypes: ['permit', 'agenda'], edgeTypes: ['party_to', 'owns'], entityKinds: ['parcel', 'org', 'person'], cadence: 'weekly', tier: 2, status: 'planned',
  },
  {
    key: 'liquor', name: 'County liquor commissions — licenses & violations', agency: 'County liquor commissions',
    jurisdiction: 'honolulu', accessMethod: 'html', baseUrl: 'https://www.honolulu.gov/liq',
    docTypes: ['license', 'enforcement_action'], edgeTypes: ['licensed_by', 'sanctioned_by'], entityKinds: ['org'], cadence: 'monthly', tier: 2, status: 'planned',
  },
  {
    key: 'bws', name: 'Honolulu Board of Water Supply — board & contracts', agency: 'Board of Water Supply',
    jurisdiction: 'honolulu', accessMethod: 'html', baseUrl: 'https://www.boardofwatersupply.com',
    docTypes: ['agenda', 'contract'], edgeTypes: ['member_of', 'awarded_contract'], entityKinds: ['office', 'org', 'person'], cadence: 'monthly', tier: 2, status: 'planned',
  },
  {
    key: 'hart', name: 'HART — board & contracts', agency: 'Honolulu Authority for Rapid Transportation',
    jurisdiction: 'honolulu', accessMethod: 'html', baseUrl: 'https://www.honolulutransit.org',
    docTypes: ['agenda', 'contract'], edgeTypes: ['member_of', 'awarded_contract'], entityKinds: ['office', 'org', 'person'], cadence: 'monthly', tier: 2, status: 'planned',
  },
  {
    key: 'county_ethics', name: 'Maui, Hawaiʻi, Kauaʻi ethics boards', agency: 'County boards of ethics',
    jurisdiction: 'maui', accessMethod: 'html', baseUrl: 'https://www.mauicounty.gov/103/Board-of-Ethics',
    docTypes: ['financial_disclosure', 'ethics_charge'], edgeTypes: ['disclosed_interest', 'sanctioned_by'], entityKinds: ['person'], cadence: 'quarterly', tier: 2, status: 'planned',
    notes: 'Verify which counties publish disclosures online.',
  },
  // ============================================================ Tier 3 — manual / restricted
  {
    key: 'employee_compensation', name: 'Public employee compensation (UIPA request)', agency: 'Various',
    jurisdiction: 'state', accessMethod: 'manual_uipa', baseUrl: 'https://oip.hawaii.gov',
    docTypes: ['record'], edgeTypes: ['employed_by'], entityKinds: ['person', 'org'], cadence: 'annual', tier: 3, status: 'manual',
    notes: 'HRS §92F-12(a)(14). CSV importer for use once the data is obtained: scripts/import/employee-compensation.ts or the /admin/import CSV upload.',
  },
  {
    key: 'judiciary_ecourt', name: 'Judiciary eCourt Kokua / Hoʻohiki', agency: 'Hawaiʻi State Judiciary',
    jurisdiction: 'state', accessMethod: 'html', baseUrl: 'https://www.courts.state.hi.us/legal_references/records/jims_system_availability',
    docTypes: ['docket_filing'], edgeTypes: ['party_to'], entityKinds: ['docket', 'person', 'org'], cadence: 'on_demand', tier: 3, status: 'blocked',
    notes: 'Terms of use prohibit automated access unless a data agreement is in place. Not scraped.',
  },
]

export const SOURCE_BY_KEY: Record<string, SourceDefinition> = Object.fromEntries(SOURCE_REGISTRY.map(s => [s.key, s]))

export function getSource(key: string): SourceDefinition {
  const s = SOURCE_BY_KEY[key]
  if (!s) throw new Error(`Unknown source key: ${key}`)
  return s
}
