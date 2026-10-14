/**
 * Campaign Spending Commission — contributions, expenditures, loans (hicscdata.hawaii.gov, Socrata).
 *
 * The Commission publishes its datasets on its own Socrata site. opendata.hawaii.gov mirrors them in CKAN,
 * but that portal's robots.txt disallows /api/ and /datastore/, so the CKAN API is not used.
 *
 * Discovery: the Socrata catalog API (/api/catalog/v1) lists every dataset with its column display names
 * and API field names. Each dataset is classified by its display names (Contributor Name → contribution,
 * Vendor/Payee Name → expenditure, Lender Name → loan); rows are read from SODA (/resource/<id>.json,
 * ordered by the row id `:id`) and re-keyed to display names, so one parser serves every dataset.
 * The classified list with row counts is cached for a day in import_cursor.metadata.csc_datasets.
 *
 * Cursor: one offset across all datasets in list order. Idempotent: document checksum = sha256 of the
 * row; source_record_id = '<dataset id>:<row :id>'; edges dedup on (document, type, names, role).
 */
import type { Db } from '@/lib/db/types'
import { fetchJson } from '../http'
import { SocrataClient } from '../clients/socrata'
import { processRecord, emptyResult, resolveRef, type BatchResult, type EdgeInput, type ResolvedRef } from '../pipeline'
import { toIsoDate, toAmount, looksLikeOrg, canonicalPersonName } from '../normalize'
import type { ImportOptions, SourcePage } from '../types'
import type { EdgeType } from '@/lib/schema/attributes'

export const SOURCE_KEY = 'csc'

export const CSC_DOMAIN = 'hicscdata.hawaii.gov'
export const CSC_BASE = `https://${CSC_DOMAIN}`

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

export interface CscResource {
  id: string
  kind: CscKind
  name: string
  /** API field name → display name (SODA rows are keyed by field name; the parser reads display names). */
  fields?: Record<string, string>
  /** Row count when the list was built (sizes the cross-dataset cursor). */
  rows?: number
}

export interface SocrataCatalogResult {
  resource: { id: string; name: string; type: string; columns_name?: string[]; columns_field_name?: string[] }
}

export const catalogUrl = (offset = 0) => `${CSC_BASE}/api/catalog/v1?domains=${CSC_DOMAIN}&only=dataset&limit=100&offset=${offset}`

/** Classify catalog entries; keep the field-name → display-name map for re-keying rows. */
export function datasetsFromCatalog(results: SocrataCatalogResult[]): CscResource[] {
  const out: CscResource[] = []
  for (const { resource: r } of results) {
    if (r.type !== 'dataset') continue
    const names = r.columns_name ?? []
    const fieldNames = r.columns_field_name ?? []
    const kind = classifyFields(names)
    if (!kind) continue
    const fields: Record<string, string> = {}
    fieldNames.forEach((f, i) => { if (names[i]) fields[f] = names[i] })
    out.push({ id: r.id, kind, name: r.name, fields })
  }
  return out.sort((x, y) => x.id.localeCompare(y.id))
}

/** A SODA row keyed by display names, with the Socrata row id as `_id`. */
export function rekeyRow(row: Record<string, unknown>, fields: Record<string, string> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (k === ':id') out._id = v
    else if (!k.startsWith(':')) out[fields?.[k] ?? k] = v
  }
  return out
}

export async function discoverResources(log: (m: string) => void, opts: { withCounts?: boolean } = {}): Promise<CscResource[]> {
  const results: SocrataCatalogResult[] = []
  for (let offset = 0; ; offset += 100) {
    const page = await fetchJson<{ results: SocrataCatalogResult[]; resultSetSize?: number }>(catalogUrl(offset))
    results.push(...page.results)
    if (page.results.length < 100) break
  }
  const datasets = datasetsFromCatalog(results)
  if (!datasets.length) throw new Error(`no classifiable CSC datasets in the ${CSC_DOMAIN} catalog (${results.length} entries)`)
  if (opts.withCounts) {
    const soda = new SocrataClient(CSC_DOMAIN)
    for (const d of datasets) {
      try { d.rows = await soda.count(d.id) } catch (e) { log(`count ${d.id} failed: ${(e as Error).message}`); d.rows = 0 }
    }
  }
  return datasets
}

