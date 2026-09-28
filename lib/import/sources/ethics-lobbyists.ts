/**
 * State Ethics Commission — lobbyist registration statements (CKAN resource on opendata.hawaii.gov)
 * and lobbyist expenditure statements (discovered by package_search).
 *
 * Registration record shape (observed): { _id, "Full Name", "Organization", "Lobby Year", "Registration Date",
 *   "Termination Date", "Amended", "Original", "View" (PDF url) }.
 */
import type { Db } from '@/lib/db/types'
import { CkanClient, HAWAII_OPEN_DATA } from '../clients/ckan'
import { processRecord, emptyResult, resolveRef, type BatchResult, type EdgeInput } from '../pipeline'
import { toIsoDate, toAmount, cleanName, canonicalPersonName, periodRange } from '../normalize'
import type { ImportOptions, SourcePage } from '../types'

export const SOURCE_KEY = 'ethics_lobbyists'
export const REGISTRATION_RESOURCE = 'aed69d13-fe07-4e91-8abf-a51c8a408e1f'

const str = (r: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) { const v = r[k]; if (v != null && String(v).trim() !== '') return String(v).trim() }
  return null
}

export interface RegistrationParsed {
  recordId: string
  lobbyist: string
  client: string | null
  lobbyYear: string | null
  registrationDate: string | null
  terminationDate: string | null
  url: string | null
  amended: boolean
}

export function parseRegistration(r: Record<string, unknown>): RegistrationParsed | null {
  const id = str(r, '_id')
  const lobbyist = cleanName(str(r, 'Full Name', 'Lobbyist Name', 'Lobbyist', 'lobbyist_name'))
  if (!id || !lobbyist) return null
  return {
    recordId: id, lobbyist, client: cleanName(str(r, 'Organization', 'Client', 'Client Name', 'client_name')),
    lobbyYear: str(r, 'Lobby Year', 'Period', 'Registration Period'),
    registrationDate: toIsoDate(str(r, 'Registration Date')), terminationDate: toIsoDate(str(r, 'Termination Date')),
    url: str(r, 'View', 'URL'), amended: /^true$/i.test(str(r, 'Amended') ?? ''),
  }
}

export interface ExpenditureParsed {
  recordId: string
  filer: string
  filerIsOrg: boolean
  period: string | null
  category: string | null
  amount: number | null
  payee: string | null
  url: string | null
}

export function parseExpenditure(r: Record<string, unknown>): ExpenditureParsed | null {
  const id = str(r, '_id')
  const filer = cleanName(str(r, 'Full Name', 'Organization', 'Lobbyist Name', 'Filer'))
  if (!id || !filer) return null
  const org = str(r, 'Organization')
  const person = str(r, 'Full Name', 'Lobbyist Name')
  return {
    recordId: id, filer: (person ?? org)!, filerIsOrg: !person && !!org,
    period: str(r, 'Reporting Period', 'Period', 'Lobby Year'),
    category: str(r, 'Expenditure Category', 'Category', 'Type'),
    amount: toAmount(r['Amount'] ?? r['Total Expenditures'] ?? r['Total']),
    payee: cleanName(str(r, 'Payee', 'Vendor', 'Recipient')),
    url: str(r, 'View', 'URL'),
  }
}

async function findExpenditureResource(ckan: CkanClient, log: (m: string) => void): Promise<string | null> {
  try {
    for (const pkg of await ckan.packageSearch('lobbyist expenditure statements', 20)) {
      if (!/lobby/i.test(pkg.title)) continue
      for (const res of pkg.resources) if (res.datastore_active && /expend/i.test(`${pkg.title} ${res.name}`)) return res.id
    }
  } catch (e) { log(`expenditure resource discovery failed: ${(e as Error).message}`) }
  return null
}

