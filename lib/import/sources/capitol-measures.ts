/**
 * Hawaiʻi State Legislature — measures (bills, resolutions) with introducers and status.
 *
 * Source: data.capitol.hawaii.gov publishes per-session measure lists in the "Measure Status" reports
 * (`/sessions/session<YYYY>/bills/` listing pages) and a machine-readable extract via the Legislature's
 * "Reports and Lists" (`https://data.capitol.hawaii.gov/sessions/session<YYYY>/bills/<Measure>.htm`).
 * Each measure page carries title, description, introducer(s), current referral and status history.
 *
 * Bills are authoritative entities (kind='bill', identifiers.measure = "<session>:<MEASURE>") and are
 * always created. Introducers resolve to legislators; the 'sponsored' edge carries role = 'introducer'
 * or 'co-introducer' (introducer order 1 vs >1). Status history lines are kept in document.raw.
 */
import type { Db } from '@/lib/db/types'
import { fetchText } from '../http'
import { processRecord, emptyResult, resolveRef, type BatchResult, type EdgeInput } from '../pipeline'
import { cleanName, canonicalPersonName, toIsoDate, normalizeMeasure } from '../normalize'
import type { ImportOptions, SourcePage } from '../types'
import { load } from 'cheerio'

export const SOURCE_KEY = 'capitol_measures'
export const DATA_BASE = 'https://data.capitol.hawaii.gov'
export const SITE_BASE = 'https://www.capitol.hawaii.gov'

export const currentSession = () => String(new Date().getFullYear())

export interface MeasureParsed {
  measure: string          // e.g. SB1234
  session: string          // e.g. 2026
  chamber: 'H' | 'S' | 'GM' | 'other'
  measureType: string      // HB, SB, HR, SR, HCR, SCR, GM
  title: string | null
  description: string | null
  introducers: string[]
  currentReferral: string | null
  currentStatus: string | null
  introducedDate: string | null
  statusHistory: Array<{ date: string | null; chamber: string | null; text: string }>
  companion: string | null
  url: string
}

const chamberFor = (type: string): MeasureParsed['chamber'] => type.startsWith('H') ? 'H' : type.startsWith('S') ? 'S' : type === 'GM' ? 'GM' : 'other'

/** Parse the legislature's list page for a session: returns measure codes in the page's order. */
export function parseMeasureList(html: string): string[] {
  const $ = load(html)
  const out = new Set<string>()
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href') ?? ''
    const m = href.match(/(?:billtype=(HB|SB|HR|SR|HCR|SCR|GM)&billnumber=(\d+))|\/bills\/((?:HB|SB|HR|SR|HCR|SCR|GM)\d+)(?:_|\.htm)/i)
    if (m) out.add(normalizeMeasure(m[3] ?? `${m[1]}${m[2]}`))
  })
  return [...out]
}

/** Parse a measure detail page (works with the data.capitol.hawaii.gov .htm extract and the site's measure_indiv page). */
export function parseMeasurePage(html: string, session: string, url: string): MeasureParsed | null {
  const $ = load(html)
  const text = (sel: string) => cleanName($(sel).first().text())
  const measureRaw = text('#ctl00_ContentPlaceHolderCol1_LabelMeasureNumber, .measure-number, td.measureNumber, h1') ?? (html.match(/\b(HB|SB|HR|SR|HCR|SCR|GM)\s?(\d+)/i) ? `${RegExp.$1}${RegExp.$2}` : null)
  if (!measureRaw) return null
  const measure = normalizeMeasure(measureRaw.replace(/\s.*$/, ''))
  const type = measure.match(/^[A-Z]+/)?.[0] ?? 'other'
  const labelled = (label: RegExp): string | null => {
    let found: string | null = null
    $('td, th, dt, span, b, strong, label').each((_, el) => {
      if (found) return
      if (label.test($(el).text().trim())) {
        const sib = $(el).next()
        const v = cleanName(sib.text()) ?? cleanName($(el).parent().next().text())
        if (v) found = v
      }
    })
    return found
  }
  const introducersRaw = text('#ctl00_ContentPlaceHolderCol1_ListViewIntroducer, .introducers') ?? labelled(/^Introducer\(s\)?:?$/i)
  const introducers = (introducersRaw ?? '').split(/[,;]|\band\b/).map(s => cleanName(s.replace(/\(.*?\)/g, ''))).filter((s): s is string => !!s && s.length > 2)
  const history: MeasureParsed['statusHistory'] = []
  $('table').each((_, table) => {
    const head = $(table).find('tr').first().text().toLowerCase()
    if (!/date/.test(head) || !/status/.test(head)) return
    $(table).find('tr').slice(1).each((_, tr) => {
      const cells = $(tr).find('td').toArray().map(td => $(td).text().replace(/\s+/g, ' ').trim())
      if (cells.length >= 2 && cells[cells.length - 1]) history.push({ date: toIsoDate(cells[0]), chamber: cells.length >= 3 ? cells[1] : null, text: cells[cells.length - 1] })
    })
  })
  const description = text('#ctl00_ContentPlaceHolderCol1_LabelDescription, .description') ?? labelled(/^Description:?$/i)
  const title = text('#ctl00_ContentPlaceHolderCol1_LabelMeasureTitle, .measure-title') ?? labelled(/^(Measure Title|Report Title):?$/i)
  return {
    measure, session, chamber: chamberFor(type), measureType: type, title, description, introducers,
    currentReferral: text('#ctl00_ContentPlaceHolderCol1_LabelCurrentReferral') ?? labelled(/^Current Referral:?$/i),
    currentStatus: history.length ? history[history.length - 1].text : labelled(/^Current Status:?$/i),
    introducedDate: history.find(h => /introduc|offered|received/i.test(h.text))?.date ?? history[0]?.date ?? null,
    statusHistory: history, companion: text('#ctl00_ContentPlaceHolderCol1_LabelCompanion') ?? labelled(/^Companion:?$/i), url,
  }
}

