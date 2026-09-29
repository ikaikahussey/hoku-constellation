/**
 * DCCA Business Registration Division — registry export loader (manual source).
 *
 * The BREG portal (https://hbe.dcca.hawaii.gov) disallows all automated access in robots.txt and uses
 * reCAPTCHA, so it is never fetched. Bulk registry data reaches HOKU Insider one of two lawful ways, and
 * this loader reads either as CSV:
 *   1. DCCA's Entity List Builder (https://hbe.dcca.hawaii.gov/entity-list-builder), where staff buy and
 *      download a list of registered entities;
 *   2. a UIPA request (HRS ch. 92F) to BREG for the registry extract (see docs/HAWAII_CORPORATIONS.md).
 *
 * Columns are matched by header name, case-insensitively and in any order, so either export works without
 * a code change. Recognised headers (first match wins):
 *   file number   — "File Number", "File No", "Business ID", "Entity Number", "Registration Number"
 *   name          — "Business Name", "Entity Name", "Legal Name", "Name"
 *   entity type   — "Entity Type", "Business Type", "Type", "Organization Type"
 *   status        — "Status", "Entity Status", "Standing"
 *   registered    — "Registration Date", "Incorporation Date", "Formation Date", "Date Registered", "Date of Organization"
 *   incorporated in — "Place of Incorporation", "State of Incorporation", "Jurisdiction", "Domicile"
 *   address       — "Mailing Address"/"Principal Address"/"Address", "City", "State", "Zip"/"Postal Code"
 *   agent         — "Registered Agent", "Agent Name", "Agent"
 *   officers      — wide ("Officer 1 Name", "Officer 1 Title", …) or long (one row per officer with
 *                   "Officer Name"/"Officer Title"; rows sharing a file number are merged).
 *
 * Each entity becomes one `business_registration` document keyed by file number; the org is resolved by
 * DCCA file number (identifiers.dcca) or created. Officers become officer_of / director_of edges from a
 * resolve-only person reference, so a bare name never creates a duplicate person.
 */
import type { Db } from '@/lib/db/types'
import { processRecord, emptyResult, resolveRef, type BatchResult, type EdgeInput } from '../pipeline'
import { cleanName, canonicalPersonName, islandForZip, normalizeDccaFileNumber, toIsoDate } from '../normalize'
import type { ImportOptions, SourcePage } from '../types'
import { parseCsv } from './property-hnl'

export const SOURCE_KEY = 'dcca_breg'

export interface BregOfficer { name: string; title: string | null }
export interface BregEntity {
  fileNumber: string
  name: string
  entityType: string | null
  status: string | null
  registrationDate: string | null
  placeOfIncorporation: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  agent: string | null
  officers: BregOfficer[]
  raw: Record<string, string>[]
}

type Field = 'fileNumber' | 'name' | 'entityType' | 'status' | 'registrationDate' | 'placeOfIncorporation' | 'address' | 'city' | 'state' | 'zip' | 'agent' | 'officerName' | 'officerTitle'

