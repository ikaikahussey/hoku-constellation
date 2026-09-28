/**
 * Public Utilities Commission — Document Management System (dms.puc.hawaii.gov).
 *
 * The DMS is a public ASP.NET site: docket search (`/dms/DocketSearch`) returns an HTML table of
 * dockets (number, title/description, filing date, status, utility/applicant); a docket page lists
 * parties and filings. No API, no login. The legacy importer inserted a hard-coded list; this one
 * fetches the docket search for the configured year range and parses tables.
 *
 * Dockets are authoritative entities (kind='docket', identifiers.docket_number). Applicants and
 * intervenors become `party_to` edges (role = applicant | intervenor | participant).
 */
import type { Db } from '@/lib/db/types'
import { fetchText } from '../http'
import { processRecord, emptyResult, resolveRef, type BatchResult, type EdgeInput } from '../pipeline'
import { cleanName, toIsoDate, looksLikeOrg, canonicalPersonName } from '../normalize'
import type { ImportOptions, SourcePage } from '../types'
import { load } from 'cheerio'

export const SOURCE_KEY = 'puc'
export const BASE = 'https://dms.puc.hawaii.gov/dms'

export interface Docket {
  docketNumber: string
  title: string | null
  filingDate: string | null
  status: string | null
  docketType: string | null
  applicant: string | null
  parties: Array<{ name: string; role: string }>
  url: string
}

export function parseDocketTable(html: string): Docket[] {
  const $ = load(html)
  const out: Docket[] = []
  $('table').each((_, table) => {
    const cols = $(table).find('tr').first().find('th,td').toArray().map(c => $(c).text().replace(/\s+/g, ' ').trim().toLowerCase())
    const numIdx = cols.findIndex(c => /docket/.test(c))
    if (numIdx < 0) return
    const idx = (re: RegExp) => cols.findIndex(c => re.test(c))
    const titleIdx = idx(/title|description|subject/), dateIdx = idx(/date|filed|open/), statusIdx = idx(/status/), typeIdx = idx(/type|category/), appIdx = idx(/applicant|utility|company|petitioner/)
    $(table).find('tr').slice(1).each((_, tr) => {
      const cells = $(tr).find('td').toArray().map(td => $(td).text().replace(/\s+/g, ' ').trim())
      const num = cells[numIdx]?.match(/\d{4}-\d{4}/)?.[0]
      if (!num) return
      const href = $(tr).find('a[href]').first().attr('href')
      out.push({
        docketNumber: num, title: titleIdx >= 0 ? cleanName(cells[titleIdx]) : null, filingDate: dateIdx >= 0 ? toIsoDate(cells[dateIdx]) : null,
        status: statusIdx >= 0 ? cleanName(cells[statusIdx]) : null, docketType: typeIdx >= 0 ? cleanName(cells[typeIdx]) : null,
        applicant: appIdx >= 0 ? cleanName(cells[appIdx]) : null, parties: [],
        url: href ? (href.startsWith('http') ? href : `${BASE}/${href.replace(/^\/?dms\//, '').replace(/^\//, '')}`) : docketUrl(num),
      })
    })
  })
  return out
}

/** Parse the parties list from a docket detail page. */
export function parseDocketParties(html: string): Array<{ name: string; role: string }> {
  const $ = load(html)
  const out: Array<{ name: string; role: string }> = []
  $('table').each((_, table) => {
    const cols = $(table).find('tr').first().find('th,td').toArray().map(c => $(c).text().trim().toLowerCase())
    const nameIdx = cols.findIndex(c => /party|name|participant/.test(c))
    if (nameIdx < 0) return
    const roleIdx = cols.findIndex(c => /role|type|status/.test(c))
    $(table).find('tr').slice(1).each((_, tr) => {
      const cells = $(tr).find('td').toArray().map(td => $(td).text().replace(/\s+/g, ' ').trim())
      const name = cleanName(cells[nameIdx])
      if (!name) return
      out.push({ name, role: (roleIdx >= 0 ? cleanName(cells[roleIdx]) : null)?.toLowerCase() ?? 'participant' })
    })
  })
  return out
}

export const docketUrl = (n: string) => `${BASE}/DocketDetails?docketNumber=${n}`
export const searchUrl = (year: string, page: number) => `${BASE}/DocketSearch?year=${year}&page=${page}`

export async function importBatch(db: Db, offset: number, batchSize: number, opts: ImportOptions = {}): Promise<BatchResult> {
  const log = opts.log ?? (() => {})
  const params = opts.params ?? {}
  const result = emptyResult(offset)
  const year = params.year ?? String(new Date().getFullYear())

  let page: SourcePage<Docket>
  if (opts.pageSource) {
    page = (await opts.pageSource(offset, batchSize, params)) as unknown as SourcePage<Docket>
  } else {
    const pageNo = Math.floor(offset / batchSize) + 1
    const dockets = parseDocketTable(await fetchText(searchUrl(year, pageNo))).slice(0, batchSize)
    for (const d of dockets) {
      if (params.parties === '0') break
      try { d.parties = parseDocketParties(await fetchText(d.url)) } catch (e) { log(`${d.docketNumber} parties: ${(e as Error).message}`) }
    }
    page = { records: dockets, done: dockets.length < batchSize }
  }

  for (const d of page.records) {
    try {
      await processRecord(db, {
        document: {
          source: SOURCE_KEY, source_record_id: d.docketNumber, doc_type: 'docket_filing', title: `Docket ${d.docketNumber}${d.title ? ` — ${d.title}` : ''}`,
          doc_date: d.filingDate, url: d.url, raw: d as unknown as Record<string, unknown>,
        },
        edges: async ({ db: dd, created }) => {
          const docket = await resolveRef(dd, { kind: 'docket', rawName: `PUC Docket ${d.docketNumber}`, identifiers: { docket_number: d.docketNumber }, createIfMissing: true,
            attributes: { docket_number: d.docketNumber, title: d.title ?? undefined, status: d.status ?? undefined, docket_type: d.docketType ?? undefined, filing_date: d.filingDate, agency: 'PUC' } })
          if (docket.created) created()
          else await dd.query(`update entity set attributes = attributes || $2::jsonb where id = $1`, [docket.entityId, JSON.stringify({ status: d.status, title: d.title })])
          const edges: EdgeInput[] = []
          const parties = [...(d.applicant ? [{ name: d.applicant, role: 'applicant' }] : []), ...d.parties]
          const seen = new Set<string>()
          for (const p of parties) {
            const key = p.name.toLowerCase()
            if (seen.has(key)) continue
            seen.add(key)
            // Regulated utilities/applicants are authoritative names → create org; other parties resolve only.
            const from = looksLikeOrg(p.name) || p.role === 'applicant'
              ? await resolveRef(dd, { kind: 'org', rawName: p.name, createIfMissing: p.role === 'applicant', attributes: p.role === 'applicant' ? { org_type: 'utility' } : undefined })
              : await resolveRef(dd, { kind: 'person', rawName: p.name, canonicalName: canonicalPersonName(p.name) })
            if (from.created) created()
            edges.push({ type: 'party_to', from, to: docket, role: p.role, start_date: d.filingDate, attributes: { docket_status: d.status } })
          }
          return edges
        },
      }, result)
    } catch (e) { result.errors++; log(`${d.docketNumber}: ${(e as Error).message}`) }
  }
  result.nextOffset = offset + page.records.length
  result.done = page.done ?? page.records.length < batchSize
  return result
}
