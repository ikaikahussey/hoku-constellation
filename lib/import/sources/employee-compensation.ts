/**
 * Public employee compensation — manual source (UIPA request, HRS §92F-12(a)(14)).
 * Reads a CSV supplied by staff (admin upload or `--file=`). Columns (case-insensitive, any order):
 *   name | employee, employer | department | agency, title | position, salary | compensation | amount, year | fiscal_year
 * Each row becomes one `record` document and one `employed_by` edge (person → org, role = title,
 * amount = compensation). Employers are authoritative government names → created; employees resolve
 * only (no auto-create) so a name alone never spawns a duplicate person.
 */
import type { Db } from '@/lib/db/types'
import { processRecord, emptyResult, resolveRef, type BatchResult } from '../pipeline'
import { cleanName, toAmount, canonicalPersonName } from '../normalize'
import type { ImportOptions, SourcePage } from '../types'
import { parseCsv } from './property-hnl'

export const SOURCE_KEY = 'employee_compensation'

export interface CompRow { name: string; employer: string; title: string | null; amount: number | null; year: number | null; raw: Record<string, string> }

const pick = (r: Record<string, string>, re: RegExp) => { const k = Object.keys(r).find(k => re.test(k)); return k ? r[k] : undefined }

export function parseCompRow(r: Record<string, string>): CompRow | null {
  const name = cleanName(pick(r, /^(employee(_| )?)?name$|^employee$|^full(_| )?name$/i) ?? pick(r, /name/i))
  const employer = cleanName(pick(r, /employer|department|agency|dept/i))
  if (!name || !employer) return null
  return {
    name, employer, title: cleanName(pick(r, /title|position|job|class/i)), amount: toAmount(pick(r, /salary|compensation|amount|pay|total/i)),
    year: Number(pick(r, /year|fy/i)?.replace(/\D/g, '').slice(-4)) || null, raw: r,
  }
}

export function parseCompCsv(text: string): CompRow[] {
  return parseCsv(text).map(parseCompRow).filter((r): r is CompRow => !!r)
}

export async function importBatch(db: Db, offset: number, batchSize: number, opts: ImportOptions = {}): Promise<BatchResult> {
  const log = opts.log ?? (() => {})
  const params = opts.params ?? {}
  const result = emptyResult(offset)
  let page: SourcePage<CompRow>
  if (opts.pageSource) {
    page = (await opts.pageSource(offset, batchSize, params)) as unknown as SourcePage<CompRow>
  } else {
    if (!params.csv) throw new Error('employee_compensation needs --file=<csv path> (manual UIPA source; the CLI reads it into params.csv)')
    const rows = parseCompCsv(params.csv)
    const slice = rows.slice(offset, offset + batchSize)
    page = { records: slice, total: rows.length, done: offset + slice.length >= rows.length }
  }
  const fileLabel = params.file ?? params.filename ?? 'upload'
  for (const r of page.records) {
    try {
      await processRecord(db, {
        document: {
          source: SOURCE_KEY, source_record_id: `${fileLabel}:${r.year ?? ''}:${r.employer}:${r.name}:${r.title ?? ''}`, doc_type: 'record',
          title: `${r.name} — ${r.employer}${r.year ? ` FY${r.year}` : ''}`, doc_date: r.year ? `${r.year}-06-30` : null, url: null, raw: r.raw,
        },
        edges: async ({ db: d, created }) => {
          const employer = await resolveRef(d, { kind: 'org', rawName: r.employer, createIfMissing: true, attributes: { org_type: 'government_agency' } })
          if (employer.created) created()
          const person = await resolveRef(d, { kind: 'person', rawName: r.name, canonicalName: canonicalPersonName(r.name) })
          return [{ type: 'employed_by' as const, from: person, to: employer, role: r.title, amount: r.amount, start_date: r.year ? `${r.year}-07-01` : null, attributes: { fiscal_year: r.year, source_file: fileLabel } }]
        },
      }, result)
    } catch (e) { result.errors++; log(`${r.name}: ${(e as Error).message}`) }
  }
  result.nextOffset = offset + page.records.length
  result.done = page.done ?? page.records.length < batchSize
  return result
}
