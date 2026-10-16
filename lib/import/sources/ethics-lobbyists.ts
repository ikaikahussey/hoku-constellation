/**
 * State Ethics Commission — lobbyist registration statements and lobbyist expenditure statements,
 * read from the CSV downloads on the Commission's opendata.hawaii.gov dataset pages.
 *
 * opendata.hawaii.gov's robots.txt disallows /api/ and /datastore/, so the CKAN API is not used. The
 * dataset pages (/dataset/<name>) and their resource downloads (/dataset/<id>/resource/<id>/download/…)
 * are permitted: each run reads the dataset page, takes its CSV download link, and parses the file.
 *
 * Cursor: one offset across registrations then expenditures. The parsed rows are cached per warm
 * function instance for 30 minutes, so a cron tick downloads each file once. CSV rows carry no stable
 * id, so a row's id is a hash of its contents: an unchanged row is never stored twice, and an amended
 * row becomes a new document (the Commission's own amendment flag is kept in raw).
 *
 * Registration columns (observed): Full Name, Organization, Lobby Year, Registration Date,
 * Termination Date, Amended, Original, View (PDF url).
 * Expenditure columns (observed Oct 2026): Lobbyist Name, View ("Form (<PDF url>)"), Total Expense,
 * Lobby Period ("Jan. 1-Feb. 28, 2018"), Year, Date Filed, Original, Amended. The statement reports a
 * total for the period and names no payee, so it is stored as a document only; a `spent_with` edge is
 * written only when a row names a payee.
 */
import { createHash } from 'node:crypto'
import { load } from 'cheerio'
import type { Db } from '@/lib/db/types'
import { fetchText } from '../http'
import { processRecord, emptyResult, resolveRef, type BatchResult, type EdgeInput } from '../pipeline'
import { toIsoDate, toAmount, cleanName, canonicalPersonName, periodRange } from '../normalize'
import type { ImportOptions, SourcePage } from '../types'
import { parseCsv } from './property-hnl'

export const SOURCE_KEY = 'ethics_lobbyists'
export const OPEN_DATA = 'https://opendata.hawaii.gov'
export const DATASET_PAGES = {
  registrations: `${OPEN_DATA}/dataset/hawaii-state-ethics-commission-s-lobbyist-registration-statements`,
  expenditures: `${OPEN_DATA}/dataset/hawaii-state-ethics-commission-s-lobbyists-expenditure-statements`,
} as const
export type Dataset = keyof typeof DATASET_PAGES

/** CSV download links on a CKAN dataset page, in page order. */
export function csvLinks(html: string, base: string): string[] {
  const $ = load(html)
  const out = new Set<string>()
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href') ?? ''
    if (!/\/download\/[^?#]*\.csv(\?|#|$)/i.test(href)) return
    try { out.add(new URL(href, base).toString()) } catch { /* ignore */ }
  })
  return [...out]
}

/** Stable id for a CSV row with no id column. */
export function rowId(r: Record<string, unknown>): string {
  const canonical = JSON.stringify(Object.keys(r).sort().map(k => [k, String(r[k] ?? '').trim()]))
  return createHash('sha256').update(canonical).digest('hex').slice(0, 24)
}

const keyOf = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '')

/** First non-empty value among `keys`, matching column names case- and punctuation-insensitively. */
const str = (r: Record<string, unknown>, ...keys: string[]) => {
  const byKey = new Map(Object.entries(r).map(([k, v]) => [keyOf(k), v]))
  for (const k of keys) { const v = r[k] ?? byKey.get(keyOf(k)); if (v != null && String(v).trim() !== '') return String(v).trim() }
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
  const id = str(r, '_id') ?? rowId(r)
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
  /** Filing date, or the start of the period when there is none. */
  date: string | null
}

/** "Form (http://files.hawaii.gov/…pdf)" or a bare URL → the URL. */
export function viewUrl(v: string | null): string | null {
  return v?.match(/https?:\/\/[^\s)]+/)?.[0] ?? null
}

