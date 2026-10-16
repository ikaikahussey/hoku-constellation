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
 * so it lands in the review queue rather than on the wrong profile. Two exceptions:
 *   - organizations whose names are identical after normalizeOrg() are duplicates of one body, so the
 *     best-connected one is tagged and the others are kept as `candidates` for merging;
 *   - an acronym in lib/news/aliases.ts (UH, HECO, DLNR, …) is also tried as its expanded name.
 * A person's three- or four-word name is also tried as first + last ("Joshua B. Green" → "Joshua
 * Green"), and stored person names answer to their first + last form too (migration 005).
 *
 * Key people and organizations that are not in the database are still identified from context: a name
 * after an official title ("Sen. Jane Doe", "Mayor Rick Blangiardi") or before or after "said", and an
 * organization whose name ends in a word such as Department, Commission or Association. They are
 * returned unresolved (no candidates) so they reach the review queue as `unmatched` mentions; nothing
 * is created.
 */
import type { Db } from '@/lib/db/types'
import { normalize, normalizeOrg, matchByIdentifier, followMerge } from '@/lib/entity-match'
import { ACRONYM_EXPANSIONS } from './aliases'

/** Bumped whenever tagging rules change; lib/news/retag.ts re-tags stored articles when it differs. */
export const TAGGER_VERSION = 2

export type MentionKind = 'person' | 'org' | 'office' | 'bill' | 'docket'

export interface Mention {
  entityId: string | null
  kind: MentionKind | null
  /** The text as it appeared in the article. */
  surface: string
  matchedOn: 'name' | 'alias' | 'measure' | 'docket' | 'acronym' | 'first_last' | 'extracted'
  /** 'subject' when the entity appears in the headline, otherwise 'mentioned'. */
  role: 'subject' | 'mentioned'
  /**
   * Entity ids sharing this phrase: when ambiguous (entityId is then null), or the duplicate
   * organizations collapsed into entityId.
   */
  candidates?: string[]
  /** For extracted mentions (matchedOn 'extracted'): what identified the name ("title:Sen.", "said", "org:Commission"). */
  cue?: string
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
  /** Key is the first + last word of a 3–4 word phrase; only person names may match it. */
  firstLast?: boolean
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
      const fl = firstLastKey(surface)
      if (fl && !out.has(fl)) out.set(fl, { key: fl, surface, spans: [[start, end]], inTitle, acronym: false, firstLast: true })
    }
  }
}

const NAME_SUFFIX = /^(jr|sr|ii|iii|iv)$/

/** "Joshua B. Green" / "Mary Ann K. Smith Jr." → "joshua green" / "mary smith"; null unless 3–5 words. Mirrors migration 005. */
export function firstLastKey(name: string): string | null {
  const toks = normalize(name).split(' ').filter(Boolean)
  while (toks.length && NAME_SUFFIX.test(toks[toks.length - 1])) toks.pop()
  if (toks.length < 3 || toks.length > 5) return null
  return `${toks[0]} ${toks[toks.length - 1]}`
}

// ---------------------------------------------------------------- key people and organizations

