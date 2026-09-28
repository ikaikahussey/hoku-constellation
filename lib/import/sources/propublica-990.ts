/**
 * ProPublica Nonprofit Explorer — Hawaiʻi organizations, EIN enrichment, officers/directors from the
 * latest filing. Each organization detail is one `irs_990` document.
 */
import type { Db } from '@/lib/db/types'
import { fetchJson, HttpError } from '../http'
import { processRecord, emptyResult, resolveRef, type BatchResult, type EdgeInput } from '../pipeline'
import { cleanName, canonicalPersonName } from '../normalize'
import type { ImportOptions, SourcePage } from '../types'

export const SOURCE_KEY = 'propublica_990'
const SEARCH = 'https://projects.propublica.org/nonprofits/api/v2/search.json'
const ORG = (ein: string) => `https://projects.propublica.org/nonprofits/api/v2/organizations/${ein}.json`

export interface ProPublicaOrg { ein: number | string; name: string; city?: string; state?: string; ntee_code?: string | null; subseccd?: number | null }
export interface ProPublicaDetail {
  organization: ProPublicaOrg & { address?: string; zipcode?: string }
  filings_with_data?: Array<Record<string, unknown>>
  filings_without_data?: Array<Record<string, unknown>>
}

export interface Officer { name: string; title: string | null; compensation: number | null }

/** Officers appear as officer_nm_N / officer_ttl_N / officer_cmpnsatn_N (N=1..) or as `officers` arrays in newer filings. */
export function parseOfficers(filing: Record<string, unknown> | undefined): Officer[] {
  if (!filing) return []
  const out: Officer[] = []
  for (let i = 1; i <= 25; i++) {
    const name = cleanName(filing[`officer_nm_${i}`])
    if (!name) continue
    const comp = filing[`officer_cmpnsatn_${i}`]
    out.push({ name, title: cleanName(filing[`officer_ttl_${i}`]), compensation: typeof comp === 'number' ? comp : Number(comp) || null })
  }
  const arr = filing.officers
  if (Array.isArray(arr)) for (const o of arr as Array<Record<string, unknown>>) {
    const name = cleanName(o.name)
    if (name) out.push({ name, title: cleanName(o.title), compensation: typeof o.compensation === 'number' ? o.compensation : Number(o.compensation) || null })
  }
  return out
}

export const padEin = (ein: string | number) => String(ein).replace(/\D/g, '').padStart(9, '0')

export function isBoardTitle(title: string | null): boolean { return /director|board|trustee|regent/i.test(title ?? '') }

export async function importBatch(db: Db, offset: number, batchSize: number, opts: ImportOptions = {}): Promise<BatchResult> {
  const log = opts.log ?? (() => {})
  const params = opts.params ?? {}
  const result = emptyResult(offset)
  const perPage = 100 // ProPublica search page size
  const pageNo = Math.floor(offset / perPage)

  let page: SourcePage<ProPublicaDetail>
  if (opts.pageSource) {
    page = (await opts.pageSource(offset, batchSize, params)) as unknown as SourcePage<ProPublicaDetail>
  } else {
    const search = await fetchJson<{ organizations: ProPublicaOrg[]; num_pages?: number; total_results?: number }>(`${SEARCH}?state%5Bid%5D=${params.state ?? 'HI'}&page=${pageNo}`)
    const hits = (search.organizations ?? []).slice(offset % perPage, (offset % perPage) + batchSize)
    const details: ProPublicaDetail[] = []
    for (const hit of hits) {
      try { details.push(await fetchJson<ProPublicaDetail>(ORG(padEin(hit.ein)))) }
      catch (e) { result.errors++; log(`ein ${hit.ein}: ${(e as HttpError).message}`) }
    }
    page = { records: details, done: (search.organizations ?? []).length < perPage && offset % perPage + hits.length >= (search.organizations ?? []).length }
  }

  for (const detail of page.records) {
    const ein = padEin(detail.organization.ein)
    const orgName = cleanName(detail.organization.name)
    if (!orgName) { result.seen++; continue }
    const latest = detail.filings_with_data?.[0]
    const taxYear = latest ? Number(latest.tax_prd_yr ?? latest.tax_year) || null : null
    try {
      await processRecord(db, {
        document: {
          source: SOURCE_KEY, source_record_id: ein, doc_type: 'irs_990', title: `${orgName} — Form 990${taxYear ? ` ${taxYear}` : ''}`,
          doc_date: taxYear ? `${taxYear}-12-31` : null, url: `https://projects.propublica.org/nonprofits/organizations/${ein}`,
          raw: detail as unknown as Record<string, unknown>,
        },
        edges: async ({ db: d, created }) => {
          const org = await resolveRef(d, { kind: 'org', rawName: orgName, identifiers: { ein }, attributes: { org_type: 'nonprofit', city: detail.organization.city, state: detail.organization.state, ntee_code: detail.organization.ntee_code ?? undefined } })
          if (org.created) created()
          const edges: EdgeInput[] = []
          for (const o of parseOfficers(latest)) {
            const person = await resolveRef(d, { kind: 'person', rawName: o.name, canonicalName: canonicalPersonName(o.name) })
            edges.push({
              type: isBoardTitle(o.title) ? 'director_of' : 'officer_of', from: person, to: org, role: o.title,
              start_date: taxYear ? `${taxYear}-01-01` : null, amount: null,
              attributes: { is_current: true, compensation: o.compensation, tax_year: taxYear, source_description: 'IRS Form 990 (ProPublica)' },
            })
          }
          return edges
        },
      }, result)
    } catch (e) { result.errors++; log(`ein ${ein}: ${(e as Error).message}`) }
  }
  result.nextOffset = offset + page.records.length
  result.done = page.done ?? page.records.length < batchSize
  return result
}