export const listUrl = (session: string) => `${DATA_BASE}/sessions/session${session}/bills/`
export const measureUrl = (session: string, measure: string) => `${DATA_BASE}/sessions/session${session}/bills/${measure}_.HTM`
export const siteMeasureUrl = (session: string, measure: string) => `${SITE_BASE}/session/measure_indiv.aspx?billtype=${measure.match(/^[A-Z]+/)?.[0]}&billnumber=${measure.replace(/^[A-Z]+/, '')}&year=${session}`

export async function importBatch(db: Db, offset: number, batchSize: number, opts: ImportOptions = {}): Promise<BatchResult> {
  const log = opts.log ?? (() => {})
  const params = opts.params ?? {}
  const session = params.session ?? currentSession()
  const result = emptyResult(offset)

  let page: SourcePage<MeasureParsed>
  if (opts.pageSource) {
    page = (await opts.pageSource(offset, batchSize, params)) as unknown as SourcePage<MeasureParsed>
  } else {
    const all = parseMeasureList(await fetchText(listUrl(session)))
    const slice = all.slice(offset, offset + batchSize)
    const records: MeasureParsed[] = []
    for (const m of slice) {
      const url = measureUrl(session, m)
      try {
        const parsed = parseMeasurePage(await fetchText(url), session, url)
        if (parsed) records.push(parsed)
      } catch (e) { result.errors++; log(`${m}: ${(e as Error).message}`) }
    }
    page = { records, total: all.length, done: offset + slice.length >= all.length }
  }

  for (const m of page.records) {
    try {
      await processRecord(db, {
        document: {
          source: SOURCE_KEY, source_record_id: `${m.session}:${m.measure}`, doc_type: 'measure', title: `${m.measure} (${m.session}) ${m.title ?? ''}`.trim(),
          doc_date: m.introducedDate, url: m.url, raw: m as unknown as Record<string, unknown>, body_text: m.description,
        },
        edges: async ({ db: d, created }) => {
          const bill = await resolveRef(d, {
            kind: 'bill', rawName: `${m.measure} (${m.session})`, identifiers: { measure: `${m.session}:${m.measure}` }, createIfMissing: true,
            attributes: { measure_number: m.measure, session: m.session, chamber: m.chamber, measure_type: m.measureType, title: m.title ?? undefined, description: m.description ?? undefined, current_status: m.currentStatus ?? undefined, introduced_date: m.introducedDate, current_referral: m.currentReferral, companion: m.companion },
          })
          if (bill.created) created()
          else await d.query(`update entity set attributes = attributes || $2::jsonb where id = $1`, [bill.entityId, JSON.stringify({ current_status: m.currentStatus, title: m.title, description: m.description, current_referral: m.currentReferral })])
          const edges: EdgeInput[] = []
          for (const [i, name] of m.introducers.entries()) {
            // Legislators are an authoritative roster → create person when missing.
            const person = await resolveRef(d, { kind: 'person', rawName: name, canonicalName: canonicalPersonName(name), createIfMissing: true, attributes: { entity_types: ['person', 'legislator'], chamber: m.chamber === 'H' ? 'House' : m.chamber === 'S' ? 'Senate' : undefined } })
            if (person.created) created()
            edges.push({ type: 'sponsored', from: person, to: bill, role: i === 0 ? 'introducer' : 'co-introducer', start_date: m.introducedDate, attributes: { order: i + 1, session: m.session } })
          }
          return edges
        },
      }, result)
    } catch (e) { result.errors++; log(`${m.measure}: ${(e as Error).message}`) }
  }
  result.nextOffset = offset + page.records.length
  result.done = page.done ?? page.records.length < batchSize
  return result
}