/** Header patterns, tried in order. Officer-numbered wide columns are handled separately. */
const FIELD_PATTERNS: Array<[Field, RegExp]> = [
  ['fileNumber', /^(file\s*(number|no\.?|#)|business\s*id|entity\s*(number|no\.?|id)|registration\s*(number|no\.?))$/i],
  ['officerName', /^officer(\s*name)?$/i],
  ['officerTitle', /^(officer\s*)?(title|position)$/i],
  ['name', /^(business|entity|legal|company|corporation)?\s*name$/i],
  ['entityType', /^(entity|business|organization|corporation)?\s*type$/i],
  ['status', /^(entity\s*|business\s*)?(status|standing)$/i],
  ['registrationDate', /^(registration|incorporation|formation|organization)\s*date$|^date\s*(registered|of\s*(incorporation|organization|formation))$/i],
  ['placeOfIncorporation', /^(place|state|country)\s*of\s*(incorporation|formation|organization)$|^(jurisdiction|domicile)$/i],
  ['address', /^((mailing|principal|business|street)\s*)?address(\s*(line\s*)?1)?$/i],
  ['city', /^((mailing|principal|business)\s*)?city$/i],
  ['state', /^((mailing|principal|business)\s*)?state$/i],
  ['zip', /^((mailing|principal|business)\s*)?(zip(\s*code)?|postal\s*code)$/i],
  ['agent', /^(registered\s*)?agent(\s*name)?$/i],
]

const WIDE_OFFICER = /^officer\s*(\d+)\s*(name|title|position)$|^officer\s*(name|title|position)\s*(\d+)$/i

export interface ColumnMap { fields: Partial<Record<Field, string>>; officerColumns: Array<{ n: number; name?: string; title?: string }>; unmapped: string[] }

/** Map CSV headers to fields; `unmapped` lists headers the loader ignores (kept in the raw document). */
export function mapColumns(headers: string[]): ColumnMap {
  const fields: Partial<Record<Field, string>> = {}
  const officers = new Map<number, { n: number; name?: string; title?: string }>()
  const unmapped: string[] = []
  for (const h of headers) {
    const key = h.trim()
    const wide = key.match(WIDE_OFFICER)
    if (wide) {
      const n = Number(wide[1] ?? wide[4])
      const kind = (wide[2] ?? wide[3]).toLowerCase() === 'name' ? 'name' : 'title'
      const slot = officers.get(n) ?? { n }
      slot[kind] = key
      officers.set(n, slot)
      continue
    }
    const hit = FIELD_PATTERNS.find(([f, re]) => !fields[f] && re.test(key))
    if (hit) fields[hit[0]] = key
    else unmapped.push(key)
  }
  return { fields, officerColumns: [...officers.values()].sort((a, b) => a.n - b.n), unmapped }
}

/** Parse a registry export into one entity per file number (long-format officer rows are merged). */
export function parseBregCsv(text: string): { entities: BregEntity[]; columns: ColumnMap; skipped: number } {
  const rows = parseCsv(text)
  const columns = mapColumns(rows.length ? Object.keys(rows[0]) : [])
  const f = columns.fields
  const get = (r: Record<string, string>, field: Field) => (f[field] ? cleanName(r[f[field]!]) : null)
  const byFile = new Map<string, BregEntity>()
  let skipped = 0
  for (const r of rows) {
    const fileNumber = normalizeDccaFileNumber(get(r, 'fileNumber'))
    const name = get(r, 'name')
    if (!fileNumber || (!name && !byFile.has(fileNumber))) { skipped++; continue }
    let e = byFile.get(fileNumber)
    if (!e) {
      e = {
        fileNumber, name: name!, entityType: get(r, 'entityType'), status: get(r, 'status'),
        registrationDate: toIsoDate(get(r, 'registrationDate')), placeOfIncorporation: get(r, 'placeOfIncorporation'),
        address: get(r, 'address'), city: get(r, 'city'), state: get(r, 'state'), zip: get(r, 'zip'), agent: get(r, 'agent'),
        officers: [], raw: [],
      }
      byFile.set(fileNumber, e)
    }
    e.raw.push(r)
    const add = (name: string | null, title: string | null) => {
      if (name && !e!.officers.some(o => o.name === name && o.title === title)) e!.officers.push({ name, title })
    }
    add(get(r, 'officerName'), get(r, 'officerTitle'))
    for (const slot of columns.officerColumns) add(slot.name ? cleanName(r[slot.name]) : null, slot.title ? cleanName(r[slot.title]) : null)
  }
  return { entities: [...byFile.values()], columns, skipped }
}

/** Registry entity-type text → org_type vocabulary. */
export function orgTypeFor(entityType: string | null): string {
  const t = (entityType ?? '').toLowerCase()
  if (/non-?profit/.test(t)) return 'nonprofit'
  if (/limited liability limited partnership|lllp/.test(t)) return 'limited_partnership'
  if (/limited liability company|\bllc\b/.test(t)) return 'llc'
  if (/limited liability partnership|\bllp\b/.test(t)) return 'partnership'
  if (/limited partnership|\blp\b/.test(t)) return 'limited_partnership'
  if (/general partnership|partnership/.test(t)) return 'partnership'
  if (/trade\s*name/.test(t)) return 'trade_name'
  if (/corporation|corp\b|profit/.test(t)) return 'corporation'
  return 'organization'
}

export const isBoardTitle = (title: string | null) => /director|board|trustee|manager|member|partner/i.test(title ?? '')

export function orgAttributesFor(e: BregEntity): Record<string, unknown> {
  const zip = e.zip ?? undefined
  const attrs: Record<string, unknown> = {
    org_type: orgTypeFor(e.entityType),
    legal_form: e.entityType ?? undefined,
    status: e.status ? e.status.toLowerCase() : undefined,
    registration_date: e.registrationDate ?? undefined,
    place_of_incorporation: e.placeOfIncorporation ?? undefined,
    city: e.city ?? undefined,
    state: e.state ?? undefined,
    zip,
    island: islandForZip(zip) ?? undefined,
    registered_agent: e.agent ?? undefined,
  }
  return Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined))
}

// Parsed export, cached per invocation so each batch slices the same entity list.
let cache: { key: string; parsed: ReturnType<typeof parseBregCsv> } | null = null

export async function importBatch(db: Db, offset: number, batchSize: number, opts: ImportOptions = {}): Promise<BatchResult> {
  const log = opts.log ?? (() => {})
  const params = opts.params ?? {}
  const result = emptyResult(offset)
  const fileLabel = params.file ?? params.filename ?? 'upload'

  let page: SourcePage<BregEntity>
  if (opts.pageSource) {
    page = (await opts.pageSource(offset, batchSize, params)) as unknown as SourcePage<BregEntity>
  } else {
    if (!params.csv) throw new Error('dcca_breg needs --file=<export.csv> or an /admin/import upload (manual source; the portal is never fetched)')
    const key = `${fileLabel}:${params.csv.length}`
    if (!cache || cache.key !== key) cache = { key, parsed: parseBregCsv(params.csv) }
    const { entities, columns, skipped } = cache.parsed
    if (offset === 0) {
      log(`columns: ${JSON.stringify(columns.fields)}; officer columns: ${columns.officerColumns.length}; ignored: ${columns.unmapped.join(', ') || 'none'}; rows skipped (no file number or name): ${skipped}`)
      if (!columns.fields.fileNumber || !columns.fields.name) throw new Error(`dcca_breg: could not find a file-number and a name column in: ${[...Object.values(columns.fields), ...columns.unmapped].join(', ')}`)
    }
    const slice = entities.slice(offset, offset + batchSize)
    page = { records: slice, total: entities.length, done: offset + slice.length >= entities.length }
  }

  for (const e of page.records) {
    try {
      await processRecord(db, {
        document: {
          source: SOURCE_KEY, source_record_id: e.fileNumber, doc_type: 'business_registration',
          title: `${e.name} — DCCA business registration ${e.fileNumber}`, doc_date: e.registrationDate, url: null,
          raw: { file: fileLabel, rows: e.raw },
        },
        edges: async ({ db: d, created }) => {
          const org = await resolveRef(d, { kind: 'org', rawName: e.name, identifiers: { dcca: e.fileNumber }, attributes: orgAttributesFor(e) })
          if (org.created) created()
          const edges: EdgeInput[] = []
          for (const o of e.officers) {
            const person = await resolveRef(d, { kind: 'person', rawName: o.name, canonicalName: canonicalPersonName(o.name) })
            edges.push({ type: isBoardTitle(o.title) ? 'director_of' : 'officer_of', from: person, to: org, role: o.title, attributes: { source_description: 'DCCA business registration', source_file: fileLabel } })
          }
          return edges
        },
      }, result)
    } catch (err) { result.errors++; log(`${e.fileNumber}: ${(err as Error).message}`) }
  }
  result.nextOffset = offset + page.records.length
  result.done = page.done ?? page.records.length < batchSize
  return result
}
