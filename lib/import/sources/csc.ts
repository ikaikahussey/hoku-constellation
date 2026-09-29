/**
 * Campaign Spending Commission (opendata.hawaii.gov CKAN).
 *
 * Datasets: candidate & noncandidate contributions, expenditures, loans. Resource ids are seeded from
 * the four known ids and completed via package_search; each resource is classified by its fields
 * (Contributor Name → contribution, Vendor/Payee Name → expenditure, Lender Name → loan).
 *
 * Cursor: one row per resource, `csc:<resource_id>`; the aggregate `csc` cursor tracks the sweep.
 * Idempotent: document checksum = sha256 of the CKAN record; edges dedup on (document, type, names, role).
 */
import type { Db } from '@/lib/db/types'
import { CkanClient, HAWAII_OPEN_DATA } from '../clients/ckan'
import { processRecord, emptyResult, resolveRef, type BatchResult, type EdgeInput, type ResolvedRef } from '../pipeline'
import { toIsoDate, toAmount, looksLikeOrg, canonicalPersonName } from '../normalize'
import type { ImportOptions, SourcePage } from '../types'
import type { EdgeType } from '@/lib/schema/attributes'

export const SOURCE_KEY = 'csc'

export const KNOWN_RESOURCES = [
  '443bd998-1ef3-47da-9170-c2c376b2e41c',
  'bc5fae08-b97e-45fc-9c3b-f0883efad371',
  'ca3ac02a-eb44-4b44-b3a7-5f60653cc1d3',
  'f20b548a-83db-46e9-a0de-8bfd777ec89d',
]

export type CscKind = 'contribution' | 'expenditure' | 'loan'

/** Classify a CSC datastore resource by the presence of well-known columns. */
export function classifyFields(fields: string[]): CscKind | null {
  const f = new Set(fields.map(x => x.toLowerCase()))
  if (f.has('lender name') || f.has('loan amount') || [...f].some(x => x.includes('lender'))) return 'loan'
  if (f.has('vendor name') || f.has('payee name') || f.has('expenditure category') || [...f].some(x => x.includes('vendor') || x.includes('payee'))) return 'expenditure'
  if (f.has('contributor name') || f.has('contributor type')) return 'contribution'
  return null
}

const str = (r: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) { const v = r[k]; if (v != null && String(v).trim() !== '') return String(v).trim() }
  return null
}

export interface CscParsed {
  kind: CscKind
  fromName: string
  toName: string
  fromIsOrg: boolean
  toIsOrg: boolean
  amount: number | null
  date: string | null
  role: string | null
  regNo: string | null
  attributes: Record<string, unknown>
  recordId: string
}

