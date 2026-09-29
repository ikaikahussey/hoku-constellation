/**
 * SEC EDGAR — every filer with a Hawaiʻi business address.
 *
 * Discovery: EDGAR's company browse filtered to State=HI, Atom output
 * (https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&State=HI&output=atom), 100 per page;
 * ≈780 filers. The Atom names are unusable (EDGAR prints "ARRAY(0x…)"), so each CIK's authoritative record
 * comes from https://data.sec.gov/submissions/CIK##########.json: legal name, EIN, state of incorporation,
 * SIC industry, addresses, former names, and filing history.
 *
 * Most Hawaiʻi filers are private companies that file Form D offering notices; a few are public
 * registrants. Filers whose only filings are insider-ownership forms (3/4/5, 144, 13D/G) are individuals
 * and are skipped. Each company becomes one `entity_registration` document and an org resolved by
 * sec_cik / EIN. Officers and directors of public registrants come from sec_edgar (DEF 14A).
 */
import type { Db } from '@/lib/db/types'
import { fetchJson, fetchText, USER_AGENT } from '../http'
import { processRecord, emptyResult, resolveRef, type BatchResult } from '../pipeline'
import { cleanName, islandForZip } from '../normalize'
import type { ImportOptions, SourcePage } from '../types'

export const SOURCE_KEY = 'sec_hi_companies'
const HEADERS = { 'user-agent': `${USER_AGENT} research@hoku.fm` }
const BROWSE = (start: number) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&State=HI&owner=include&count=100&start=${start}&output=atom`
const SUBMISSIONS = (cik: string) => `https://data.sec.gov/submissions/CIK${cik}.json`
/** Each company costs one data.sec.gov request; cap per batch so a cron tick stays inside its budget. */
export const MAX_PER_BATCH = 50

interface Address { street1?: string | null; street2?: string | null; city?: string | null; stateOrCountry?: string | null; zipCode?: string | null }
export interface CompanySubmissions {
  cik: string; name: string; entityType?: string | null; sic?: string | null; sicDescription?: string | null
  tickers?: string[]; exchanges?: string[]; ein?: string | null
  stateOfIncorporation?: string | null; stateOfIncorporationDescription?: string | null
  addresses?: { business?: Address; mailing?: Address }
  formerNames?: Array<{ name: string; from?: string; to?: string }>
  filings?: { recent?: { form?: string[]; filingDate?: string[] } }
}

const OWNERSHIP_FORMS = new Set(['3', '4', '5', '3/A', '4/A', '5/A', '144', '144/A', 'SC 13D', 'SC 13G', 'SC 13D/A', 'SC 13G/A', 'SCHEDULE 13D', 'SCHEDULE 13G', 'SCHEDULE 13D/A', 'SCHEDULE 13G/A'])

/** CIKs in an EDGAR company-browse Atom page. */
export function parseBrowseAtom(xml: string): string[] {
  return [...xml.matchAll(/<cik>\s*(\d{1,10})\s*<\/cik>/g)].map(m => m[1].padStart(10, '0'))
}

/** EDGAR uses "000000000" for "no EIN on file". */
export function cleanEin(ein: string | null | undefined): string | null {
  const d = String(ein ?? '').replace(/\D/g, '')
  return d.length === 9 && !/^0+$/.test(d) ? d : null
}

/** A filer is a company unless every filing it has made is an insider-ownership form. */
export function isCompany(s: CompanySubmissions): boolean {
  if (s.sic || cleanEin(s.ein) || s.entityType === 'operating') return true
  const forms = s.filings?.recent?.form ?? []
  return forms.some(f => !OWNERSHIP_FORMS.has(f))
}

export function formSummary(s: CompanySubmissions): { forms: Record<string, number>; lastFiled: string | null; formD: boolean } {
  const forms: Record<string, number> = {}
  for (const f of s.filings?.recent?.form ?? []) forms[f] = (forms[f] ?? 0) + 1
  const dates = (s.filings?.recent?.filingDate ?? []).filter(Boolean).sort()
  return { forms, lastFiled: dates.at(-1) ?? null, formD: 'D' in forms || 'D/A' in forms }
}

