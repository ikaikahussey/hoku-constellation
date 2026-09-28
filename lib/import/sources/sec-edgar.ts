/**
 * SEC EDGAR — company submissions for Hawaiʻi-headquartered registrants (state of incorporation /
 * business address HI) and DEF 14A proxy statements for officer/director tables.
 *
 * Company list: EDGAR full-text search `efts.sec.gov/LATEST/search-index?q=...` is not needed; we use
 * the company_tickers + submissions JSON (data.sec.gov) and filter by business address state = HI,
 * plus any CIKs already present on org entities (identifiers.sec_cik).
 */
import type { Db } from '@/lib/db/types'
import { fetchJson, fetchText, USER_AGENT } from '../http'
import { processRecord, emptyResult, resolveRef, type BatchResult, type EdgeInput } from '../pipeline'
import { cleanName, canonicalPersonName, toIsoDate } from '../normalize'
import type { ImportOptions, SourcePage } from '../types'
import { load } from 'cheerio'

export const SOURCE_KEY = 'sec_edgar'
export const DEFAULT_CIKS = ['0000046619', '0000003906', '0001616862', '0000046195', '0000036377'] // HEI, A&B, Matson, BOH, FHB (First Hawaiian)
const SUBMISSIONS = (cik: string) => `https://data.sec.gov/submissions/CIK${cik.padStart(10, '0')}.json`
const UA = { 'user-agent': `${USER_AGENT} research@hoku.fm` }

export interface Submissions {
  cik: string; name: string; tickers?: string[]; sicDescription?: string; stateOfIncorporation?: string
  addresses?: { business?: { stateOrCountry?: string; city?: string } }
  filings?: { recent?: { form: string[]; accessionNumber: string[]; filingDate: string[]; primaryDocument: string[] } }
}

export interface ProxyPerson { name: string; title: string | null; age: number | null }

/**
 * Parse director/executive-officer tables from a DEF 14A HTML document. Looks for tables whose header
 * row contains "Name" and ("Age" or "Position"), then reads name/age/position cells.
 */