/** Pure parser for one CKAN record. Returns null for rows that carry no fact. */
export function parseCscRecord(kind: CscKind, r: Record<string, unknown>): CscParsed | null {
  const id = str(r, '_id')
  if (!id) return null
  const candidate = str(r, 'Candidate Name', 'candidate_name')
  const committee = str(r, 'Noncandidate Committee Name', 'Committee Name', 'committee_name')
  const recipient = candidate ?? committee
  const period = str(r, 'Election Period', 'election_period')
  const regNo = str(r, 'Reg No', 'reg_no')
  const office = str(r, 'Office')
  const base = { election_period: period, office, district: str(r, 'District'), party: str(r, 'Party'), county: str(r, 'County'), source: SOURCE_KEY, reg_no: regNo }

  if (kind === 'contribution') {
    const donor = str(r, 'Contributor Name', 'contributor_name')
    if (!donor || !recipient) return null
    const type = str(r, 'Contributor Type', 'contributor_type')
    return {
      kind, fromName: donor, toName: recipient, fromIsOrg: type ? !/^(individual|candidate|immediate family)/i.test(type) : looksLikeOrg(donor), toIsOrg: !candidate,
      amount: toAmount(r['Amount'] ?? r['amount']), date: toIsoDate(r['Date'] ?? r['date'] ?? r['Receipt Date']), role: type,
      regNo, recordId: id,
      attributes: { ...base, contribution_type: type, non_monetary: /^y/i.test(str(r, 'Non-Monetary (Yes Or No)') ?? 'n'), non_monetary_category: str(r, 'Non-Monetary Category'),
        employer: str(r, 'Employer'), occupation: str(r, 'Occupation'), contributor_city: str(r, 'City'), contributor_state: str(r, 'State'), aggregate: toAmount(r['Aggregate']) },
    }
  }
  if (kind === 'expenditure') {
    const vendor = str(r, 'Vendor Name', 'Payee Name', 'vendor_name', 'payee_name')
    if (!vendor || !recipient) return null
    const category = str(r, 'Expenditure Category', 'Category', 'expenditure_category')
    return {
      kind, fromName: recipient, toName: vendor, fromIsOrg: !candidate, toIsOrg: looksLikeOrg(vendor),
      amount: toAmount(r['Amount'] ?? r['amount']), date: toIsoDate(r['Date'] ?? r['date'] ?? r['Expenditure Date']), role: category,
      regNo, recordId: id,
      attributes: { ...base, purpose: str(r, 'Purpose of Expenditure', 'Purpose'), vendor_type: str(r, 'Vendor Type'), authorized_use: str(r, 'Authorized Use') },
    }
  }
  const lender = str(r, 'Lender Name', 'lender_name')
  if (!lender || !recipient) return null
  return {
    kind, fromName: lender, toName: recipient, fromIsOrg: looksLikeOrg(lender), toIsOrg: !candidate,
    amount: toAmount(r['Amount'] ?? r['Loan Amount'] ?? r['amount']), date: toIsoDate(r['Date'] ?? r['Loan Date'] ?? r['date']), role: str(r, 'Loan Type', 'Lender Type'),
    regNo, recordId: id,
    attributes: { ...base, interest_rate: toAmount(r['Interest Rate']), balance: toAmount(r['Outstanding Balance']) },
  }
}

const EDGE_FOR: Record<CscKind, EdgeType> = { contribution: 'contributed_to', expenditure: 'spent_with', loan: 'loaned_to' }
const DOC_FOR: Record<CscKind, 'contribution' | 'expenditure' | 'loan'> = { contribution: 'contribution', expenditure: 'expenditure', loan: 'loan' }

async function refFor(db: Db, name: string, isOrg: boolean, opts: { candidate?: boolean; regNo?: string | null }): Promise<ResolvedRef> {
  if (opts.candidate) {
    // Candidates are authoritative names from the Commission: create as persons with the CSC registration number.
    return resolveRef(db, { kind: 'person', rawName: name, canonicalName: canonicalPersonName(name), identifiers: opts.regNo ? { csc_reg_no: opts.regNo } : undefined,
      createIfMissing: true, attributes: { entity_types: ['person', 'candidate'] } })
  }
  if (isOrg) {
    const committee = opts.regNo && /^NC/i.test(opts.regNo)
    return resolveRef(db, { kind: 'org', rawName: name, identifiers: committee ? { csc_reg_no: opts.regNo! } : undefined, createIfMissing: !!committee,
      attributes: committee ? { org_type: 'pac' } : undefined })
  }
  return resolveRef(db, { kind: 'person', rawName: name, canonicalName: canonicalPersonName(name) })
}

export function planEdges(kind: CscKind, p: CscParsed, from: ResolvedRef, to: ResolvedRef): EdgeInput[] {
  return [{ type: EDGE_FOR[kind], from, to, role: p.role, amount: p.amount, start_date: p.date, attributes: p.attributes }]
}

interface CscState { resources?: CscResource[]; resourceIndex?: number }

export interface CscResource { id: string; kind: CscKind; name: string }

export async function discoverResources(ckan: CkanClient, log: (m: string) => void): Promise<CscResource[]> {
  const ids = new Set(KNOWN_RESOURCES)
  const names = new Map<string, string>()
  for (const q of ['campaign spending commission', 'campaign contributions received', 'expenditures made candidates', 'loans received candidates', 'noncandidate committee']) {
    try {
      for (const pkg of await ckan.packageSearch(q, 50)) {
        if (!/campaign|candidate|committee/i.test(`${pkg.title} ${pkg.organization?.title ?? ''}`)) continue
        for (const res of pkg.resources) if (res.datastore_active) { ids.add(res.id); names.set(res.id, `${pkg.title} — ${res.name}`) }
      }
    } catch (e) { log(`package_search "${q}" failed: ${(e as Error).message}`) }
  }
  const out: CscResource[] = []
  for (const id of ids) {
    try {
      const page = await ckan.datastoreSearch(id, { limit: 1 })
      const kind = classifyFields(page.fields.map(f => f.id))
      if (kind) out.push({ id, kind, name: names.get(id) ?? id })
      else log(`resource ${id} not classified (fields: ${page.fields.map(f => f.id).join(', ')})`)
    } catch (e) { log(`resource ${id} unreadable: ${(e as Error).message}`) }
  }
  return out
}

