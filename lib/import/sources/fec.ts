/**
 * FEC OpenFEC — Schedule A itemized receipts for Hawaiʻi committees.
 *
 * Coverage: every committee returned by /committees/?state=HI (principal campaign committees, PACs,
 * party committees) plus the delegation's principal committees. Pagination uses OpenFEC keyset
 * cursors (last_index + last_contribution_receipt_date) stored in import_cursor.metadata; `offset`
 * counts records seen for progress only.
 */
import type { Db } from '@/lib/db/types'
import { fetchJson } from '../http'
import { processRecord, emptyResult, resolveRef, getCursor, setCursor, type BatchResult, type EdgeInput } from '../pipeline'
import { toIsoDate, toAmount, cleanName, canonicalPersonName } from '../normalize'
import type { ImportOptions, SourcePage } from '../types'

export const SOURCE_KEY = 'fec'
const BASE = 'https://api.open.fec.gov/v1'
const key = () => process.env.FEC_API_KEY || 'DEMO_KEY'

export interface FecCommittee { committee_id: string; name: string; designation: string | null; committee_type: string | null; candidate_ids?: string[]; party?: string | null }

export interface ScheduleA {
  sub_id: string
  committee_id: string
  contributor_name: string | null
  contributor_first_name?: string | null
  contributor_last_name?: string | null
  contributor_employer?: string | null
  contributor_occupation?: string | null
  contributor_city?: string | null
  contributor_state?: string | null
  contributor_zip?: string | null
  contributor_id?: string | null
  entity_type?: string | null
  contribution_receipt_amount: number | null
  contribution_receipt_date: string | null
  two_year_transaction_period?: number | null
  receipt_type?: string | null
  receipt_type_full?: string | null
  memo_code?: string | null
  memo_text?: string | null
  pdf_url?: string | null
  committee?: { name?: string; candidate_ids?: string[]; designation?: string } | null
}

export async function listHawaiiCommittees(): Promise<FecCommittee[]> {
  const out: FecCommittee[] = []
  for (let page = 1; page <= 20; page++) {
    const json = await fetchJson<{ results: FecCommittee[]; pagination: { pages: number } }>(`${BASE}/committees/?state=HI&per_page=100&page=${page}&api_key=${key()}`)
    out.push(...json.results)
    if (page >= (json.pagination?.pages ?? 1)) break
  }
  return out
}

export interface FecParsed {
  recordId: string
  donor: string
  donorIsOrg: boolean
  donorFecId: string | null
  committeeId: string
  committeeName: string
  candidateIds: string[]
  amount: number | null
  date: string | null
  attributes: Record<string, unknown>
}

export function parseScheduleA(r: ScheduleA): FecParsed | null {
  const donor = cleanName(r.contributor_name)
  if (!r.sub_id || !donor) return null
  const donorIsOrg = !!r.contributor_id || (r.entity_type ? !/^IND|^CAN/i.test(r.entity_type) : false)
  return {
    recordId: String(r.sub_id), donor, donorIsOrg, donorFecId: r.contributor_id ?? null,
    committeeId: r.committee_id, committeeName: r.committee?.name ?? r.committee_id, candidateIds: r.committee?.candidate_ids ?? [],
    amount: toAmount(r.contribution_receipt_amount), date: toIsoDate(r.contribution_receipt_date),
    attributes: {
      source: SOURCE_KEY, election_period: r.two_year_transaction_period ? String(r.two_year_transaction_period) : null,
      contribution_type: r.receipt_type_full ?? r.receipt_type ?? null, entity_type: r.entity_type ?? null, memo: r.memo_code === 'X',
      memo_text: r.memo_text ?? null, employer: r.contributor_employer ?? null, occupation: r.contributor_occupation ?? null,
      contributor_city: r.contributor_city ?? null, contributor_state: r.contributor_state ?? null, pdf_url: r.pdf_url ?? null,
    },
  }
}

interface FecPageState { committeeIndex?: number; last_index?: string | null; last_date?: string | null; committees?: string[] }