export function parseExpenditure(r: Record<string, unknown>): ExpenditureParsed | null {
  const id = str(r, '_id') ?? rowId(r)
  const filer = cleanName(str(r, 'Full Name', 'Organization', 'Lobbyist Name', 'Filer'))
  if (!id || !filer) return null
  const org = str(r, 'Organization')
  const person = str(r, 'Full Name', 'Lobbyist Name')
  const period = str(r, 'Lobby Period', 'Reporting Period', 'Period', 'Lobby Year')
  return {
    recordId: id, filer: (person ?? org)!, filerIsOrg: !person && !!org,
    period,
    category: str(r, 'Expenditure Category', 'Category', 'Type'),
    amount: toAmount(str(r, 'Total Expense', 'Amount', 'Total Expenditures', 'Total')),
    payee: cleanName(str(r, 'Payee', 'Vendor', 'Recipient')),
    url: viewUrl(str(r, 'View', 'URL')),
    date: toIsoDate(str(r, 'Date Filed')) ?? periodRange(period ?? str(r, 'Year')).start,
  }
}

// One download per dataset per warm function instance.
const cache = new Map<Dataset, { at: number; url: string; rows: Record<string, string>[] }>()
const CACHE_MS = 30 * 60_000

async function loadDataset(dataset: Dataset): Promise<{ url: string; rows: Record<string, string>[] }> {
  const hit = cache.get(dataset)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit
  const page = DATASET_PAGES[dataset]
  const [url] = csvLinks(await fetchText(page), page)
  if (!url) throw new Error(`no CSV download link on ${page}`)
  const rows = parseCsv(await fetchText(url, { timeoutMs: 120_000 }))
  const entry = { at: Date.now(), url, rows }
  cache.set(dataset, entry)
  return entry
}

export async function importBatch(db: Db, offset: number, batchSize: number, opts: ImportOptions = {}): Promise<BatchResult> {
  const log = opts.log ?? (() => {})
  const params = opts.params ?? {}
  const result = emptyResult(offset)

  let page: SourcePage
  let dataset: Dataset
  let url: string | null = null
  if (opts.pageSource) {
    dataset = (params.dataset as Dataset | undefined) ?? 'registrations'
    page = await opts.pageSource(offset, batchSize, params)
  } else {
    // --dataset=registrations|expenditures reads one file; otherwise the offset runs across both.
    const order: Dataset[] = params.dataset ? [params.dataset as Dataset] : ['registrations', 'expenditures']
    let base = 0
    let found: { dataset: Dataset; rows: Record<string, string>[]; url: string; local: number } | null = null
    let total = 0
    for (const d of order) {
      const { rows, url: u } = await loadDataset(d)
      if (!found && offset < base + rows.length) found = { dataset: d, rows, url: u, local: offset - base }
      base += rows.length
      total = base
    }
    if (!found) return { ...result, done: true }
    dataset = found.dataset
    url = DATASET_PAGES[dataset]
    const records = found.rows.slice(found.local, found.local + batchSize)
    page = { records, total, done: offset + records.length >= total }
    log(`${dataset}: rows ${found.local}–${found.local + records.length} of ${found.rows.length} (${found.url})`)
  }

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
            title: `${canonicalPersonName(p.filer)} lobbying expenditure statement${p.period ? `, ${p.period}` : ''}${p.amount != null ? ` ($${p.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })})` : ''}`,
            doc_date: p.date, url: p.url ?? url, raw,
          },
          edges: async ({ db: d }) => {
            // A statement total with no payee names no relationship; the document alone records it.
            if (!p.payee) return []
            const from = p.filerIsOrg
              ? await resolveRef(d, { kind: 'org', rawName: p.filer })
              : await resolveRef(d, { kind: 'person', rawName: p.filer, canonicalName: canonicalPersonName(p.filer) })
            const to = await resolveRef(d, { kind: 'org', rawName: p.payee })
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