const TITLES = [
  'Gov', 'Governor', 'Lt. Gov', 'Lieutenant Governor', 'Sen', 'Senator', 'State Sen', 'Rep', 'Representative', 'State Rep',
  'Mayor', 'Councilmember', 'Council Member', 'Councilwoman', 'Councilman', 'Council Chair', 'Council Chairman', 'Council Chairwoman',
  'Speaker', 'Senate President', 'House Speaker', 'Attorney General', 'Prosecutor', 'Prosecuting Attorney', 'Judge', 'Justice', 'Chief Justice',
  'Director', 'Deputy Director', 'Chairperson', 'Chair', 'Chairman', 'Chairwoman', 'Commissioner', 'Trustee', 'Superintendent',
  'President', 'CEO', 'Chief Executive', 'Chief', 'Police Chief', 'Fire Chief', 'Secretary', 'Administrator', 'Executive Director',
  'U.S. Sen', 'U.S. Rep', 'Congressman', 'Congresswoman', 'Delegate',
]
const TITLE_RE = new RegExp(`\\b(${TITLES.map(t => t.replace(/[.]/g, '\\.').replace(/ /g, '\\s+')).sort((a, b) => b.length - a.length).join('|')})\\.?\\s+((?:[A-ZĀĒĪŌŪʻ‘][\\wʻ‘'’āēīōū-]*\\.?\\s+){1,3}[A-ZĀĒĪŌŪʻ‘][\\wʻ‘'’āēīōū-]+)`, 'g')
const PERSON_WORD = /^[A-ZĀĒĪŌŪʻ‘][A-Za-zʻ‘'’āēīōūĀĒĪŌŪ-]*\.?$/
const NOT_PERSON_WORD = /^(The|A|An|And|Of|In|On|At|For|To|Hawai[ʻ‘']?i|Honolulu|Maui|Kaua[ʻ‘']?i|Oahu|O[ʻ‘']ahu|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|State|County|City|House|Senate|Department|Office|Board|Commission|Council|University|Police|Fire|Democrats?|Republicans?|He|She|They|It|This|That|But|When|After|Before)$/
const SAID_BEFORE = /((?:[A-ZĀĒĪŌŪʻ‘][\wʻ‘'’āēīōū-]*\.?\s+){1,3}[A-ZĀĒĪŌŪʻ‘][\wʻ‘'’āēīōū-]+),?\s+(?:said|says|told|wrote|testified|announced)\b/g
const SAID_AFTER = /\b(?:said|says|according to)\s+((?:[A-ZĀĒĪŌŪʻ‘][\wʻ‘'’āēīōū-]*\.?\s+){1,3}[A-ZĀĒĪŌŪʻ‘][\wʻ‘'’āēīōū-]+)/g
const ORG_TAIL = /\b((?:[A-ZĀĒĪŌŪʻ‘][\wʻ‘'’āēīōū&.-]*\s+(?:(?:of|and|for|the|&)\s+)?){1,6}(Department|Commission|Council|Board|Authority|Association|Union|Foundation|University|College|Company|Corporation|Corp\.?|Inc\.?|LLC|Bank|Hospital|Medical Center|Trust|Agency|Committee|Coalition|Alliance|Institute|Society|Schools?|Party|Chamber of Commerce|Partners|Group|Holdings|Airlines|Electric|Industries|Federation|League|Bureau|Division|Office))\b/g
const MAX_EXTRACTED = 12

export interface KeyName { surface: string; kind: 'person' | 'org'; cue: string; inTitle: boolean }

const TITLE_WORD = /^(Gov|Governor|Lt|Sen|Senator|Rep|Representative|Mayor|Councilmember|Councilwoman|Councilman|Speaker|Judge|Justice|Director|Chair|Chairperson|Chairman|Chairwoman|Commissioner|Trustee|Superintendent|President|Secretary|Chief|Dr|Mr|Mrs|Ms|Former|Acting|Interim|U\.S\.)\.?$/

function cleanPerson(raw: string): string | null {
  const words = raw.trim().replace(/['’]s$/, '').split(/\s+/)
  // A sentence ends inside the match ("… said Kalani Akana. Rep. Nadine"): keep the part before it.
  const end = words.findIndex((w, i) => i < words.length - 1 && /[a-zāēīōū]{2,}\.$/.test(w))
  if (end >= 0) { words.splice(end + 1); words[end] = words[end].slice(0, -1) }
  while (words.length && (NOT_PERSON_WORD.test(words[0]) || TITLE_WORD.test(words[0]))) words.shift()
  while (words.length && NOT_PERSON_WORD.test(words[words.length - 1])) words.pop()
  if (words.length < 2 || words.length > 4 || !words.every(w => PERSON_WORD.test(w))) return null
  if (words.some(w => NOT_PERSON_WORD.test(w))) return null
  return words.join(' ')
}

function cleanOrg(raw: string): string | null {
  const words = raw.trim().replace(/\s+/g, ' ').split(' ')
  while (words.length && /^(The|A|An|and|of|for|the|&|In|On|At|By|From|With|After|Before|When|While)$/.test(words[0])) words.shift()
  if (words.length < 2) return null
  return words.join(' ')
}

/** People and organizations an article identifies by context, whether or not they are in the database. */
export function keyNames(title: string, body: string | null): KeyName[] {
  const out = new Map<string, KeyName>()
  const add = (surface: string | null, kind: KeyName['kind'], cue: string, inTitle: boolean) => {
    if (!surface) return
    const key = `${kind}:${normalize(surface)}`
    const prev = out.get(key)
    if (prev) { prev.inTitle ||= inTitle; return }
    out.set(key, { surface, kind, cue, inTitle })
  }
  for (const [text, inTitle] of [[title, true], [body ?? '', false]] as const) {
    for (const m of text.matchAll(TITLE_RE)) add(cleanPerson(m[2]), 'person', `title:${m[1].replace(/\s+/g, ' ')}`, inTitle)
    for (const m of text.matchAll(SAID_BEFORE)) add(cleanPerson(m[1]), 'person', 'said', inTitle)
    for (const m of text.matchAll(SAID_AFTER)) add(cleanPerson(m[1]), 'person', 'said', inTitle)
    // Headlines are title-cased, so an organization's extent cannot be read from capitalization there.
    if (!inTitle) for (const m of text.matchAll(ORG_TAIL)) add(cleanOrg(m[1]), 'org', `org:${m[2]}`, inTitle)
  }
  return [...out.values()].slice(0, MAX_EXTRACTED)
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
  const keyed = keyNames(article.title, article.body)
  if (!candidates.length && !keyed.length) return mentions
  const byKey = new Map(candidates.map(c => [c.key, c]))
  // Curated acronym expansions: expanded key → the acronym's candidate.
  const expansions = new Map<string, Candidate>()
  for (const c of candidates) {
    if (!c.acronym) continue
    for (const full of ACRONYM_EXPANSIONS[c.surface] ?? []) for (const k of [normalize(full), normalizeOrg(full)]) if (k && !byKey.has(k)) expansions.set(k, c)
  }
  const rows = await db.many<EntityHit & { degree: number }>(
    `select e.id, e.kind, e.name, e.aliases, e.merged_into_id, public.entity_match_keys(e.kind, e.name, e.aliases) keys,
            (select count(*)::int from edge x where x.from_id = e.id or x.to_id = e.id) degree
       from entity e
      where e.kind in ('person', 'org', 'office')
        and public.entity_match_keys(e.kind, e.name, e.aliases) && $1::text[]`,
    [[...byKey.keys(), ...expansions.keys()]])

  // candidate key → distinct surviving entities
  const hitsByKey = new Map<string, Map<string, { kind: MentionKind; via: Mention['matchedOn']; name: string; degree: number }>>()
  for (const r of rows) {
    const id = r.merged_into_id ? await followMerge(db, r.id) : r.id
    const nameKeys = new Set([normalize(r.name), r.kind === 'org' ? normalizeOrg(r.name) : ''])
    for (const k of r.keys) {
      const direct = byKey.get(k)
      const expanded = direct ? undefined : expansions.get(k)
      const c = direct ?? expanded
      if (!c) continue
      if (expanded && r.kind === 'person') continue
      // Acronyms only match an org/office alias or name that is itself the acronym (or a curated expansion).
      if (direct && c.acronym && (r.kind === 'person' || k !== normalize(c.surface))) continue
      if (c.firstLast && r.kind !== 'person') continue
      const via: Mention['matchedOn'] = expanded ? 'acronym' : c.firstLast ? 'first_last' : nameKeys.has(k) ? 'name' : 'alias'
      const m = hitsByKey.get(c.key) ?? new Map()
      if (!m.has(id) || (m.get(id).via === 'acronym' && !expanded)) m.set(id, { kind: r.kind, via, name: r.name, degree: r.degree })
      hitsByKey.set(c.key, m)
    }
  }

  // Longest phrase first; a phrase counts only where it occurs outside every accepted longer phrase
  // ("Hawaiian Electric" inside "Hawaiian Electric Industries" is not a second mention).
  const len = (c: Candidate) => c.spans[0][1] - c.spans[0][0]
  const matched = [...hitsByKey.keys()].map(k => byKey.get(k)!).sort((a, b) => len(b) - len(a) || Number(!!a.firstLast) - Number(!!b.firstLast))
  const taken: Array<[number, number]> = []
  for (const c of matched) {
    const free = c.spans.filter(([s, e]) => !taken.some(([ts, te]) => ts <= s && e <= te && (te - ts > e - s || c.firstLast)))
    if (!free.length) continue
    const hits = hitsByKey.get(c.key)!
    const role = free.some(([s]) => s < article.title.length) ? 'subject' : 'mentioned'
    const ids = [...hits.keys()].sort()
    const pick = hits.size === 1 ? ids[0] : duplicateOrg(hits)
    if (pick) {
      taken.push(...free)
      const h = hits.get(pick)!
      add({ entityId: pick, kind: h.kind, surface: c.surface, matchedOn: h.via, role, ...(hits.size > 1 ? { candidates: ids } : {}) })
    } else {
      if (ids.every(id => seen.has(id))) continue
      taken.push(...free)
      add({ entityId: null, kind: null, surface: c.surface, matchedOn: 'name', role, candidates: ids })
    }
  }

  // Context-identified people and organizations that no database match covered.
  const covered = (surface: string) => {
    const k = normalize(surface)
    return mentions.some(m => {
      const mk = normalize(m.surface)
      return mk === k || mk.includes(k) || k.includes(mk)
    })
  }
  for (const n of keyed) {
    if (covered(n.surface)) continue
    add({ entityId: null, kind: n.kind, surface: n.surface, matchedOn: 'extracted', role: n.inTitle ? 'subject' : 'mentioned', cue: n.cue })
  }
  return mentions
}

/** Several organizations with the same normalized name are one body entered twice: tag the best connected. */
function duplicateOrg(hits: Map<string, { kind: MentionKind; name: string; degree: number }>): string | null {
  const list = [...hits].map(([id, h]) => ({ id, ...h }))
  if (!list.every(h => h.kind === 'org' || h.kind === 'office')) return null
  if (new Set(list.map(h => normalizeOrg(h.name))).size !== 1) return null
  return list.sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id))[0].id
}
