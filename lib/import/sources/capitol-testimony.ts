/**
 * Hawaiʻi State Legislature — testimony PDFs.
 *
 * Each measure page links a testimony packet per hearing
 * (`https://www.capitol.hawaii.gov/sessions/session<YYYY>/Testimony/<MEASURE>_TESTIMONY_<COMMITTEE>_<MM-DD-YY>_.PDF`).
 * The packet is one PDF containing every testifier's submission. We split by the hearing-notice
 * cover conventions ("Testimony of", "Submitted by", "RE:", position words) and emit one
 * `testified_on` edge per testifier with role = support | oppose | comment.
 */
import type { Db } from '@/lib/db/types'
import { fetchText, fetchBuffer } from '../http'
import { extractPdfText, normalizePdfText } from '../clients/pdf'
import { processRecord, emptyResult, resolveRef, type BatchResult, type EdgeInput } from '../pipeline'
import { cleanName, canonicalPersonName, normalizeMeasure, looksLikeOrg } from '../normalize'
import type { ImportOptions, SourcePage } from '../types'
import { load } from 'cheerio'
import { listUrl, parseMeasureList, siteMeasureUrl, currentSession, SITE_BASE } from './capitol-measures'

export const SOURCE_KEY = 'capitol_testimony'

export type Position = 'support' | 'oppose' | 'comment'

export interface Testifier { name: string; org: string | null; position: Position; isOrg: boolean; excerpt: string }

export interface TestimonyPacket {
  measure: string
  session: string
  committee: string | null
  hearingDate: string | null
  url: string
  testifiers: Testifier[]
  text: string
}

export function parseTestimonyLinks(html: string): Array<{ url: string; committee: string | null; hearingDate: string | null }> {
  const $ = load(html)
  const out: Array<{ url: string; committee: string | null; hearingDate: string | null }> = []
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href') ?? ''
    if (!/testimony/i.test(href) || !/\.pdf$/i.test(href)) return
    const m = href.match(/TESTIMONY_([A-Z\/\-]+)_(\d{2})-(\d{2})-(\d{2})/i)
    const url = href.startsWith('http') ? href : `${SITE_BASE}${href.startsWith('/') ? '' : '/'}${href}`
    out.push({ url, committee: m ? m[1].replace(/-/g, '/') : null, hearingDate: m ? `20${m[4]}-${m[2]}-${m[3]}` : null })
  })
  return out
}

export function positionOf(text: string): Position {
  const head = text.slice(0, 1500)
  if (/\b(in\s+)?(strong\s+)?(opposition|oppose[sd]?|against)\b/i.test(head) && !/\bsupport/i.test(head.slice(0, 400))) return 'oppose'
  if (/\b(in\s+)?(strong\s+)?support(s|ing)?\b/i.test(head)) return 'support'
  if (/\bcomments?\b|\bconcerns?\b|\bamendments?\b/i.test(head)) return 'comment'
  return 'comment'
}

