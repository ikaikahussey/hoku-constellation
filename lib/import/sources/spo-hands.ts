/**
 * State Procurement Office — HANDS (Hawaiʻi Awards & Notices Data System) at hands.ehawaii.gov.
 *
 * Public listings (no login): awards (`/hands/awards`), exemptions (`/hands/exemptions`), sole-source
 * notices (`/hands/sole-source`), and the debarment list (`/hands/debarred`). Each listing paginates
 * (`?page=N&size=100`) and links a detail page. HTML tables are parsed; PDF attachments are recorded by
 * URL, not downloaded.
 *
 * Awarding agencies are authoritative (org, org_type='government_agency'); vendors resolve by fuzzy
 * match and are otherwise left as raw names for review.
 */
import type { Db } from '@/lib/db/types'
import { fetchText } from '../http'
import { processRecord, emptyResult, resolveRef, type BatchResult, type EdgeInput } from '../pipeline'
import { cleanName, toIsoDate, toAmount } from '../normalize'
import type { ImportOptions, SourcePage } from '../types'
import type { DocType } from '@/lib/schema/attributes'
import { load } from 'cheerio'

export const SOURCE_KEY = 'spo_hands'
export const BASE = 'https://hands.ehawaii.gov/hands'

export type HandsList = 'awards' | 'exemptions' | 'sole-source' | 'debarred'
export const LISTS: HandsList[] = ['awards', 'exemptions', 'sole-source', 'debarred']

export interface HandsRow {
  list: HandsList
  id: string
  title: string | null
  agency: string | null
  vendor: string | null
  amount: number | null
  date: string | null
  endDate: string | null
  status: string | null
  url: string | null
  extra: Record<string, string>
}

const headerIndex = (cols: string[], re: RegExp) => cols.findIndex(c => re.test(c))

