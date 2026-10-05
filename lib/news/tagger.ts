/**
 * Tags a news article with entities already in the HOKU Insider database.
 *
 * Never creates entities. A tag is produced when:
 *   - a measure number ("SB 1234", "House Bill 12") resolves through identifiers.measure for the
 *     article's legislative biennium,
 *   - a PUC docket number ("Docket No. 2024-0123") resolves through identifiers.docket_number, or
 *   - a capitalized phrase of two or more words (or an all-caps acronym) equals, after normalize(),
 *     the name or an alias of a person, organization, or office. Org suffixes (Inc, LLC, Co…) are
 *     ignored on both sides, as in normalizeOrg().
 *
 * Overlapping phrase matches keep the longest span ("Hawaiian Electric Industries" beats "Hawaiian
 * Electric"). A phrase that matches more than one entity is returned unresolved with the candidate ids
 * so it lands in the review queue rather than on the wrong profile.
 */
import type { Db } from '@/lib/db/types'
import { normalize, normalizeOrg, matchByIdentifier, followMerge } from '@/lib/entity-match'

export type MentionKind = 'person' | 'org' | 'office' | 'bill' | 'docket'

export interface Mention {
  entityId: string | null
  kind: MentionKind | null
  /** The text as it appeared in the article. */
  surface: string
  matchedOn: 'name' | 'alias' | 'measure' | 'docket'
  /** 'subject' when the entity appears in the headline, otherwise 'mentioned'. */
  role: 'subject' | 'mentioned'
  /** Entity ids sharing this phrase when it is ambiguous (entityId is then null). */
  candidates?: string[]
}

export interface ArticleText { title: string; body: string | null; published: string | null }

// ---------------------------------------------------------------- phrase candidates

const CONNECTORS = new Set(['of', 'and', 'the', 'for', 'at', 'on', 'in', 'to', '&', 'de', 'da', 'del', 'la', 'van', 'von', 'o'])
const KEEP_PERIOD = /^(?:[A-Z]\.|Jr\.|Sr\.|Inc\.|Co\.|Corp\.|Ltd\.|St\.|Dr\.|Mt\.|U\.S\.|Ft\.)$/
/** Leading words that start a capitalized run but are never part of a name. */
const LEADING_NOISE = new Set(['the', 'a', 'an', 'gov', 'governor', 'mayor', 'sen', 'senator', 'rep', 'representative', 'state', 'council', 'councilmember', 'chair', 'president', 'director', 'judge', 'justice', 'attorney', 'general', 'lt', 'dr', 'mr', 'ms', 'mrs', 'former', 'acting', 'interim', 'house', 'senate', 'speaker', 'chief', 'executive', 'officer', 'u', 's'])
/** Acronyms too generic to tag on their own. */
const ACRONYM_STOP = new Set(['US', 'USA', 'AP', 'TV', 'CEO', 'CFO', 'COO', 'GOP', 'AM', 'PM', 'OK', 'ID', 'II', 'III', 'IV', 'JR', 'SR', 'LLC', 'INC', 'NEW', 'THE', 'AND', 'FOR', 'BUT', 'NOT', 'ALL', 'COVID', 'HI', 'FAQ', 'PDF', 'GPS', 'AI', 'EV', 'ER', 'ICU', 'NFL', 'NBA', 'MLB', 'UFC'])
const MAX_RUN_TOKENS = 9

export interface Candidate {
  key: string
  surface: string
  /** Every [start, end) character span where the phrase occurs (title first, body offset by title length + 1). */
  spans: Array<[number, number]>
  inTitle: boolean
  acronym: boolean
}

