/**
 * Boards & Commissions — appointments (boards.hawaii.gov).
 *
 * The site lists every state board/commission with its current members, seat descriptions and term
 * expirations. Each board page becomes one `appointment` document per fetch (checksummed, so unchanged
 * rosters do not create new documents). Members become `appointed_to` edges from person → office
 * (kind='office', office_type='board' | 'commission'), role = seat/title, end_date = term expiration.
 */
import type { Db } from '@/lib/db/types'
import { fetchText } from '../http'
import { processRecord, emptyResult, resolveRef, type BatchResult, type EdgeInput } from '../pipeline'
import { cleanName, canonicalPersonName, toIsoDate } from '../normalize'
import type { ImportOptions, SourcePage } from '../types'
import { load } from 'cheerio'

export const SOURCE_KEY = 'boards'
export const BASE = 'https://boards.hawaii.gov'

export interface BoardMember { name: string; seat: string | null; termEnds: string | null; appointedBy: string | null }
export interface BoardPage { name: string; url: string; department: string | null; description: string | null; members: BoardMember[] }

export function parseBoardIndex(html: string): Array<{ name: string; url: string }> {
  const $ = load(html)
  const out = new Map<string, string>()
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href') ?? ''
    const name = cleanName($(a).text())
    if (!name || !/\/(boards|board|commission|listing|listings)\//i.test(href) || /\.(pdf|jpg|png)$/i.test(href)) return
    if (/^(home|about|contact|apply|login|search|next|previous|\d+)$/i.test(name)) return
    const url = href.startsWith('http') ? href : `${BASE}${href.startsWith('/') ? '' : '/'}${href}`
    if (!out.has(url)) out.set(url, name)
  })
  return [...out].map(([url, name]) => ({ name, url }))
}

export function parseBoardPage(html: string, url: string, fallbackName: string): BoardPage {
  const $ = load(html)
  const name = cleanName($('h1').first().text()) ?? fallbackName
  const department = cleanName($('*:contains("Department")').filter((_, el) => /^Department:?/i.test($(el).text().trim())).first().next().text()) ?? null
  const members: BoardMember[] = []
  // Table layout: Name | Seat/Position | Term Expires | Appointed By
  $('table').each((_, table) => {
    const head = $(table).find('tr').first().text().toLowerCase()
    if (!/name|member/.test(head)) return
    const cols = $(table).find('tr').first().find('th,td').toArray().map(c => $(c).text().trim().toLowerCase())
    const idx = (re: RegExp) => cols.findIndex(c => re.test(c))
    const nameIdx = Math.max(0, idx(/name|member/)), seatIdx = idx(/seat|position|title|represent/), termIdx = idx(/term|expir/), byIdx = idx(/appointed|nominat/)
    $(table).find('tr').slice(1).each((_, tr) => {
      const cells = $(tr).find('td').toArray().map(td => $(td).text().replace(/\s+/g, ' ').trim())
      const n = cleanName(cells[nameIdx])
      if (!n || /^vacant$/i.test(n)) return
      members.push({ name: n, seat: seatIdx >= 0 ? cleanName(cells[seatIdx]) : null, termEnds: termIdx >= 0 ? toIsoDate(cells[termIdx]) : null, appointedBy: byIdx >= 0 ? cleanName(cells[byIdx]) : null })
    })
  })
  // List layout: <li>Name — Seat (Term expires 06/30/2027)</li>
  if (!members.length) {
    $('li, p').each((_, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim()
      const m = t.match(/^([A-Z][A-Za-zʻ'\-. ]{2,60})\s*[—–\-|,]\s*(.*?)(?:\(?\s*(?:Term\s+)?(?:Expires?|Ends?|through|to)\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})\)?)?$/i)
      if (!m) return
      const n = cleanName(m[1])
      if (!n || /^vacant$/i.test(n)) return
      members.push({ name: n, seat: cleanName(m[2]) ?? null, termEnds: toIsoDate(m[3]), appointedBy: null })
    })
  }
  return { name, url, department, description: cleanName($('meta[name="description"]').attr('content')) ?? null, members }
}

export const officeType = (name: string): 'board' | 'commission' => /commission/i.test(name) ? 'commission' : 'board'

export async function importBatch(db: Db, offset: number, batchSize: number, opts: ImportOptions = {}): Promise<BatchResult> {
  const log = opts.log ?? (() => {})
  const params = opts.params ?? {}
  const result = emptyResult(offset)

  let page: SourcePage<BoardPage>
  if (opts.pageSource) {
    page = (await opts.pageSource(offset, batchSize, params)) as unknown as SourcePage<BoardPage>
  } else {
    const index = parseBoardIndex(await fetchText(params.index ?? `${BASE}/boards/`))
    const slice = index.slice(offset, offset + batchSize)
    const records: BoardPage[] = []
    for (const b of slice) {
      try { records.push(parseBoardPage(await fetchText(b.url), b.url, b.name)) } catch (e) { result.errors++; log(`${b.name}: ${(e as Error).message}`) }
    }
    page = { records, total: index.length, done: offset + slice.length >= index.length }
  }

  for (const b of page.records) {
    try {
      await processRecord(db, {
        document: {
          source: SOURCE_KEY, source_record_id: b.url.replace(/^https?:\/\/[^/]+/, ''), doc_type: 'appointment', title: `${b.name} — roster`, doc_date: null, url: b.url,
          raw: b as unknown as Record<string, unknown>,
        },
        edges: async ({ db: d, created }) => {
          const office = await resolveRef(d, { kind: 'office', rawName: b.name, createIfMissing: true, attributes: { office_type: officeType(b.name), jurisdiction: 'state', parent_agency: b.department ?? undefined, seat_count: b.members.length || undefined } })
          if (office.created) created()
          const edges: EdgeInput[] = []
          for (const m of b.members) {
            // Appointees are named by the appointing authority → authoritative; create person when new.
            const person = await resolveRef(d, { kind: 'person', rawName: m.name, canonicalName: canonicalPersonName(m.name), createIfMissing: true })
            if (person.created) created()
            edges.push({ type: 'appointed_to', from: person, to: office, role: m.seat ?? 'member', end_date: m.termEnds, attributes: { is_current: true, appointed_by: m.appointedBy, board: b.name } })
          }
          return edges
        },
      }, result)
    } catch (e) { result.errors++; log(`${b.name}: ${(e as Error).message}`) }
  }
  result.nextOffset = offset + page.records.length
  result.done = page.done ?? page.records.length < batchSize
  return result
}
