/**
 * IRS Exempt Organizations Business Master File — Hawaiʻi extract.
 * https://www.irs.gov/pub/irs-soi/eo_hi.csv (≈9,700 rows, refreshed monthly by the IRS; public domain).
 *
 * Each row is one tax-exempt organization with a Hawaiʻi address: EIN, legal name, address, 501(c)
 * subsection, ruling date, NTEE code, and latest asset/income/revenue amounts. Each row becomes one
 * `entity_registration` document; the organization is resolved (or created) by EIN. No edges: the BMF
 * names no people. Officers come from Form 990 (propublica_990).
 */
import type { Db } from '@/lib/db/types'
import { fetchText } from '../http'
import { processRecord, emptyResult, resolveRef, type BatchResult } from '../pipeline'
import { cleanName, islandForZip } from '../normalize'
import type { ImportOptions, SourcePage } from '../types'
import { parseCsv } from './property-hnl'

export const SOURCE_KEY = 'irs_eo'
export const BMF_URL = (state = 'hi') => `https://www.irs.gov/pub/irs-soi/eo_${state.toLowerCase()}.csv`

export interface BmfRow {
  EIN: string; NAME: string; ICO?: string; STREET?: string; CITY?: string; STATE?: string; ZIP?: string
  SUBSECTION?: string; RULING?: string; FOUNDATION?: string; STATUS?: string; TAX_PERIOD?: string
  ASSET_AMT?: string; INCOME_AMT?: string; REVENUE_AMT?: string; NTEE_CD?: string
  [k: string]: string | undefined
}

/** "03" → "501(c)(3)". Subsection 00/blank has no 501(c) label (e.g. 4947(a)(1) trusts). */
export function subsectionLabel(code: string | undefined): string | null {
  const n = Number(code)
  return Number.isInteger(n) && n > 0 ? `501(c)(${n})` : null
}

/** "200410" → "2004-10-01"; anything else → null. */
export function yyyymmToDate(v: string | undefined): string | null {
  const m = String(v ?? '').match(/^(\d{4})(\d{2})$/)
  if (!m || m[1] === '0000' || Number(m[2]) < 1 || Number(m[2]) > 12) return null
  return `${m[1]}-${m[2]}-01`
}

const amount = (v: string | undefined) => (v && /^-?\d+$/.test(v.trim()) ? Number(v) : null)

export function orgAttributesFor(r: BmfRow): Record<string, unknown> {
  const zip = r.ZIP?.trim() || undefined
  const attrs: Record<string, unknown> = {
    org_type: 'nonprofit',
    city: cleanName(r.CITY) ?? undefined,
    state: cleanName(r.STATE) ?? undefined,
    zip,
    island: islandForZip(zip) ?? undefined,
    ntee_code: cleanName(r.NTEE_CD) ?? undefined,
    irs_subsection: subsectionLabel(r.SUBSECTION) ?? undefined,
    irs_ruling_date: yyyymmToDate(r.RULING) ?? undefined,
    assets: amount(r.ASSET_AMT) ?? undefined,
    income: amount(r.INCOME_AMT) ?? undefined,
    revenue: amount(r.REVENUE_AMT) ?? undefined,
  }
  return Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined))
}

export const padEin = (ein: string | number) => String(ein).replace(/\D/g, '').padStart(9, '0')

// One download per warm function instance; the monthly file is ~1.6 MB and every batch reads a slice.
let cache: { url: string; at: number; rows: BmfRow[] } | null = null
const CACHE_MS = 30 * 60_000

async function loadRows(url: string): Promise<BmfRow[]> {
  if (cache && cache.url === url && Date.now() - cache.at < CACHE_MS) return cache.rows
  const text = await fetchText(url, { timeoutMs: 120_000 })
  const rows = (parseCsv(text) as BmfRow[]).filter(r => r.EIN && cleanName(r.NAME))
  cache = { url, at: Date.now(), rows }
  return rows
}

export async function importBatch(db: Db, offset: number, batchSize: number, opts: ImportOptions = {}): Promise<BatchResult> {
  const log = opts.log ?? (() => {})
  const params = opts.params ?? {}
  const result = emptyResult(offset)
  const url = BMF_URL(params.state ?? 'hi')

  let page: SourcePage<BmfRow>
  if (opts.pageSource) {
    page = (await opts.pageSource(offset, batchSize, params)) as unknown as SourcePage<BmfRow>
  } else {
    const rows = await loadRows(url)
    const slice = rows.slice(offset, offset + batchSize)
    page = { records: slice, total: rows.length, done: offset + slice.length >= rows.length }
  }

  for (const r of page.records) {
    const ein = padEin(r.EIN)
    const name = cleanName(r.NAME)
    if (!name || ein === '000000000') { result.seen++; continue }
    const label = subsectionLabel(r.SUBSECTION)
    try {
      await processRecord(db, {
        document: {
          source: SOURCE_KEY, source_record_id: ein, doc_type: 'entity_registration',
          title: `${name} — IRS exempt organization${label ? ` (${label})` : ''}`,
          doc_date: yyyymmToDate(r.RULING), url, raw: r as unknown as Record<string, unknown>,
        },
        edges: async ({ db: d, created }) => {
          const org = await resolveRef(d, { kind: 'org', rawName: name, identifiers: { ein }, attributes: orgAttributesFor(r) })
          if (org.created) created()
          return []
        },
      }, result)
    } catch (e) { result.errors++; log(`ein ${ein}: ${(e as Error).message}`) }
  }
  result.nextOffset = offset + page.records.length
  result.done = page.done ?? page.records.length < batchSize
  return result
}