const isCap = (w: string) => /^[ʻ‘’']?[A-ZĀĒĪŌŪ]/.test(w)
const isAcronym = (w: string) => /^[A-Z]{2,6}$/.test(w) && !ACRONYM_STOP.has(w)

interface Token { word: string; breakAfter: boolean; pos: number }

function tokenize(text: string, base: number): Token[] {
  const out: Token[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    let w = m[0]
    let pos = base + m.index
    let breakAfter = false
    const lead = w.match(/^["“(\[]+/)
    if (lead) { w = w.slice(lead[0].length); pos += lead[0].length; if (out.length) out[out.length - 1].breakAfter = true }
    // Trailing punctuation ends a run, except the period of an initial or abbreviation ("D.", "Jr.").
    const trail = w.match(/[.,;:!?"”)\]—–]+$/)
    if (trail && !(trail[0] === '.' && KEEP_PERIOD.test(w))) { w = w.slice(0, w.length - trail[0].length); breakAfter = true }
    w = w.replace(/(?:['’]s|['’])$/u, '') // possessive
    if (!w) { if (out.length) out[out.length - 1].breakAfter = true; continue }
    out.push({ word: w, breakAfter, pos })
  }
  return out
}

/** Every capitalized phrase (and sub-phrase) in the text that could be an entity name. */
export function candidatePhrases(title: string, body: string | null): Candidate[] {
  const out = new Map<string, Candidate>()
  const segments: Array<{ text: string; base: number; inTitle: boolean }> = [{ text: title, base: 0, inTitle: true }]
  if (body) segments.push({ text: body, base: title.length + 1, inTitle: false })
  for (const seg of segments) {
    const tokens = tokenize(seg.text, seg.base)
    let run: Token[] = []
    const flush = () => {
      emitRun(run, seg.inTitle, out)
      run = []
    }
    for (const t of tokens) {
      const lc = t.word.toLowerCase()
      if (isCap(t.word) || (run.length && CONNECTORS.has(lc))) run.push(t)
      else flush()
      if (t.breakAfter) flush()
    }
    flush()
  }
  return [...out.values()]
}

function emitRun(run: Token[], inTitle: boolean, out: Map<string, Candidate>) {
  while (run.length && CONNECTORS.has(run[run.length - 1].word.toLowerCase())) run = run.slice(0, -1)
  if (!run.length) return
  for (let i = 0; i < run.length; i++) {
    const first = run[i].word.toLowerCase()
    if (CONNECTORS.has(first)) continue
    for (let j = i; j < Math.min(run.length, i + MAX_RUN_TOKENS); j++) {
      const last = run[j].word.toLowerCase()
      if (CONNECTORS.has(last)) continue
      const words = run.slice(i, j + 1).map(t => t.word)
      const single = i === j
      if (single && !isAcronym(words[0])) continue
      if (!single && words.every(w => LEADING_NOISE.has(w.toLowerCase().replace(/\.$/, '')))) continue
      const surface = words.join(' ')
      const start = run[i].pos
      const end = run[j].pos + run[j].word.length
      for (const key of new Set([normalize(surface), normalizeOrg(surface)])) {
        if (!key) continue
        const nTok = key.split(' ').length
        if (nTok < 2 && !single) continue
        if (key.length < 2) continue
        const prev = out.get(key)
        if (prev) { prev.spans.push([start, end]); prev.inTitle ||= inTitle; continue }
        out.set(key, { key, surface, spans: [[start, end]], inTitle, acronym: single })
      }
    }
  }
}

// ---------------------------------------------------------------- measures and dockets

const MEASURE_RE = /\b(HB|SB|HCR|SCR|HR|SR|GM)[\s-]?(\d{1,4})\b(?:,?\s*(?:HD|SD|CD)\d)*/g
const MEASURE_WORDS_RE = /\b(House|Senate)\s+(Bill|Resolution|Concurrent Resolution)\s+(?:No\.\s*)?(\d{1,4})\b/gi
const DOCKET_RE = /\bDocket\s+(?:No\.?\s*|Number\s+)?(\d{4}-\d{4})\b/gi

export function measureMentions(text: string): Array<{ measure: string; surface: string }> {
  const out = new Map<string, string>()
  for (const m of text.matchAll(MEASURE_RE)) out.set(`${m[1]}${Number(m[2])}`, m[0].trim())
  for (const m of text.matchAll(MEASURE_WORDS_RE)) {
    const chamber = m[1].toLowerCase() === 'house' ? 'H' : 'S'
    const kind = /concurrent/i.test(m[2]) ? 'CR' : /resolution/i.test(m[2]) ? 'R' : 'B'
    out.set(`${chamber}${kind}${Number(m[3])}`, m[0].trim())
  }
  return [...out].map(([measure, surface]) => ({ measure, surface }))
}

export function docketMentions(text: string): Array<{ docket: string; surface: string }> {
  const out = new Map<string, string>()
  for (const m of text.matchAll(DOCKET_RE)) out.set(m[1], m[0].trim())
  return [...out].map(([docket, surface]) => ({ docket, surface }))
}

/**
 * Legislative sessions a measure number in an article could belong to. Hawaiʻi measure numbers run
 * across the biennium (odd year + following even year), so an even-year article also checks the odd
 * year before it. Articles published before the session opens in January still refer to last year's
 * bills, so January of an odd year checks the previous biennium too.
 */
export function sessionsFor(published: string | null, now = new Date()): string[] {
  const d = published ? new Date(published) : now
  const y = d.getUTCFullYear()
  if (y % 2 === 0) return [String(y), String(y - 1)]
  return d.getUTCMonth() === 0 ? [String(y), String(y - 1), String(y - 2)] : [String(y)]
}

// ---------------------------------------------------------------- resolution

interface EntityHit { id: string; kind: MentionKind; name: string; aliases: string[]; keys: string[]; merged_into_id: string | null }

export async function tagArticle(db: Db, article: ArticleText): Promise<Mention[]> {
  const mentions: Mention[] = []
  const seen = new Set<string>()
  const add = (m: Mention) => {
    const k = m.entityId ?? `?${m.surface}`
    const prev = mentions.find(x => (x.entityId ?? `?${x.surface}`) === k)
    if (prev) { if (m.role === 'subject') prev.role = 'subject'; return }
    if (m.entityId) seen.add(m.entityId)
    mentions.push(m)
  }
  const full = `${article.title}\n${article.body ?? ''}`

  for (const { measure, surface } of measureMentions(full)) {
    for (const session of sessionsFor(article.published)) {
      const hit = await matchByIdentifier(db, 'measure', `${session}:${measure}`, 'bill')
      if (hit) { add({ entityId: hit.entityId, kind: 'bill', surface, matchedOn: 'measure', role: article.title.includes(surface) ? 'subject' : 'mentioned' }); break }
    }
  }
  for (const { docket, surface } of docketMentions(full)) {
    const hit = await matchByIdentifier(db, 'docket_number', docket, 'docket')
    if (hit) add({ entityId: hit.entityId, kind: 'docket', surface, matchedOn: 'docket', role: article.title.includes(surface) ? 'subject' : 'mentioned' })
  }

  const candidates = candidatePhrases(article.title, article.body)
  if (!candidates.length) return mentions
  const byKey = new Map(candidates.map(c => [c.key, c]))
  const rows = await db.many<EntityHit>(
    `select id, kind, name, aliases, merged_into_id, public.entity_match_keys(kind, name, aliases) keys
       from entity
      where kind in ('person', 'org', 'office')
        and public.entity_match_keys(kind, name, aliases) && $1::text[]`,
    [[...byKey.keys()]])

  // key → distinct surviving entities
  const hitsByKey = new Map<string, Map<string, { kind: MentionKind; viaAlias: boolean }>>()
  for (const r of rows) {
    const id = r.merged_into_id ? await followMerge(db, r.id) : r.id
    const nameKeys = new Set([normalize(r.name), r.kind === 'org' ? normalizeOrg(r.name) : ''])
    for (const k of r.keys) {
      const c = byKey.get(k)
      if (!c) continue
      // Acronyms only match an org/office alias or name that is itself the acronym.
      if (c.acronym && (r.kind === 'person' || k !== normalize(c.surface))) continue
      const m = hitsByKey.get(k) ?? new Map()
      if (!m.has(id)) m.set(id, { kind: r.kind, viaAlias: !nameKeys.has(k) })
      hitsByKey.set(k, m)
    }
  }

  // Longest phrase first; a phrase counts only where it occurs outside every accepted longer phrase
  // ("Hawaiian Electric" inside "Hawaiian Electric Industries" is not a second mention).
  const len = (c: Candidate) => c.spans[0][1] - c.spans[0][0]
  const matched = [...hitsByKey.keys()].map(k => byKey.get(k)!).sort((a, b) => len(b) - len(a))
  const taken: Array<[number, number]> = []
  for (const c of matched) {
    const free = c.spans.filter(([s, e]) => !taken.some(([ts, te]) => ts <= s && e <= te && te - ts > e - s))
    if (!free.length) continue
    taken.push(...free)
    const hits = hitsByKey.get(c.key)!
    const role = free.some(([s]) => s < article.title.length) ? 'subject' : 'mentioned'
    if (hits.size === 1) {
      const [[id, h]] = [...hits]
      add({ entityId: id, kind: h.kind, surface: c.surface, matchedOn: h.viaAlias ? 'alias' : 'name', role })
    } else {
      const ids = [...hits.keys()].sort()
      if (ids.every(id => seen.has(id))) continue
      add({ entityId: null, kind: null, surface: c.surface, matchedOn: 'name', role, candidates: ids })
    }
  }
  return mentions
}
