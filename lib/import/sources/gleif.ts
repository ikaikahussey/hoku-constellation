/**
 * GLEIF — Legal Entity Identifier records for entities formed under Hawaiʻi law.
 * https://api.gleif.org/api/v1/lei-records?filter[entity.jurisdiction]=US-HI  (≈430 records; CC0 licence)
 *
 * GLEIF is the only open, machine-readable source that carries the DCCA Business Registration Division
 * file number: records registered at RA000605 (Hawaiʻi DCCA BREG) put it in `entity.registeredAs`
 * ("372533 C5"). Each LEI record becomes one `entity_registration` document; the organization resolves by
 * LEI or DCCA file number, or is created. When the record reports a direct accounting-consolidation parent
 * (GLEIF Level 2), the parent is resolved by its LEI and an `owns` edge (parent → child) is recorded.
 */
import type { Db } from '@/lib/db/types'
import { fetchJson, HttpError } from '../http'
import { processRecord, emptyResult, resolveRef, type BatchResult, type EdgeInput } from '../pipeline'
import { cleanName, islandForZip, normalizeDccaFileNumber, toIsoDate } from '../normalize'
import type { ImportOptions, SourcePage } from '../types'

export const SOURCE_KEY = 'gleif'
const API = 'https://api.gleif.org/api/v1'
const PAGE_SIZE = 100
/** GLEIF Registration Authority code for the Hawaiʻi DCCA Business Registration Division. */
export const HAWAII_BREG_RA = 'RA000605'

interface Address { addressLines?: string[]; city?: string | null; region?: string | null; country?: string | null; postalCode?: string | null }
export interface LeiRecord {
  id: string
  attributes: {
    lei: string
    entity: {
      legalName: { name: string }
      otherNames?: Array<{ name: string; type?: string }>
      legalAddress: Address
      headquartersAddress?: Address
      registeredAt?: { id: string | null; other?: string | null } | null
      registeredAs?: string | null
      jurisdiction?: string | null
      legalForm?: { id: string | null; other?: string | null } | null
      status?: string | null
      creationDate?: string | null
    }
    registration: { initialRegistrationDate?: string | null; lastUpdateDate?: string | null; status?: string | null }
  }
  relationships?: Record<string, { links?: Record<string, string> }>
}
export interface GleifItem { record: LeiRecord; parent: LeiRecord | null }

/** ELF codes seen for US-HI entities, mapped to the org_type vocabulary. */
const LEGAL_FORMS: Record<string, { label: string; orgType: string }> = {
  VPBH: { label: 'Limited Liability Company', orgType: 'llc' },
  L2QV: { label: 'Corporation', orgType: 'corporation' },
  AQBO: { label: 'Limited Partnership', orgType: 'limited_partnership' },
  DX2N: { label: 'Nonprofit Corporation', orgType: 'nonprofit' },
  '6MB6': { label: 'Limited Liability Limited Partnership', orgType: 'limited_partnership' },
  IWRC: { label: 'Commercial Bank', orgType: 'bank' },
}

export function legalForm(form: LeiRecord['attributes']['entity']['legalForm']): { label: string | null; orgType: string } {
  const known = form?.id ? LEGAL_FORMS[form.id] : undefined
  if (known) return known
  const other = cleanName(form?.other)
  if (other) return { label: other.replace(/\b\w/g, c => c.toUpperCase()).replace(/\B\w+/g, w => w.toLowerCase()), orgType: other.toLowerCase().replace(/[^a-z]+/g, '_') }
  return { label: null, orgType: 'organization' }
}

/** "372533  c5" → "372533 C5". Only for records registered at the Hawaiʻi registry. */
export function dccaFileNumber(entity: LeiRecord['attributes']['entity']): string | null {
  if (entity.registeredAt?.id !== HAWAII_BREG_RA) return null
  return normalizeDccaFileNumber(entity.registeredAs)
}

export function hasDirectParent(r: LeiRecord): boolean {
  return !!r.relationships?.['direct-parent']?.links?.['lei-record']
}

function identifiersFor(r: LeiRecord): Record<string, string> {
  const ids: Record<string, string> = { lei: r.attributes.lei }
  const dcca = dccaFileNumber(r.attributes.entity)
  if (dcca) ids.dcca = dcca
  return ids
}

