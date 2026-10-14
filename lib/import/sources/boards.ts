/**
 * Boards & Commissions — appointments (boards.hawaii.gov).
 *
 * The site is a WordPress multisite: each state board or commission is a subsite at /<slug>/ with its
 * own sitemap, and the root sitemap index (/sitemap.xml) lists every subsite sitemap. The old /boards/
 * index page is gone (HTTP 404, Oct 2026). Each run reads the sitemap index for the board list, then
 * for each board its home page plus up to two roster pages linked from it (members, commissioners, …).
 *
 * Each board becomes one `appointment` document per fetch (checksummed, so unchanged rosters do not
 * create new documents). Members become `appointed_to` edges from person → office (kind='office',
 * office_type='board' | 'commission'), role = seat/title, end_date = term expiration. A board whose
 * pages name no members is skipped (counted as seen), so no empty office is created.
 */
import type { Db } from '@/lib/db/types'
import { fetchText } from '../http'
import { processRecord, emptyResult, resolveRef, type BatchResult, type EdgeInput } from '../pipeline'
import { cleanName, canonicalPersonName, toIsoDate } from '../normalize'
import type { ImportOptions, SourcePage } from '../types'
import { load } from 'cheerio'
import { sitemapLocs } from '../probe'

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

/** Board subsites from the root sitemap index: https://boards.hawaii.gov/<slug>/sitemap.xml → /<slug>/. */
export function parseBoardSitemapIndex(xml: string): Array<{ slug: string; url: string }> {
  const out = new Map<string, string>()
  for (const loc of sitemapLocs(xml)) {
    const m = loc.match(/^https?:\/\/boards\.hawaii\.gov\/([a-z0-9-]+)\/sitemap\.xml$/i)
    if (!m || /^(master-child|wp-[a-z-]+)$/i.test(m[1])) continue
    out.set(m[1], `${BASE}/${m[1]}/`)
  }
  return [...out].map(([slug, url]) => ({ slug, url }))
}

/** The board's own name on its subsite home page (site name, not the page title). */
export function boardName(html: string, fallback: string): string {
  const $ = load(html)
  const site = cleanName($('meta[property="og:site_name"]').attr('content'))
    ?? cleanName($('.site-title, #site-title').first().text())
    ?? cleanName($('title').first().text().split(/\s+[–|-]\s+/).pop())
  return site && !/^boards and commissions$/i.test(site) ? site : fallback
}

const ROSTER_RE = /member|roster|commissioner|composition|board-of-directors|our-board|directors|trustees/i

/** Links on a subsite page that likely list the members (same subsite only, max 2). */
export function rosterLinks(html: string, homeUrl: string): string[] {
  const $ = load(html)
  const home = new URL(homeUrl)
  const out = new Set<string>()
  $('a[href]').each((_, a) => {
    let u: URL
    try { u = new URL($(a).attr('href') ?? '', homeUrl) } catch { return }
    u.hash = ''
    if (u.host !== home.host || !u.pathname.startsWith(home.pathname) || u.pathname === home.pathname) return
    if (/\.(pdf|docx?|jpg|png)$/i.test(u.pathname)) return
    if (ROSTER_RE.test(u.pathname) || ROSTER_RE.test($(a).text())) out.add(u.toString())
  })
  return [...out].slice(0, 2)
}

const NOT_A_NAME = /\b(meeting|agenda|minutes|notice|report|board|commission|council|committee|department|office|application|apply|vacanc|contact|calendar|archive|policy|rules|statute|news|home|about|page|chair(person)?|member)s?\b/i

/** Two to five capitalized words, optionally with initials and a suffix: a plausible person name. */
export function looksLikePersonName(n: string): boolean {
  if (NOT_A_NAME.test(n)) return false
  const words = n.replace(/,?\s+(jr|sr|ii|iii|iv)\.?$/i, '').split(/\s+/)
  return words.length >= 2 && words.length <= 5 && words.every(w => /^[A-ZʻĀĒĪŌŪ][A-Za-zʻāēīōūĀĒĪŌŪ'.-]*$/.test(w))
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
      if (!n || /^vacant$/i.test(n) || !looksLikePersonName(n)) return
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
    const index = parseBoardSitemapIndex(await fetchText(params.index ?? `${BASE}/sitemap.xml`))
    const slice = index.slice(offset, offset + batchSize)
    const records: BoardPage[] = []
    for (const b of slice) {
      try {
        const homeHtml = await fetchText(b.url)
        const board = parseBoardPage(homeHtml, b.url, boardName(homeHtml, b.slug))
        board.name = boardName(homeHtml, board.name)
        const seen = new Set(board.members.map(m => m.name))
        for (const link of rosterLinks(homeHtml, b.url)) {
          try {
            for (const m of parseBoardPage(await fetchText(link), link, board.name).members) if (!seen.has(m.name)) { seen.add(m.name); board.members.push(m) }
          } catch (e) { log(`${b.slug} ${link}: ${(e as Error).message}`) }
        }
        records.push(board)
      } catch (e) { result.errors++; log(`${b.slug}: ${(e as Error).message}`) }
    }
    page = { records, total: index.length, done: offset + slice.length >= index.length }
    // Boards whose pages failed still advance the cursor; they are read again on the next weekly pass.
    result.nextOffset = offset + slice.length
  }

  for (const b of page.records) {
    if (!b.members.length) { result.seen++; log(`${b.name}: no members found on ${b.url}`); continue }
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
  if (opts.pageSource) result.nextOffset = offset + page.records.length
  result.done = page.done ?? page.records.length < batchSize
  return result
}