/**
 * Write one parsed CSC record: document, then entities, then edges. Shared by the sweep above and the
 * priority-entity pass (lib/import/priority.ts), so both produce identical source_record_ids.
 */
export async function processCscRecord(db: Db, kind: CscKind, resourceId: string | null, parsed: CscParsed, raw: Record<string, unknown>, result: BatchResult, log: (m: string) => void = () => {}): Promise<void> {
  try {
    await processRecord(db, {
      document: {
        source: SOURCE_KEY, source_record_id: `${resourceId ?? kind}:${parsed.recordId}`, doc_type: DOC_FOR[kind],
        title: `${parsed.fromName} → ${parsed.toName}`, doc_date: parsed.date, raw,
        url: resourceId ? `${HAWAII_OPEN_DATA}/dataset/${resourceId}` : null,
      },
      edges: async ({ db: d, created }) => {
        const fromIsCandidate = kind !== 'contribution' && !parsed.fromIsOrg
        const toIsCandidate = kind !== 'expenditure' && !parsed.toIsOrg
        const from = await refFor(d, parsed.fromName, parsed.fromIsOrg, { candidate: fromIsCandidate, regNo: kind !== 'contribution' ? parsed.regNo : null })
        const to = await refFor(d, parsed.toName, parsed.toIsOrg, { candidate: toIsCandidate, regNo: kind !== 'expenditure' ? parsed.regNo : null })
        if (from.created) created()
        if (to.created) created()
        return planEdges(kind, parsed, from, to)
      },
    }, result)
  } catch (e) {
    result.errors++
    log(`record ${parsed.recordId}: ${(e as Error).message}`)
  }
}

/**
 * Import one batch. `offset` is the record offset within the current resource; the resource index is
 * kept in opts.params.resource (or discovered and stored by the caller via metadata).
 */
export async function importBatch(db: Db, offset: number, batchSize: number, opts: ImportOptions = {}): Promise<BatchResult> {
  const log = opts.log ?? (() => {})
  const params = opts.params ?? {}
  const result = emptyResult(offset)
  const kindParam = params.kind as CscKind | undefined

  let page: SourcePage
  let kind: CscKind
  if (opts.pageSource) {
    page = await opts.pageSource(offset, batchSize, params)
    kind = kindParam ?? 'contribution'
  } else {
    const ckan = new CkanClient(HAWAII_OPEN_DATA)
    let resourceId = params.resource
    if (!resourceId) {
      const resources = await discoverResources(ckan, log)
      const state: CscState = { resources }
      const idx = Number(params.resourceIndex ?? 0)
      const chosen = resources[idx]
      if (!chosen) return { ...result, done: true }
      resourceId = chosen.id
      kind = chosen.kind
      params.resource = resourceId
      params.kind = kind
      log(`resource ${idx + 1}/${resources.length}: ${chosen.name} (${kind})`)
      void state
    } else {
      kind = kindParam ?? classifyFields((await ckan.datastoreSearch(resourceId, { limit: 1 })).fields.map(f => f.id)) ?? 'contribution'
    }
    const r = await ckan.datastoreSearch(resourceId, { limit: batchSize, offset, sort: '_id asc' })
    page = { records: r.records, total: r.total }
  }

  for (const raw of page.records) {
    const parsed = parseCscRecord(kind, raw)
    if (!parsed) { result.seen++; continue }
    await processCscRecord(db, kind, params.resource ?? null, parsed, raw, result, log)
  }
  result.nextOffset = offset + page.records.length
  const total = page.total
  result.done = page.done ?? (page.records.length < batchSize || (total != null && result.nextOffset >= total))
  return result
}