export function orgAttributesFor(r: LeiRecord): Record<string, unknown> {
  const e = r.attributes.entity
  const form = legalForm(e.legalForm)
  const addr = e.legalAddress ?? {}
  const zip = cleanName(addr.postalCode) ?? undefined
  const inHawaii = addr.region === 'US-HI'
  const attrs: Record<string, unknown> = {
    org_type: form.orgType,
    legal_form: form.label ?? undefined,
    status: e.status ? e.status.toLowerCase() : undefined,
    city: cleanName(addr.city) ?? undefined,
    state: addr.region?.startsWith('US-') ? addr.region.slice(3) : undefined,
    zip,
    island: inHawaii ? islandForZip(zip) ?? undefined : undefined,
    jurisdiction: e.jurisdiction ?? undefined,
    formation_date: toIsoDate(e.creationDate) ?? undefined,
    lei_status: r.attributes.registration.status ?? undefined,
  }
  return Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined))
}

const aliasesFor = (r: LeiRecord) =>
  (r.attributes.entity.otherNames ?? []).map(n => cleanName(n.name)).filter((n): n is string => !!n && n !== r.attributes.entity.legalName.name)

async function fetchPage(pageNo: number): Promise<{ data: LeiRecord[]; lastPage: number }> {
  const url = `${API}/lei-records?filter%5Bentity.jurisdiction%5D=US-HI&page%5Bsize%5D=${PAGE_SIZE}&page%5Bnumber%5D=${pageNo}`
  const res = await fetchJson<{ data: LeiRecord[]; meta: { pagination: { lastPage: number } } }>(url, { headers: { accept: 'application/vnd.api+json' } })
  return { data: res.data ?? [], lastPage: res.meta?.pagination?.lastPage ?? pageNo }
}

export async function importBatch(db: Db, offset: number, batchSize: number, opts: ImportOptions = {}): Promise<BatchResult> {
  const log = opts.log ?? (() => {})
  const params = opts.params ?? {}
  const result = emptyResult(offset)

  let page: SourcePage<GleifItem>
  if (opts.pageSource) {
    page = (await opts.pageSource(offset, batchSize, params)) as unknown as SourcePage<GleifItem>
  } else {
    const pageNo = Math.floor(offset / PAGE_SIZE) + 1
    const { data, lastPage } = await fetchPage(pageNo)
    const start = offset % PAGE_SIZE
    const slice = data.slice(start, start + batchSize)
    const items: GleifItem[] = []
    for (const record of slice) {
      let parent: LeiRecord | null = null
      if (hasDirectParent(record)) {
        try { parent = (await fetchJson<{ data: LeiRecord }>(`${API}/lei-records/${record.attributes.lei}/direct-parent`, { headers: { accept: 'application/vnd.api+json' } })).data }
        catch (e) { if (!(e instanceof HttpError && e.status === 404)) { result.errors++; log(`parent ${record.attributes.lei}: ${(e as Error).message}`) } }
      }
      items.push({ record, parent })
    }
    page = { records: items, done: pageNo >= lastPage && start + slice.length >= data.length }
  }

  for (const { record, parent } of page.records) {
    const e = record.attributes.entity
    const name = cleanName(e.legalName?.name)
    const lei = record.attributes.lei
    if (!name || !lei) { result.seen++; continue }
    try {
      await processRecord(db, {
        document: {
          source: SOURCE_KEY, source_record_id: lei, doc_type: 'entity_registration',
          title: `${name} — Legal Entity Identifier record`,
          doc_date: toIsoDate(e.creationDate) ?? toIsoDate(record.attributes.registration.initialRegistrationDate),
          url: `https://search.gleif.org/#/record/${lei}`,
          raw: { record, direct_parent: parent } as unknown as Record<string, unknown>,
        },
        edges: async ({ db: d, created }) => {
          const org = await resolveRef(d, { kind: 'org', rawName: name, identifiers: identifiersFor(record), aliases: aliasesFor(record), attributes: orgAttributesFor(record) })
          if (org.created) created()
          const edges: EdgeInput[] = []
          const parentName = cleanName(parent?.attributes.entity.legalName?.name)
          if (parent && parentName) {
            const owner = await resolveRef(d, { kind: 'org', rawName: parentName, identifiers: identifiersFor(parent), aliases: aliasesFor(parent), attributes: orgAttributesFor(parent) })
            if (owner.created) created()
            edges.push({ type: 'owns', from: owner, to: org, role: 'direct parent', attributes: { basis: 'accounting consolidation', source_description: 'GLEIF Level 2 relationship' } })
          }
          return edges
        },
      }, result)
    } catch (err) { result.errors++; log(`lei ${lei}: ${(err as Error).message}`) }
  }
  result.nextOffset = offset + page.records.length
  result.done = page.done ?? page.records.length < batchSize
  return result
}