export async function importBatch(db: Db, offset: number, batchSize: number, opts: ImportOptions = {}): Promise<BatchResult> {
  const log = opts.log ?? (() => {})
  const params = opts.params ?? {}
  const dataset = (params.dataset as 'registrations' | 'expenditures' | undefined) ?? 'registrations'
  const result = emptyResult(offset)

  let page: SourcePage
  let resourceId: string | undefined = params.resource
  if (opts.pageSource) {
    page = await opts.pageSource(offset, batchSize, params)
  } else {
    const ckan = new CkanClient(HAWAII_OPEN_DATA)
    if (!resourceId) resourceId = dataset === 'registrations' ? REGISTRATION_RESOURCE : ((await findExpenditureResource(ckan, log)) ?? undefined)
    if (!resourceId) return { ...result, done: true }
    const r = await ckan.datastoreSearch(resourceId, { limit: batchSize, offset, sort: '_id asc' })
    page = { records: r.records, total: r.total }
  }
  const url: string | null = resourceId ? `${HAWAII_OPEN_DATA}/dataset/${resourceId}` : null

  for (const raw of page.records) {
    if (dataset === 'registrations') {
      const p = parseRegistration(raw)
      if (!p) { result.seen++; continue }
      const range = periodRange(p.lobbyYear)
      try {
        await processRecord(db, {
          document: {
            source: SOURCE_KEY, source_record_id: `registration:${p.recordId}`, doc_type: 'lobbyist_registration',
            title: `${canonicalPersonName(p.lobbyist)} for ${p.client ?? 'client'} (${p.lobbyYear ?? ''})`.trim(),
            doc_date: p.registrationDate ?? range.start, url: p.url ?? url, raw,
          },
          edges: async ({ db: d, created }) => {
            // Registered lobbyists are authoritative persons from the Commission → create when new.
            const from = await resolveRef(d, { kind: 'person', rawName: p.lobbyist, canonicalName: canonicalPersonName(p.lobbyist), createIfMissing: true, attributes: { entity_types: ['person', 'lobbyist'] } })
            if (from.created) created()
            // A registration without a client names no relationship; the document alone records it.
            if (!p.client) return []
            const to = await resolveRef(d, { kind: 'org', rawName: p.client })
            const edges: EdgeInput[] = [{
              type: 'lobbied_for', from, to, role: 'lobbyist',
              start_date: p.registrationDate ?? range.start, end_date: p.terminationDate ?? range.end,
              attributes: { lobby_year: p.lobbyYear, amended: p.amended },
            }]
            return edges
          },
        }, result)
      } catch (e) { result.errors++; log(`registration ${p.recordId}: ${(e as Error).message}`) }
    } else {
      const p = parseExpenditure(raw)
      if (!p) { result.seen++; continue }
      const range = periodRange(p.period)
      try {
        await processRecord(db, {
          document: {
            source: SOURCE_KEY, source_record_id: `expenditure:${p.recordId}`, doc_type: 'lobbyist_expenditure',
            title: `${p.filer} lobbying expenditure ${p.period ?? ''}`.trim(), doc_date: range.start, url: p.url ?? url, raw,
          },
          edges: async ({ db: d }) => {
            const from = p.filerIsOrg
              ? await resolveRef(d, { kind: 'org', rawName: p.filer })
              : await resolveRef(d, { kind: 'person', rawName: p.filer, canonicalName: canonicalPersonName(p.filer) })
            const to = p.payee ? await resolveRef(d, { kind: 'org', rawName: p.payee }) : { entityId: null, rawName: `Lobbying (${p.category ?? 'expenditure'})` }
            return [{ type: 'spent_with', from, to, role: p.category, amount: p.amount, start_date: range.start, end_date: range.end, attributes: { period: p.period } }]
          },
        }, result)
      } catch (e) { result.errors++; log(`expenditure ${p.recordId}: ${(e as Error).message}`) }
    }
  }
  result.nextOffset = offset + page.records.length
  result.done = page.done ?? (page.records.length < batchSize || (page.total != null && result.nextOffset >= page.total))
  return result
}
