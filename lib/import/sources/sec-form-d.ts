/**
 * SEC Form D — private offerings by issuers with a Hawaiʻi principal place of business.
 *
 * Source: the SEC's quarterly Form D data sets (https://www.sec.gov/data-research/sec-markets-data/form-d-data-sets),
 * one ZIP per quarter since 2008 with ISSUERS, FORMDSUBMISSION, OFFERING and RELATEDPERSONS tables.
 * (EDGAR's company browse under /cgi-bin is disallowed by sec.gov's robots.txt; these files under /files are
 * not.) Each batch reads one quarter, keeps filings whose primary issuer is in Hawaiʻi, and writes one
 * `sec_filing` document per accession number. The issuer is resolved or created by CIK; executive officers
 * and directors named in the filing become officer_of / director_of edges from resolve-only person
 * references. Promoters are kept in the document but produce no edge.
 *
 * The cursor counts quarters, so a monthly run resumes at the first quarter it has not read.
 */
import type { Db } from '@/lib/db/types'
import { fetchBuffer, fetchText, USER_AGENT } from '../http'
import { processRecord, emptyResult, resolveRef, type BatchResult, type EdgeInput } from '../pipeline'
import { cleanName, canonicalPersonName, islandForZip, toAmount } from '../normalize'
import type { ImportOptions, SourcePage } from '../types'
import { unzip, parseTsv } from '../clients/zip'

export const SOURCE_KEY = 'sec_form_d'
const HEADERS = { 'user-agent': `${USER_AGENT} research@hoku.fm` }
const LISTING = 'https://www.sec.gov/data-research/sec-markets-data/form-d-data-sets'

export interface RelatedPerson { name: string; isOrg: boolean; relationships: string[]; clarification: string | null; city: string | null; state: string | null }
export interface FormDFiling {
  accession: string
  quarter: string
  cik: string
  entityName: string
  entityType: string | null
  jurisdiction: string | null
  yearOfInc: string | null
  city: string | null
  state: string | null
  zip: string | null
  previousNames: string[]
  filingDate: string | null
  submissionType: string | null
  industryGroup: string | null
  totalOfferingAmount: number | null
  totalAmountSold: number | null
  relatedPersons: RelatedPerson[]
}

const MONTHS: Record<string, string> = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' }

/** "31-MAR-2026" → "2026-03-31" (the data sets' date format); ISO dates pass through. */
export function formDDate(v: string | null | undefined): string | null {
  const s = String(v ?? '').trim().toUpperCase()
  const m = s.match(/^(\d{1,2})-([A-Z]{3})-(\d{4})$/)
  if (m && MONTHS[m[2]]) return `${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, '0')}`
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null
}

/** Quarterly ZIP links on the listing page, oldest first: [{ quarter: '2026q1', url }]. */
export function parseQuarterLinks(html: string): Array<{ quarter: string; url: string }> {
  const seen = new Map<string, string>()
  for (const m of html.matchAll(/href="([^"]*form-d-data-sets\/(\d{4})q([1-4])_d\.zip)"/gi)) {
    const quarter = `${m[2]}q${m[3]}`
    if (!seen.has(quarter)) seen.set(quarter, new URL(m[1], 'https://www.sec.gov').toString())
  }
  return [...seen.entries()].map(([quarter, url]) => ({ quarter, url })).sort((a, b) => a.quarter.localeCompare(b.quarter))
}

const nameOf = (p: Record<string, string>) => {
  const first = cleanName(p.FIRSTNAME), middle = cleanName(p.MIDDLENAME), last = cleanName(p.LASTNAME)
  const isOrg = !first || /^n\/?a$/i.test(first)
  const name = isOrg ? last : [first, middle, last].filter(Boolean).join(' ')
  return { name: name ?? '', isOrg }
}

