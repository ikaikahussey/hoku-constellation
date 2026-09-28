/**
 * City & County of Honolulu — Real Property Assessment Division.
 *
 * Two access paths:
 *   1. Bulk: the annual assessment roll (CSV) when RPAD posts it (`params.file` = local path or URL).
 *      Columns (observed): TMK / Parcel, Owner Name(s), Site Address, Tax Class, Assessed Land, Assessed
 *      Building, Total Assessed Value, Land Area, Assessment Year.
 *   2. Targeted: for TMKs already attached to tracked entities (`entity.identifiers.tmk`) or passed in
 *      `params.tmks`, the qPublic parcel page is fetched and the owner block parsed. Only tracked
 *      parcels are fetched this way (no site-wide crawl, per RPAD terms).
 *
 * Parcels are authoritative entities (kind='parcel', identifiers.tmk). Owners resolve to person/org by
 * heuristic (`looksLikeOrg`) and are *not* created when unmatched — ownership edges with raw names
 * stay in review so a human confirms the match before it appears on a profile.
 */
import type { Db } from '@/lib/db/types'
import { fetchText } from '../http'
import { processRecord, emptyResult, resolveRef, type BatchResult, type EdgeInput } from '../pipeline'
import { cleanName, toAmount, toIsoDate, looksLikeOrg, normalizeTmk, canonicalPersonName } from '../normalize'

/** RPAD writes individuals as "LAST, FIRST M"; anything without that comma form is an organization or trust. */
export const ownerIsOrg = (name: string) => /,\s*[A-Z]/i.test(name) ? looksLikeOrg(name) : true
import type { ImportOptions, SourcePage } from '../types'
import { load } from 'cheerio'

export const SOURCE_KEY = 'property_hnl'
export const QPUBLIC = 'https://qpublic.schneidercorp.com/Application.aspx?AppID=1046&LayerID=24523&PageTypeID=4&PageID=10036'

export interface ParcelRecord {
  tmk: string
  owners: string[]
  address: string | null
  taxClass: string | null
  assessedLand: number | null
  assessedBuilding: number | null
  assessedTotal: number | null
  landAreaSqft: number | null
  assessmentYear: number | null
  url: string | null
  raw: Record<string, unknown>
}

const pick = (r: Record<string, unknown>, re: RegExp): unknown => { const k = Object.keys(r).find(k => re.test(k)); return k ? r[k] : undefined }

/** Minimal RFC4180 CSV parser (quoted fields, embedded commas/newlines). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false }
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = '' }
    else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const [header, ...body] = rows.filter(r => r.some(v => v.trim()))
  if (!header) return []
  return body.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])))
}

export function parseRollRow(r: Record<string, unknown>): ParcelRecord | null {
  const tmkRaw = pick(r, /^(tmk|parcel(_| )?(id|number|no)?|tax map key)$/i) ?? pick(r, /tmk|parcel/i)
  if (!tmkRaw) return null
  const tmk = normalizeTmk(String(tmkRaw))
  if (!/^1/.test(tmk)) return null // Honolulu = county 1
  const ownersRaw = String(pick(r, /owner/i) ?? '')
  const owners = ownersRaw.split(/;|\s{2,}|\s*&\s*|\/|\bAND\b|\bET\s?AL\b/i).map(o => cleanName(o.replace(/\b(TR|TRUSTEE|TRS|ETAL|ET AL)\b\.?/gi, ''))).filter((o): o is string => !!o && o.length > 2)
  const year = Number(pick(r, /year/i)) || null
  return {
    tmk, owners, address: cleanName(pick(r, /site\s*address|address|location/i)), taxClass: cleanName(pick(r, /class/i)),
    assessedLand: toAmount(pick(r, /land\s*(value|assess)|assessed\s*land/i)), assessedBuilding: toAmount(pick(r, /(building|improvement)\s*(value|assess)|assessed\s*(building|improvement)/i)),
    assessedTotal: toAmount(pick(r, /total/i)), landAreaSqft: toAmount(pick(r, /area|sq\s*ft|acre/i)), assessmentYear: year, url: null, raw: r,
  }
}

/** Parse a qPublic parcel detail page (Owner and Parcel Information + Assessment tables). */
export function parseQpublicPage(html: string, tmk: string, url: string): ParcelRecord | null {
  const $ = load(html)
  const cellAfter = (label: RegExp): string | null => {
    let v: string | null = null
    $('td, th, span, strong').each((_, el) => { if (!v && label.test($(el).text().trim())) v = cleanName($(el).next().text()) ?? cleanName($(el).parent().find('td').last().text()) })
    return v
  }
  const owner = cellAfter(/^Owner(\s*Name)?s?:?$/i) ?? cellAfter(/Owner/i)
  if (!owner && !cellAfter(/Parcel/i)) return null
  const owners = (owner ?? '').split(/;|\n|\s*&\s*|\bAND\b/i).map(o => cleanName(o.replace(/\b(TR|TRUSTEE|TRS|ETAL|ET AL)\b\.?/gi, ''))).filter((o): o is string => !!o && o.length > 2)
  const yearText = $('h2, h3, caption').filter((_, el) => /\b20\d{2}\b.*Assess/i.test($(el).text())).first().text().match(/\b(20\d{2})\b/)?.[1]
  return {
    tmk: normalizeTmk(tmk), owners, address: cellAfter(/(Site|Property|Location)\s*Address/i), taxClass: cellAfter(/(Tax\s*)?Class/i),
    assessedLand: toAmount(cellAfter(/Land\s*Value|Assessed\s*Land/i)), assessedBuilding: toAmount(cellAfter(/Building\s*Value|Improvement/i)), assessedTotal: toAmount(cellAfter(/Total\s*(Assessed|Value)/i)),
    landAreaSqft: toAmount(cellAfter(/Land\s*Area|Acres|Sq\s*Ft/i)), assessmentYear: yearText ? Number(yearText) : null, url, raw: { owner, tmk, fetched: toIsoDate(new Date().toISOString()) },
  }
}