const ORG_HEADER_RE = /Testimony\s+(?:of|by|from)\s*:?\s+([^\n]{3,100})/i
const PERSON_RE = /(?:Submitted\s+by|Presented\s+by|Testifier\s*:|Submitter\s*:|^\s*Name\s*:)\s*([^\n,(]{3,60})/im
const ON_BEHALF_RE = /(?:on\s+behalf\s+of|Organization|Representing)\s*:?\s+([^\n]{3,100})/i
const SELF_RE = /\bMy\s+name\s+is\s+([A-Z][A-Za-zʻ'\-. ]{2,60}?)(?:\s+and\b|[,.]|\n)/
const SIGNATURE_RE = /(?:Sincerely|Mahalo|Aloha|Respectfully(?:\s+submitted)?|Thank\s+you)[,.]?\s*\n+\s*([A-Z][A-Za-zʻ'\-. ]{2,60}?)\s*(?:\n|$)/

const tidy = (v: string | null | undefined) => cleanName((v ?? '').replace(/\s+(Vice President|President|Director|Executive Director|Chair|CEO|Manager|Attorney|Counsel)\b.*$/i, '').replace(/[,;:\s]+$/, ''))

/**
 * Split a testimony packet into per-testifier chunks. Heuristic: form-feed page breaks, "Testimony of …"
 * headers and salutations start a new submission; "Submitted by" belongs to the same submission.
 */
export function parseTestifiers(rawText: string): Testifier[] {
  const text = rawText.replace(/\r/g, '')
  const chunks = text.split(/\f|\n(?=\s*(?:Testimony\s+(?:of|by|from|in|on)\b|Aloha\s+Chair|Dear\s+Chair|TO:\s+))/i).map(c => c.trim()).filter(c => c.length > 80)
  const out: Testifier[] = []
  const seen = new Set<string>()
  for (const chunk of chunks) {
    const head = chunk.slice(0, 2000)
    const header = tidy(head.match(ORG_HEADER_RE)?.[1])
    const person = tidy(head.match(PERSON_RE)?.[1]) ?? tidy(head.match(SELF_RE)?.[1]) ?? tidy(chunk.match(SIGNATURE_RE)?.[1])
    let org = tidy(head.match(ON_BEHALF_RE)?.[1])
    let name: string | null
    if (header && (looksLikeOrg(header) || (person && header.toLowerCase() !== person.toLowerCase()))) { org = org ?? header; name = person ?? header }
    else name = person ?? header
    if (!name) continue
    name = name.replace(/\b(Chair|Vice Chair|Members?|Committee)\b.*$/i, '').trim()
    if (name.length < 3) continue
    const isOrg = !person && !!header && looksLikeOrg(header)
    if (isOrg) org = null
    const key = `${name.toLowerCase()}|${(org ?? '').toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, org, position: positionOf(head), isOrg, excerpt: normalizePdfText(head).slice(0, 600) })
  }
  return out
}

export async function importBatch(db: Db, offset: number, batchSize: number, opts: ImportOptions = {}): Promise<BatchResult> {
  const log = opts.log ?? (() => {})
  const params = opts.params ?? {}
  const session = params.session ?? currentSession()
  const result = emptyResult(offset)

  let page: SourcePage<TestimonyPacket>
  if (opts.pageSource) {
    page = (await opts.pageSource(offset, batchSize, params)) as unknown as SourcePage<TestimonyPacket>
  } else {
    // `offset` indexes measures in the session list; each measure may yield several packets.
    const all = params.measures ? params.measures.split(',').map(normalizeMeasure) : parseMeasureList(await fetchText(listUrl(session)))
    const slice = all.slice(offset, offset + batchSize)
    const records: TestimonyPacket[] = []
    for (const measure of slice) {
      try {
        const links = parseTestimonyLinks(await fetchText(siteMeasureUrl(session, measure)))
        for (const link of links) {
          const exists = await db.one(`select 1 from document where source = $1 and url = $2`, [SOURCE_KEY, link.url])
          if (exists) continue // packets are immutable once posted; skip the PDF download
          const pdf = await extractPdfText(await fetchBuffer(link.url))
          records.push({ measure, session, committee: link.committee, hearingDate: link.hearingDate, url: link.url, testifiers: parseTestifiers(pdf.text), text: normalizePdfText(pdf.text) })
        }
      } catch (e) { result.errors++; log(`${measure}: ${(e as Error).message}`) }
    }
    page = { records, total: all.length, done: offset + slice.length >= all.length }
    result.nextOffset = offset + slice.length
  }

  for (const p of page.records) {
    try {
      await processRecord(db, {
        document: {
          source: SOURCE_KEY, source_record_id: p.url.replace(/^https?:\/\/[^/]+/, ''), doc_type: 'testimony',
          title: `Testimony on ${p.measure} (${p.session})${p.committee ? ` — ${p.committee}` : ''}${p.hearingDate ? ` ${p.hearingDate}` : ''}`,
          doc_date: p.hearingDate, url: p.url, body_text: p.text.slice(0, 500_000),
          raw: { measure: p.measure, session: p.session, committee: p.committee, hearing_date: p.hearingDate, url: p.url, testifiers: p.testifiers.map(t => ({ name: t.name, org: t.org, position: t.position })) },
        },
        edges: async ({ db: d, created }) => {
          const bill = await resolveRef(d, { kind: 'bill', rawName: `${p.measure} (${p.session})`, identifiers: { measure: `${p.session}:${p.measure}` }, createIfMissing: true, attributes: { measure_number: p.measure, session: p.session } })
          if (bill.created) created()
          const edges: EdgeInput[] = []
          for (const t of p.testifiers) {
            const from = t.isOrg
              ? await resolveRef(d, { kind: 'org', rawName: t.name })
              : await resolveRef(d, { kind: 'person', rawName: t.name, canonicalName: canonicalPersonName(t.name) })
            edges.push({ type: 'testified_on', from, to: bill, role: t.position, start_date: p.hearingDate, attributes: { organization: t.org, committee: p.committee, excerpt: t.excerpt, session: p.session } })
            if (t.org) {
              const org = await resolveRef(d, { kind: 'org', rawName: t.org })
              edges.push({ type: 'testified_on', from: org, to: bill, role: t.position, start_date: p.hearingDate, attributes: { via: t.name, committee: p.committee, session: p.session } })
            }
          }
          return edges
        },
      }, result)
    } catch (e) { result.errors++; log(`${p.url}: ${(e as Error).message}`) }
  }
  if (opts.pageSource) result.nextOffset = offset + page.records.length
  result.done = page.done ?? page.records.length < batchSize
  return result
}