/** Filings in one quarter's tables whose primary issuer is in Hawaiʻi. */
export function extractHawaiiFilings(tables: { issuers: Record<string, string>[]; submissions: Record<string, string>[]; offerings: Record<string, string>[]; persons: Record<string, string>[] }, quarter: string, state = 'HI'): FormDFiling[] {
  const primary = tables.issuers.filter(r => r.IS_PRIMARYISSUER_FLAG?.toUpperCase() === 'YES' && r.STATEORCOUNTRY?.toUpperCase() === state)
  const wanted = new Set(primary.map(r => r.ACCESSIONNUMBER))
  const submissions = new Map(tables.submissions.filter(r => wanted.has(r.ACCESSIONNUMBER)).map(r => [r.ACCESSIONNUMBER, r]))
  const offerings = new Map(tables.offerings.filter(r => wanted.has(r.ACCESSIONNUMBER)).map(r => [r.ACCESSIONNUMBER, r]))
  const persons = new Map<string, RelatedPerson[]>()
  for (const p of tables.persons) {
    if (!wanted.has(p.ACCESSIONNUMBER)) continue
    const { name, isOrg } = nameOf(p)
    if (!name) continue
    const relationships = [p.RELATIONSHIP_1, p.RELATIONSHIP_2, p.RELATIONSHIP_3].map(r => cleanName(r)).filter((r): r is string => !!r)
    const list = persons.get(p.ACCESSIONNUMBER) ?? []
    list.push({ name, isOrg, relationships, clarification: cleanName(p.RELATIONSHIPCLARIFICATION), city: cleanName(p.CITY), state: cleanName(p.STATEORCOUNTRY) })
    persons.set(p.ACCESSIONNUMBER, list)
  }
  return primary.map(r => {
    const sub = submissions.get(r.ACCESSIONNUMBER) ?? {}
    const off = offerings.get(r.ACCESSIONNUMBER) ?? {}
    return {
      accession: r.ACCESSIONNUMBER, quarter,
      cik: String(r.CIK ?? '').replace(/\D/g, '').padStart(10, '0'),
      entityName: cleanName(r.ENTITYNAME) ?? '',
      entityType: cleanName(r.ENTITYTYPE === 'Other' ? r.ENTITYTYPEOTHERDESC || r.ENTITYTYPE : r.ENTITYTYPE),
      jurisdiction: cleanName(r.JURISDICTIONOFINC), yearOfInc: cleanName(r.YEAROFINC_VALUE_ENTERED),
      city: cleanName(r.CITY), state: cleanName(r.STATEORCOUNTRY), zip: cleanName(r.ZIPCODE),
      previousNames: [r.ISSUER_PREVIOUSNAME_1, r.ISSUER_PREVIOUSNAME_2, r.ISSUER_PREVIOUSNAME_3, r.EDGAR_PREVIOUSNAME_1, r.EDGAR_PREVIOUSNAME_2, r.EDGAR_PREVIOUSNAME_3]
        .map(n => cleanName(n)).filter((n): n is string => !!n && !/^none$/i.test(n)),
      filingDate: formDDate(sub.FILING_DATE), submissionType: cleanName(sub.SUBMISSIONTYPE),
      industryGroup: cleanName(off.INDUSTRYGROUPTYPE),
      totalOfferingAmount: /^\d/.test(off.TOTALOFFERINGAMOUNT ?? '') ? toAmount(off.TOTALOFFERINGAMOUNT) : null,
      totalAmountSold: /^\d/.test(off.TOTALAMOUNTSOLD ?? '') ? toAmount(off.TOTALAMOUNTSOLD) : null,
      relatedPersons: persons.get(r.ACCESSIONNUMBER) ?? [],
    }
  }).filter(f => f.entityName && /^\d{10}$/.test(f.cik))
}

/** Read one quarter's ZIP into filings. Table names are matched case-insensitively inside any folder. */
export function readQuarterZip(buf: Buffer, quarter: string): FormDFiling[] {
  const files = unzip(buf, n => /(ISSUERS|FORMDSUBMISSION|OFFERING|RELATEDPERSONS)\.tsv$/i.test(n))
  const table = (name: string) => {
    const entry = [...files.entries()].find(([n]) => new RegExp(`(^|/)${name}\\.tsv$`, 'i').test(n))
    return entry ? parseTsv(entry[1].toString('utf8')) : []
  }
  return extractHawaiiFilings({ issuers: table('ISSUERS'), submissions: table('FORMDSUBMISSION'), offerings: table('OFFERING'), persons: table('RELATEDPERSONS') }, quarter)
}

export function orgTypeFor(entityType: string | null): string {
  const t = (entityType ?? '').toLowerCase()
  if (/limited liability company/.test(t)) return 'llc'
  if (/limited partnership/.test(t)) return 'limited_partnership'
  if (/partnership/.test(t)) return 'partnership'
  if (/trust/.test(t)) return 'trust'
  if (/corporation/.test(t)) return 'corporation'
  return 'company'
}

export function orgAttributesFor(f: FormDFiling): Record<string, unknown> {
  const attrs: Record<string, unknown> = {
    org_type: orgTypeFor(f.entityType),
    legal_form: f.entityType ?? undefined,
    sector: f.industryGroup ?? undefined,
    city: f.city ?? undefined,
    state: f.state ?? undefined,
    zip: f.zip ?? undefined,
    island: islandForZip(f.zip) ?? undefined,
    jurisdiction: f.jurisdiction ?? undefined,
    year_of_incorporation: f.yearOfInc ?? undefined,
    sec_form_d_filer: true,
  }
  return Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined))
}