export const qpublicUrl = (tmk: string) => `${QPUBLIC}&KeyValue=${encodeURIComponent(normalizeTmk(tmk))}`

export async function importBatch(db: Db, offset: number, batchSize: number, opts: ImportOptions = {}): Promise<BatchResult> {
  const log = opts.log ?? (() => {})
  const params = opts.params ?? {}
  const result = emptyResult(offset)

  let page: SourcePage<ParcelRecord>
  if (opts.pageSource) {
    page = (await opts.pageSource(offset, batchSize, params)) as unknown as SourcePage<ParcelRecord>
  } else if (params.file || params.csv) {
    // Bulk roll: `params.csv` holds file text read by the CLI; `params.file` may be a URL.
    const text = params.csv ?? (/^https?:/.test(params.file!) ? await fetchText(params.file!) : (() => { throw new Error('local --file paths are read by scripts/import/_cli.ts; pass a URL here') })())
    const rows = parseCsv(text)
    const slice = rows.slice(offset, offset + batchSize)
    page = { records: slice.map(parseRollRow).filter((p): p is ParcelRecord => !!p), total: rows.length, done: offset + slice.length >= rows.length }
    result.nextOffset = offset + slice.length
  } else {
    const tracked = params.tmks ? params.tmks.split(',') : (await db.many<{ tmk: string }>(`select identifiers ->> 'tmk' tmk from entity where kind = 'parcel' and identifiers ? 'tmk' and (identifiers ->> 'tmk') like '1%' order by 1`)).map(r => r.tmk)
    const slice = tracked.slice(offset, offset + batchSize)
    const records: ParcelRecord[] = []
    for (const tmk of slice) {
      try { const p = parseQpublicPage(await fetchText(qpublicUrl(tmk)), tmk, qpublicUrl(tmk)); if (p) records.push(p) } catch (e) { result.errors++; log(`${tmk}: ${(e as Error).message}`) }
    }
    page = { records, total: tracked.length, done: offset + slice.length >= tracked.length }
    result.nextOffset = offset + slice.length
  }

  for (const p of page.records) {
    try {
      await processRecord(db, {
        document: {
          source: SOURCE_KEY, source_record_id: `${p.tmk}:${p.assessmentYear ?? 'current'}`, doc_type: 'property_record',
          title: `TMK ${p.tmk}${p.address ? ` — ${p.address}` : ''}`, doc_date: p.assessmentYear ? `${p.assessmentYear}-01-01` : null, url: p.url ?? qpublicUrl(p.tmk),
          raw: { ...p.raw, tmk: p.tmk, owners: p.owners, assessed_total: p.assessedTotal },
        },
        edges: async ({ db: d, created }) => {
          const parcel = await resolveRef(d, { kind: 'parcel', rawName: `TMK ${p.tmk}`, identifiers: { tmk: p.tmk }, createIfMissing: true,
            attributes: { tmk: p.tmk, county: 'Honolulu', address: p.address, tax_class: p.taxClass, assessed_value: p.assessedTotal, assessment_year: p.assessmentYear, land_area_sqft: p.landAreaSqft } })
          if (parcel.created) created()
          else await d.query(`update entity set attributes = attributes || $2::jsonb where id = $1`, [parcel.entityId, JSON.stringify({ address: p.address, tax_class: p.taxClass, assessed_value: p.assessedTotal, assessment_year: p.assessmentYear })])
          const edges: EdgeInput[] = []
          for (const o of p.owners) {
            const owner = ownerIsOrg(o) ? await resolveRef(d, { kind: 'org', rawName: o }) : await resolveRef(d, { kind: 'person', rawName: o, canonicalName: canonicalPersonName(o) })
            edges.push({ type: 'owns', from: owner, to: parcel, role: 'fee owner', amount: p.assessedTotal, start_date: p.assessmentYear ? `${p.assessmentYear}-01-01` : null,
              attributes: { assessed_land: p.assessedLand, assessed_building: p.assessedBuilding, assessment_year: p.assessmentYear, co_owners: p.owners.length } })
          }
          return edges
        },
      }, result)
    } catch (e) { result.errors++; log(`${p.tmk}: ${(e as Error).message}`) }
  }
  if (opts.pageSource) result.nextOffset = offset + page.records.length
  result.done = page.done ?? page.records.length < batchSize
  return result
}
