/**
 * USAspending — contracts and grants with Hawaiʻi place of performance (spending_by_award search API).
 * Awarding agency and recipient become org entities (recipient keyed by UEI when present).
 */
import type { Db } from '@/lib/db/types'
import { httpFetch, HttpError } from '../http'
import { processRecord, emptyResult, resolveRef, type BatchResult } from '../pipeline'
import { toIsoDate, toAmount, cleanName } from '../normalize'
import type { ImportOptions, SourcePage } from '../types'

export const SOURCE_KEY = 'usaspending'
const API = 'https://api.usaspending.gov/api/v2/search/spending_by_award/'
const CONTRACT_CODES = ['A', 'B', 'C', 'D']
const GRANT_CODES = ['02', '03', '04', '05']

export interface UsaSpendingRow {
  'Award ID': string
  'Recipient Name': string | null
  'Award Amount': number | null
  'Awarding Agency': string | null
  'Awarding Sub Agency'?: string | null
  Description?: string | null
  'Start Date'?: string | null
  'End Date'?: string | null
  'Award Type'?: string | null
  recipient_id?: string | null
  'Recipient UEI'?: string | null
  generated_internal_id?: string
  internal_id?: number
}

export interface UsaParsed {
  recordId: string
  vendor: string
  uei: string | null
  agency: string
  amount: number | null
  start: string | null
  end: string | null
  isGrant: boolean
  description: string | null
  awardType: string | null
}

export function parseAward(r: UsaSpendingRow, family: 'contract' | 'grant'): UsaParsed | null {
  const id = r.generated_internal_id ?? r['Award ID']
  const vendor = cleanName(r['Recipient Name'])
  const agency = cleanName(r['Awarding Agency'])
  if (!id || !vendor || !agency) return null
  return {
    recordId: String(id), vendor, uei: r['Recipient UEI'] ?? null, agency, amount: toAmount(r['Award Amount']),
    start: toIsoDate(r['Start Date']), end: toIsoDate(r['End Date']), isGrant: family === 'grant' || /grant/i.test(r['Award Type'] ?? ''),
    description: r.Description ?? null, awardType: r['Award Type'] ?? null,
  }
}

export async function importBatch(db: Db, offset: number, batchSize: number, opts: ImportOptions = {}): Promise<BatchResult> {
  const log = opts.log ?? (() => {})
  const params = opts.params ?? {}
  const family = (params.family as 'contract' | 'grant' | undefined) ?? 'contract'
  const result = emptyResult(offset)
  const limit = Math.min(100, batchSize)
  const pageNo = Math.floor(offset / limit) + 1

  let page: SourcePage<UsaSpendingRow>
  if (opts.pageSource) {
    page = (await opts.pageSource(offset, batchSize, params)) as unknown as SourcePage<UsaSpendingRow>
  } else {
    const body = {
      filters: {
        award_type_codes: family === 'grant' ? GRANT_CODES : CONTRACT_CODES,
        place_of_performance_locations: [{ country: 'USA', state: 'HI' }],
        time_period: [{ start_date: params.start_date ?? '2020-01-01', end_date: new Date().toISOString().slice(0, 10) }],
      },
      fields: ['Award ID', 'Recipient Name', 'Recipient UEI', 'Award Amount', 'Awarding Agency', 'Awarding Sub Agency', 'Description', 'Start Date', 'End Date', 'Award Type', 'recipient_id'],
      page: pageNo, limit, sort: 'Award Amount', order: 'desc',
    }
    const res = await httpFetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) throw new HttpError(res.status, API, `usaspending ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const json = await res.json<{ results: UsaSpendingRow[]; page_metadata?: { hasNext?: boolean } }>()
    page = { records: json.results ?? [], done: json.page_metadata?.hasNext === false }
  }

  for (const raw of page.records) {
    const p = parseAward(raw, family)
    if (!p) { result.seen++; continue }
    try {
      await processRecord(db, {
        document: {
          source: SOURCE_KEY, source_record_id: p.recordId, doc_type: p.isGrant ? 'grant' : 'contract',
          title: `${p.agency} → ${p.vendor}`, doc_date: p.start, raw: raw as unknown as Record<string, unknown>,
          url: `https://www.usaspending.gov/award/${encodeURIComponent(p.recordId)}`,
        },
        edges: async ({ db: d, created }) => {
          // Federal agencies are authoritative names → create org when missing.
          const from = await resolveRef(d, { kind: 'org', rawName: p.agency, createIfMissing: true, attributes: { org_type: 'government_agency', jurisdiction: 'federal' } })
          const to = await resolveRef(d, { kind: 'org', rawName: p.vendor, identifiers: p.uei ? { uei: p.uei } : undefined })
          if (from.created) created()
          if (to.created) created()
          return [{
            type: p.isGrant ? 'awarded_grant' as const : 'awarded_contract' as const, from, to, role: p.awardType, amount: p.amount, start_date: p.start, end_date: p.end,
            attributes: { awarding_agency: p.agency, description: p.description, solicitation_id: raw['Award ID'], program: p.isGrant ? p.description : undefined },
          }]
        },
      }, result)
    } catch (e) { result.errors++; log(`award ${p.recordId}: ${(e as Error).message}`) }
  }
  result.nextOffset = offset + page.records.length
  result.done = page.done ?? page.records.length < limit
  return result
}