export function orgAttributesFor(s: CompanySubmissions): Record<string, unknown> {
  const b = s.addresses?.business ?? {}
  const zip = cleanName(b.zipCode) ?? undefined
  const { formD, lastFiled } = formSummary(s)
  const attrs: Record<string, unknown> = {
    org_type: s.entityType === 'operating' ? 'corporation' : 'company',
    sector: cleanName(s.sicDescription) ?? undefined,
    sic: cleanName(s.sic) ?? undefined,
    tickers: s.tickers?.length ? s.tickers : undefined,
    city: cleanName(b.city) ?? undefined,
    state: cleanName(b.stateOrCountry) ?? undefined,
    zip,
    island: b.stateOrCountry === 'HI' ? islandForZip(zip) ?? undefined : undefined,
    state_of_incorporation: cleanName(s.stateOfIncorporationDescription ?? s.stateOfIncorporation) ?? undefined,
    sec_form_d_filer: formD || undefined,
    sec_last_filed: lastFiled ?? undefined,
  }
  return Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined))
}

/** The document keeps the registrant metadata and a per-form count, not the full filing index. */
export function documentRaw(s: CompanySubmissions): Record<string, unknown> {
  const { filings, ...rest } = s
  void filings
  return { ...rest, filing_summary: formSummary(s) }
}

// Discovery list, cached per warm instance so batches slice a stable, sorted CIK list.
let cache: { at: number; ciks: string[] } | null = null
const CACHE_MS = 30 * 60_000

async function discoverCiks(): Promise<string[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.ciks
  const all = new Set<string>()
  for (let start = 0; start < 10_000; start += 100) {
    const page = parseBrowseAtom(await fetchText(BROWSE(start), { headers: HEADERS }))
    page.forEach(c => all.add(c))
    if (page.length < 100) break
  }
  cache = { at: Date.now(), ciks: [...all].sort() }
  return cache.ciks
}

export async function importBatch(db: Db, offset: number, batchSize: number, opts: ImportOptions = {}): Promise<BatchResult> {
  const log = opts.log ?? (() => {})
  const params = opts.params ?? {}
  const result = emptyResult(offset)
  const size = Math.min(batchSize, MAX_PER_BATCH)

  let page: SourcePage<CompanySubmissions>
  if (opts.pageSource) {
    page = (await opts.pageSource(offset, size, params)) as unknown as SourcePage<CompanySubmissions>
  } else {
    const ciks = await discoverCiks()
    const slice = ciks.slice(offset, offset + size)
    const records: CompanySubmissions[] = []
    for (const cik of slice) {
      try { records.push(await fetchJson<CompanySubmissions>(SUBMISSIONS(cik), { headers: HEADERS })) }
      catch (e) { result.errors++; log(`cik ${cik}: ${(e as Error).message}`) }
    }
    // Advance past failed CIKs too: nextOffset counts discovery positions, not successes.
    page = { records, total: ciks.length, done: offset + slice.length >= ciks.length }
    result.nextOffset = offset + slice.length
  }

  for (const s of page.records) {
    const cik = String(s.cik).padStart(10, '0')
    const name = cleanName(s.name)
    if (!name || !isCompany(s)) { result.seen++; continue }
    const ein = cleanEin(s.ein)
    try {
      await processRecord(db, {
        document: {
          source: SOURCE_KEY, source_record_id: cik, doc_type: 'entity_registration',
          title: `${name} — SEC filer (CIK ${Number(cik)})`, doc_date: formSummary(s).lastFiled,
          url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}`, raw: documentRaw(s),
        },
        edges: async ({ db: d, created }) => {
          const aliases = (s.formerNames ?? []).map(f => cleanName(f.name)).filter((n): n is string => !!n && n !== name)
          const org = await resolveRef(d, { kind: 'org', rawName: name, identifiers: { sec_cik: cik, ein }, aliases, attributes: orgAttributesFor(s) })
          if (org.created) created()
          return []
        },
      }, result)
    } catch (e) { result.errors++; log(`cik ${cik}: ${(e as Error).message}`) }
  }
  if (opts.pageSource) result.nextOffset = offset + page.records.length
  result.done = page.done ?? page.records.length < size
  return result
}