/** Edge type per Form D relationship; promoters get no edge. */
export function edgeTypesFor(p: RelatedPerson): Array<'officer_of' | 'director_of'> {
  const out: Array<'officer_of' | 'director_of'> = []
  if (p.relationships.some(r => /executive officer/i.test(r))) out.push('officer_of')
  if (p.relationships.some(r => /director/i.test(r))) out.push('director_of')
  return out
}

let listing: { at: number; quarters: Array<{ quarter: string; url: string }> } | null = null
async function quarters(): Promise<Array<{ quarter: string; url: string }>> {
  if (listing && Date.now() - listing.at < 30 * 60_000) return listing.quarters
  listing = { at: Date.now(), quarters: parseQuarterLinks(await fetchText(LISTING, { headers: HEADERS })) }
  if (!listing.quarters.length) throw new Error('sec_form_d: no quarterly data set links found on the listing page')
  return listing.quarters
}

export async function importBatch(db: Db, offset: number, batchSize: number, opts: ImportOptions = {}): Promise<BatchResult> {
  const log = opts.log ?? (() => {})
  const params = opts.params ?? {}
  const result = emptyResult(offset)

  let page: SourcePage<FormDFiling>
  if (opts.pageSource) {
    page = (await opts.pageSource(offset, batchSize, params)) as unknown as SourcePage<FormDFiling>
    result.nextOffset = offset + page.records.length
  } else {
    const list = await quarters()
    const q = list[offset]
    if (!q) return { ...result, done: true }
    const filings = readQuarterZip(await fetchBuffer(q.url, { headers: HEADERS, timeoutMs: 180_000 }), q.quarter)
    log(`${q.quarter}: ${filings.length} Hawaiʻi filings`)
    page = { records: filings, done: offset + 1 >= list.length }
    result.nextOffset = offset + 1 // cursor counts quarters
  }

  for (const f of page.records) {
    try {
      const people = f.relatedPersons.filter(p => !p.isOrg && edgeTypesFor(p).length)
      await processRecord(db, {
        document: {
          source: SOURCE_KEY, source_record_id: f.accession, doc_type: 'sec_filing',
          title: `${f.entityName} — Form ${f.submissionType ?? 'D'}${f.filingDate ? ` ${f.filingDate}` : ''}`,
          doc_date: f.filingDate,
          url: `https://www.sec.gov/Archives/edgar/data/${Number(f.cik)}/${f.accession.replace(/-/g, '')}/`,
          raw: f as unknown as Record<string, unknown>,
          body_text: [
            `${f.entityName} (${f.entityType ?? 'entity'}, ${f.jurisdiction ?? 'jurisdiction not stated'}) filed Form ${f.submissionType ?? 'D'}${f.filingDate ? ` on ${f.filingDate}` : ''}.`,
            f.industryGroup ? `Industry: ${f.industryGroup}.` : '',
            f.totalOfferingAmount != null ? `Offering: $${f.totalOfferingAmount.toLocaleString('en-US')}; sold: $${(f.totalAmountSold ?? 0).toLocaleString('en-US')}.` : '',
            f.relatedPersons.length ? `Related persons: ${f.relatedPersons.map(p => `${p.name} (${p.relationships.join(', ')})`).join('; ')}.` : '',
          ].filter(Boolean).join(' '),
        },
        edges: async ({ db: d, created }) => {
          const org = await resolveRef(d, { kind: 'org', rawName: f.entityName, identifiers: { sec_cik: f.cik }, aliases: f.previousNames.filter(n => n !== f.entityName), attributes: orgAttributesFor(f) })
          if (org.created) created()
          const edges: EdgeInput[] = []
          for (const p of people) {
            const person = await resolveRef(d, { kind: 'person', rawName: p.name, canonicalName: canonicalPersonName(p.name) })
            for (const type of edgeTypesFor(p)) {
              edges.push({ type, from: person, to: org, role: p.clarification ?? (type === 'director_of' ? 'Director' : 'Executive Officer'), start_date: f.filingDate, attributes: { relationships: p.relationships, source_description: `SEC Form D ${f.accession}` } })
            }
          }
          return edges
        },
      }, result)
    } catch (e) { result.errors++; log(`${f.accession}: ${(e as Error).message}`) }
  }
  result.done = page.done ?? page.records.length < batchSize
  return result
}