const LIST_TTL_MS = 24 * 60 * 60_000

/** The classified dataset list with row counts, cached in import_cursor.metadata.csc_datasets for a day. */
export async function cachedResources(db: Db, log: (m: string) => void): Promise<CscResource[]> {
  const row = await db.one<{ list: { at: string; datasets: CscResource[] } | null }>(`select metadata->'csc_datasets' list from import_cursor where source = $1`, [SOURCE_KEY])
  const c = row?.list
  if (c && Array.isArray(c.datasets) && c.datasets.length && Date.now() - new Date(c.at).getTime() < LIST_TTL_MS) return c.datasets
  const datasets = await discoverResources(log, { withCounts: true })
  await db.query(
    `insert into import_cursor(source, metadata) values ($1, jsonb_build_object('csc_datasets', $2::jsonb))
     on conflict (source) do update set metadata = coalesce(import_cursor.metadata, '{}'::jsonb) || jsonb_build_object('csc_datasets', $2::jsonb)`,
    [SOURCE_KEY, JSON.stringify({ at: new Date().toISOString(), datasets })])
  return datasets
}

/** Map a cross-dataset offset to (dataset index, offset within it). */
export function locate(datasets: CscResource[], offset: number): { index: number; local: number } | null {
  let base = 0
  for (let i = 0; i < datasets.length; i++) {
    const n = datasets[i].rows ?? 0
    if (offset < base + n) return { index: i, local: offset - base }
    base += n
  }
  return null
}

export const datasetUrl = (id: string) => `${CSC_BASE}/d/${id}`

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
        url: resourceId ? datasetUrl(resourceId) : null,
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
 * Import one batch. `offset` runs across all datasets in list order; a batch never spans two datasets.
 * `--resource=<id> --kind=<kind>` reads one dataset only (offset is then local to it).
 */
export async function importBatch(db: Db, offset: number, batchSize: number, opts: ImportOptions = {}): Promise<BatchResult> {
  const log = opts.log ?? (() => {})
  const params = opts.params ?? {}
  const result = emptyResult(offset)

  let page: SourcePage
  let kind: CscKind
  let resourceId: string | null = params.resource ?? null
  let datasetEnd: number | null = null
  if (opts.pageSource) {
    page = await opts.pageSource(offset, batchSize, params)
    kind = (params.kind as CscKind | undefined) ?? 'contribution'
  } else {
    const soda = new SocrataClient(CSC_DOMAIN)
    let dataset: CscResource
    let local = offset
    let total: number
    if (resourceId) {
      dataset = (await cachedResources(db, log)).find(d => d.id === resourceId) ?? { id: resourceId, kind: (params.kind as CscKind | undefined) ?? 'contribution', name: resourceId }
      total = dataset.rows ?? Infinity
    } else {
      const datasets = await cachedResources(db, log)
      total = datasets.reduce((n, d) => n + (d.rows ?? 0), 0)
      const at = locate(datasets, offset)
      if (!at) return { ...result, done: true }
      dataset = datasets[at.index]
      local = at.local
      log(`dataset ${at.index + 1}/${datasets.length}: ${dataset.name} (${dataset.kind}) row ${local}`)
    }
    resourceId = dataset.id
    kind = dataset.kind
    const take = Math.min(batchSize, Math.max(1, (dataset.rows ?? Infinity) - local))
    const rows = await soda.query(dataset.id, { limit: take, offset: local, order: ':id', select: ':id,*' })
    page = { records: rows.map(r => rekeyRow(r, dataset.fields)), total, done: offset + rows.length >= total }
    if (dataset.rows != null) datasetEnd = offset - local + dataset.rows
  }

  for (const raw of page.records) {
    const parsed = parseCscRecord(kind, raw)
    if (!parsed) { result.seen++; continue }
    await processCscRecord(db, kind, resourceId, parsed, raw, result, log)
  }
  result.nextOffset = offset + page.records.length
  const total = page.total
  result.done = page.done ?? (page.records.length < batchSize || (total != null && result.nextOffset >= total))
  // A dataset that returns fewer rows than its cached count (rows removed upstream) must not stall the cursor.
  if (!page.records.length && !result.done) {
    if (datasetEnd != null && datasetEnd > offset) result.nextOffset = datasetEnd
    else result.done = true
  }
  return result
}