/** Parse a HANDS listing table page. Columns vary per list; matched by header text. */
export function parseListing(html: string, list: HandsList): { rows: HandsRow[]; hasNext: boolean } {
  const $ = load(html)
  const rows: HandsRow[] = []
  $('table').each((_, table) => {
    const cols = $(table).find('thead th, tr:first-child th, tr:first-child td').toArray().map(c => $(c).text().replace(/\s+/g, ' ').trim().toLowerCase())
    if (cols.length < 2) return
    const idIdx = headerIndex(cols, /^(id|#|number|no\.?|solicitation|reference|award\s*#?|notice)/)
    const titleIdx = headerIndex(cols, /title|description|item|subject|good|service/)
    const agencyIdx = headerIndex(cols, /department|agency|jurisdiction|division/)
    const vendorIdx = headerIndex(cols, /vendor|contractor|awardee|company|business|name|offeror/)
    const amountIdx = headerIndex(cols, /amount|value|price|total/)
    const dateIdx = headerIndex(cols, /date|posted|issued|effective|start/)
    const endIdx = headerIndex(cols, /\bend\b|expir|through|\bterm\b/)
    const statusIdx = headerIndex(cols, /status|type|reason/)
    $(table).find('tbody tr, tr').slice(cols.length ? 1 : 0).each((_, tr) => {
      const tds = $(tr).find('td')
      if (!tds.length) return
      const cells = tds.toArray().map(td => $(td).text().replace(/\s+/g, ' ').trim())
      const link = $(tr).find('a[href]').first().attr('href') ?? null
      const url = link ? (link.startsWith('http') ? link : `https://hands.ehawaii.gov${link.startsWith('/') ? '' : '/'}${link}`) : null
      const idFromUrl = url?.match(/\/(\d{3,})(?:[/?#]|$)/)?.[1] ?? url?.match(/[?&]id=([^&]+)/)?.[1]
      const id = (idIdx >= 0 ? cells[idIdx] : null) || idFromUrl || null
      if (!id) return
      const extra: Record<string, string> = {}
      cols.forEach((c, i) => { if (c && cells[i]) extra[c] = cells[i] })
      rows.push({
        list, id, title: titleIdx >= 0 ? cleanName(cells[titleIdx]) : null, agency: agencyIdx >= 0 ? cleanName(cells[agencyIdx]) : null,
        vendor: vendorIdx >= 0 && vendorIdx !== agencyIdx ? cleanName(cells[vendorIdx]) : null, amount: amountIdx >= 0 ? toAmount(cells[amountIdx]) : null,
        date: dateIdx >= 0 ? toIsoDate(cells[dateIdx]) : null, endDate: endIdx >= 0 && endIdx !== dateIdx ? toIsoDate(cells[endIdx]) : null,
        status: statusIdx >= 0 ? cleanName(cells[statusIdx]) : null, url, extra,
      })
    })
  })
  const hasNext = $('a[rel="next"], a:contains("Next"), li.next a, a[aria-label="Next"]').length > 0
  return { rows, hasNext }
}

export const docTypeFor = (list: HandsList): DocType => list === 'debarred' ? 'debarment' : list === 'sole-source' ? 'sole_source_notice' : 'contract'

export async function importBatch(db: Db, offset: number, batchSize: number, opts: ImportOptions = {}): Promise<BatchResult> {
  const log = opts.log ?? (() => {})
  const params = opts.params ?? {}
  const list = (params.list as HandsList | undefined) ?? 'awards'
  const result = emptyResult(offset)
  const size = Math.min(100, batchSize)
  const pageNo = Math.floor(offset / size) + 1

  let page: SourcePage<HandsRow>
  if (opts.pageSource) {
    page = (await opts.pageSource(offset, batchSize, params)) as unknown as SourcePage<HandsRow>
  } else {
    const url = `${BASE}/${list}?page=${pageNo}&size=${size}`
    const { rows, hasNext } = parseListing(await fetchText(url), list)
    page = { records: rows, done: !hasNext }
  }

  for (const r of page.records) {
    const isDebar = r.list === 'debarred'
    const subject = r.vendor ?? r.title
    if (!subject) { result.seen++; continue }
    try {
      await processRecord(db, {
        document: {
          source: SOURCE_KEY, source_record_id: `${r.list}:${r.id}`, doc_type: docTypeFor(r.list),
          title: isDebar ? `Debarment — ${subject}` : `${r.agency ?? 'State of Hawaiʻi'} → ${subject}${r.title ? ` — ${r.title}` : ''}`,
          doc_date: r.date, url: r.url ?? `${BASE}/${r.list}`, raw: r as unknown as Record<string, unknown>,
        },
        edges: async ({ db: d, created }) => {
          const agency = await resolveRef(d, { kind: 'org', rawName: r.agency ?? 'State Procurement Office', createIfMissing: true, attributes: { org_type: 'government_agency', jurisdiction: 'state' } })
          if (agency.created) created()
          const vendor = await resolveRef(d, { kind: 'org', rawName: subject })
          const edges: EdgeInput[] = []
          if (isDebar) {
            edges.push({ type: 'sanctioned_by', from: vendor, to: agency, role: 'debarment', start_date: r.date, end_date: r.endDate, attributes: { reason: r.status, ...r.extra } })
          } else {
            edges.push({ type: 'awarded_contract', from: agency, to: vendor, role: r.list === 'sole-source' ? 'sole_source' : r.list === 'exemptions' ? 'exemption' : (r.status ?? 'award'), amount: r.amount, start_date: r.date, end_date: r.endDate,
              attributes: { awarding_agency: r.agency, description: r.title, solicitation_id: r.id, method: r.list } })
          }
          return edges
        },
      }, result)
    } catch (e) { result.errors++; log(`${r.list}/${r.id}: ${(e as Error).message}`) }
  }
  result.nextOffset = offset + page.records.length
  result.done = page.done ?? page.records.length < size
  return result
}