export async function importBatch(db: Db, offset: number, batchSize: number, opts: ImportOptions = {}): Promise<BatchResult> {
  const log = opts.log ?? (() => {})
  const params = opts.params ?? {}
  const result = emptyResult(offset)
  const minDate = params.min_date ?? '2022-01-01'

  let page: SourcePage<ScheduleA>
  let state: FecPageState = {}
  if (opts.pageSource) {
    page = (await opts.pageSource(offset, batchSize, params)) as unknown as SourcePage<ScheduleA>
  } else {
    const cursor = await getCursor(db, SOURCE_KEY)
    state = (cursor.metadata.fec as FecPageState | undefined) ?? {}
    if (!state.committees?.length) {
      state.committees = params.committees ? params.committees.split(',') : (await listHawaiiCommittees()).map(c => c.committee_id)
      state.committeeIndex = 0
      log(`${state.committees.length} Hawaiʻi committees`)
    }
    const committeeId = state.committees[state.committeeIndex ?? 0]
    if (!committeeId) return { ...result, done: true }
    let url = `${BASE}/schedules/schedule_a/?committee_id=${committeeId}&sort=-contribution_receipt_date&per_page=${Math.min(100, batchSize)}&min_date=${minDate}&api_key=${key()}`
    if (state.last_index && state.last_date) url += `&last_index=${state.last_index}&last_contribution_receipt_date=${state.last_date}`
    const json = await fetchJson<{ results: ScheduleA[]; pagination: { count: number; last_indexes?: { last_index?: string; last_contribution_receipt_date?: string } | null } }>(url)
    const li = json.pagination?.last_indexes
    const exhausted = !li?.last_index || json.results.length < Math.min(100, batchSize)
    page = { records: json.results, next: exhausted ? { committeeIndex: (state.committeeIndex ?? 0) + 1, last_index: null, last_date: null } : { committeeIndex: state.committeeIndex ?? 0, last_index: li.last_index, last_date: li.last_contribution_receipt_date },
      done: exhausted && (state.committeeIndex ?? 0) + 1 >= state.committees.length }
  }

  for (const raw of page.records) {
    const p = parseScheduleA(raw)
    if (!p) { result.seen++; continue }
    try {
      await processRecord(db, {
        document: {
          source: SOURCE_KEY, source_record_id: `schedule_a:${p.recordId}`, doc_type: 'contribution',
          title: `${p.donor} → ${p.committeeName}`, doc_date: p.date, url: (p.attributes.pdf_url as string) ?? null, raw: raw as unknown as Record<string, unknown>,
        },
        edges: async ({ db: d, created }) => {
          const from = p.donorIsOrg
            ? await resolveRef(d, { kind: 'org', rawName: p.donor, identifiers: p.donorFecId ? { fec_id: p.donorFecId } : undefined, attributes: { org_type: 'pac' } })
            : await resolveRef(d, { kind: 'person', rawName: p.donor, canonicalName: canonicalPersonName(p.donor) })
          // Recipient committee: authoritative FEC entity → create with fec_id.
          const to = await resolveRef(d, { kind: 'org', rawName: p.committeeName, identifiers: { fec_id: p.committeeId }, attributes: { org_type: 'pac', candidate_ids: p.candidateIds } })
          if (from.created) created()
          if (to.created) created()
          const edges: EdgeInput[] = [{ type: 'contributed_to', from, to, role: (p.attributes.contribution_type as string) ?? null, amount: p.amount, start_date: p.date, attributes: p.attributes }]
          return edges
        },
      }, result)
    } catch (e) { result.errors++; log(`sub_id ${p.recordId}: ${(e as Error).message}`) }
  }

  result.nextOffset = offset + page.records.length
  result.done = page.done ?? page.records.length < batchSize
  if (!opts.pageSource && !opts.dry && page.next) {
    await setCursor(db, SOURCE_KEY, result.nextOffset, result.done ? 'complete' : 'running', { fec: { ...state, ...page.next } })
  }
  return result
}