export function parseDef14aPeople(html: string): ProxyPerson[] {
  const $ = load(html)
  const out: ProxyPerson[] = []
  $('table').each((_, table) => {
    const rows = $(table).find('tr').toArray()
    if (rows.length < 2) return
    const header = rows[0] && $(rows[0]).text().toLowerCase()
    if (!header || !/name/.test(header) || !/(age|position|title)/.test(header)) return
    const cols = $(rows[0]).find('th,td').toArray().map(c => $(c).text().trim().toLowerCase())
    const nameIdx = cols.findIndex(c => c.includes('name'))
    const ageIdx = cols.findIndex(c => c === 'age' || c.includes('age'))
    const posIdx = cols.findIndex(c => /position|title|office/.test(c))
    for (const row of rows.slice(1)) {
      const cells = $(row).find('td').toArray().map(c => $(c).text().replace(/\s+/g, ' ').trim())
      const name = cleanName(cells[nameIdx])
      if (!name || name.length > 60 || /^\d/.test(name) || /total|nominee/i.test(name)) continue
      const age = ageIdx >= 0 ? Number(cells[ageIdx]) || null : null
      const title = posIdx >= 0 ? cleanName(cells[posIdx]) : null
      out.push({ name, title, age })
    }
  })
  const seen = new Set<string>()
  return out.filter(p => { const k = p.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
}

export function latestDef14a(sub: Submissions): { accession: string; date: string; doc: string } | null {
  const r = sub.filings?.recent
  if (!r) return null
  for (let i = 0; i < r.form.length; i++) {
    if (r.form[i] === 'DEF 14A') return { accession: r.accessionNumber[i], date: r.filingDate[i], doc: r.primaryDocument[i] }
  }
  return null
}

export function archiveUrl(cik: string, accession: string, doc: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${doc}`
}

export async function importBatch(db: Db, offset: number, batchSize: number, opts: ImportOptions = {}): Promise<BatchResult> {
  const log = opts.log ?? (() => {})
  const params = opts.params ?? {}
  const result = emptyResult(offset)

  let page: SourcePage<{ submissions: Submissions; proxyHtml?: string | null }>
  if (opts.pageSource) {
    page = (await opts.pageSource(offset, batchSize, params)) as unknown as typeof page
  } else {
    const known = await db.many<{ cik: string }>(`select identifiers ->> 'sec_cik' cik from entity where kind = 'org' and identifiers ? 'sec_cik'`)
    const ciks = [...new Set([...(params.ciks ? params.ciks.split(',') : DEFAULT_CIKS), ...known.map(k => k.cik.padStart(10, '0'))])].sort()
    const slice = ciks.slice(offset, offset + batchSize)
    const records: Array<{ submissions: Submissions; proxyHtml?: string | null }> = []
    for (const cik of slice) {
      try {
        const sub = await fetchJson<Submissions>(SUBMISSIONS(cik), { headers: UA })
        const def = latestDef14a(sub)
        let proxyHtml: string | null = null
        if (def && params.skipProxy !== '1') {
          try { proxyHtml = await fetchText(archiveUrl(sub.cik, def.accession, def.doc), { headers: UA }) } catch (e) { log(`proxy ${cik}: ${(e as Error).message}`) }
        }
        records.push({ submissions: sub, proxyHtml })
      } catch (e) { result.errors++; log(`cik ${cik}: ${(e as Error).message}`) }
    }
    page = { records, done: offset + slice.length >= ciks.length }
  }

  for (const rec of page.records) {
    const sub = rec.submissions
    const cik = String(sub.cik).padStart(10, '0')
    const name = cleanName(sub.name)
    if (!name) { result.seen++; continue }
    const def = latestDef14a(sub)
    try {
      await processRecord(db, {
        document: {
          source: SOURCE_KEY, source_record_id: def ? `${cik}:${def.accession}` : `${cik}:submissions`, doc_type: 'sec_filing',
          title: def ? `${name} — DEF 14A ${def.date}` : `${name} — EDGAR submissions`, doc_date: def ? toIsoDate(def.date) : null,
          url: def ? archiveUrl(sub.cik, def.accession, def.doc) : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}`,
          raw: { submissions: { cik: sub.cik, name: sub.name, tickers: sub.tickers, sicDescription: sub.sicDescription, stateOfIncorporation: sub.stateOfIncorporation, addresses: sub.addresses, latest_def14a: def } },
          body_text: rec.proxyHtml ? load(rec.proxyHtml).text().replace(/\s+/g, ' ').slice(0, 200_000) : null,
        },
        edges: async ({ db: d, created }) => {
          const org = await resolveRef(d, { kind: 'org', rawName: name, identifiers: { sec_cik: cik }, attributes: { org_type: 'corporation', sector: sub.sicDescription ?? undefined, tickers: sub.tickers } })
          if (org.created) created()
          const edges: EdgeInput[] = []
          if (rec.proxyHtml) {
            for (const p of parseDef14aPeople(rec.proxyHtml)) {
              const person = await resolveRef(d, { kind: 'person', rawName: p.name, canonicalName: canonicalPersonName(p.name) })
              edges.push({
                type: /director|chair/i.test(p.title ?? '') || !p.title ? 'director_of' : 'officer_of', from: person, to: org, role: p.title,
                start_date: def ? toIsoDate(def.date) : null, attributes: { is_current: true, age: p.age, source_description: 'SEC DEF 14A proxy statement' },
              })
            }
          }
          return edges
        },
      }, result)
    } catch (e) { result.errors++; log(`cik ${cik}: ${(e as Error).message}`) }
  }
  result.nextOffset = offset + page.records.length
  result.done = page.done ?? page.records.length < batchSize
  return result
}
