/**
 * Entity resolution against the core `entity` table.
 *
 * Order of operations for every raw name coming out of a source record:
 *   1. matchByIdentifier(scheme, value)   — exact hit on entity.identifiers → confidence 1.0
 *   2. fuzzy fallback                      — trigram prefilter in SQL, Levenshtein over name + aliases,
 *                                            filtered by kind
 *   3. below the auto-match threshold      — leave from_id/to_id null, keep raw names, mark review/unmatched
 *
 * Every resolved id is passed through followMerge() so callers always land on the surviving entity.
 */
import type { Db } from '@/lib/db/types'

// ---------------------------------------------------------------- normalization

/**
 * Normalize a name for matching. Handles Hawaiian orthography so "Kauaʻi", "Kauai", "Kaua'i" and
 * "Kaua‘i" collapse to the same key:
 *   - ʻokina variants: U+02BB, U+2018, U+2019, ASCII apostrophe, backtick
 *   - kahakō (ā ē ī ō ū, upper and lower) via NFD + stripping combining marks
 */
export function normalize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')           // strip combining marks (kahakō)
    .replace(/[ʻ‘’`']/g, '')     // strip ʻokina variants
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const ORG_SUFFIXES = /\b(inc|incorporated|llc|l l c|ltd|corp|corporation|co|company|lp|llp|pac|the)\b/g

/** Looser normalization for organizations: drops corporate suffixes and articles. */
export function normalizeOrg(name: string): string {
  return normalize(name).replace(ORG_SUFFIXES, ' ').replace(/\s+/g, ' ').trim()
}

/** "Last, First Middle" → "First Middle Last". Leaves names without a comma untouched. */
export function canonicalPersonName(raw: string): string {
  const s = raw.trim().replace(/\s+/g, ' ')
  const comma = s.indexOf(',')
  if (comma === -1) return s
  const last = s.slice(0, comma).trim()
  const rest = s.slice(comma + 1).trim()
  return `${rest} ${last}`.trim()
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = new Array<number>(a.length + 1)
  let cur = new Array<number>(a.length + 1)
  for (let j = 0; j <= a.length; j++) prev[j] = j
  for (let i = 1; i <= b.length; i++) {
    cur[0] = i
    for (let j = 1; j <= a.length; j++) {
      cur[j] = b[i - 1] === a[j - 1]
        ? prev[j - 1]
        : Math.min(prev[j - 1] + 1, cur[j - 1] + 1, prev[j] + 1)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[a.length]
}

// ---------------------------------------------------------------- thresholds

export const AUTO_MATCH_THRESHOLD = 0.95
export const REVIEW_THRESHOLD = 0.7
/** Fuzzy confidence above which an unmatched name may be auto-created as a new entity. */
export const AUTO_CREATE_THRESHOLD = 0.0 // only identifier-bearing or explicitly whitelisted sources create

export type MatchStatus = 'matched' | 'review' | 'unmatched'

export function autoMatchThreshold(confidence: number): MatchStatus {
  if (confidence >= AUTO_MATCH_THRESHOLD) return 'matched'
  if (confidence >= REVIEW_THRESHOLD) return 'review'
  return 'unmatched'
}

// ---------------------------------------------------------------- pure matching

export interface MatchCandidate {
  id: string
  name: string
  confidence: number
}

export interface CandidateRow {
  id: string
  name: string
  aliases?: string[] | null
  kind?: string
}

/**
 * Pure fuzzy match of a raw name against in-memory candidates. Exact normalized match → 1.0;
 * otherwise 1 − levenshtein/maxLen over the name and every alias. Persons in "Last, First" form
 * are compared both as written and re-ordered.
 */
export function matchEntity(rawName: string, candidates: CandidateRow[], kind?: string): MatchCandidate[] {
  const norm = kind === 'org' ? normalizeOrg : normalize
  const variants = new Set<string>([norm(rawName)])
  if (kind !== 'org') variants.add(norm(canonicalPersonName(rawName)))
  const results: MatchCandidate[] = []

  for (const c of candidates) {
    const names = [c.name, ...(c.aliases ?? [])]
    let best = 0
    outer: for (const n of names) {
      const nc = norm(n)
      if (!nc) continue
      for (const v of variants) {
        if (!v) continue
        if (v === nc) { best = 1; break outer }
        const maxLen = Math.max(v.length, nc.length)
        const sim = 1 - levenshtein(v, nc) / maxLen
        if (sim > best) best = sim
      }
    }
    if (best >= REVIEW_THRESHOLD) {
      results.push({ id: c.id, name: c.name, confidence: Math.round(best * 100) / 100 })
    }
  }
  return results.sort((a, b) => b.confidence - a.confidence)
}

// ---------------------------------------------------------------- database-backed resolution

/** Follow merged_into_id chains to the surviving entity id. */
export async function followMerge(db: Db, id: string): Promise<string> {
  const row = await db.one<{ id: string }>(
    `with recursive chain as (
       select id, merged_into_id, 0 as depth from entity where id = $1
       union all
       select e.id, e.merged_into_id, c.depth + 1 from entity e join chain c on e.id = c.merged_into_id where c.depth < 10
     ) select id from chain where merged_into_id is null order by depth desc limit 1`,
    [id]
  )
  return row?.id ?? id
}

export interface IdentifierMatch {
  entityId: string
  confidence: 1
  scheme: string
}

/**
 * Exact match on a structured identifier stored in entity.identifiers, e.g. ('ein','99-0123456').
 * Values are compared after trimming; EINs and CIKs are also compared digits-only.
 */
export async function matchByIdentifier(db: Db, scheme: string, value: string | null | undefined, kind?: string): Promise<IdentifierMatch | null> {
  if (!value) return null
  const v = String(value).trim()
  if (!v) return null
  const digits = v.replace(/\D/g, '')
  const rows = await db.many<{ id: string }>(
    `select id from entity
      where (identifiers ->> $1 = $2 or ($3 <> '' and regexp_replace(identifiers ->> $1, '\\D', '', 'g') = $3))
        and ($4::text is null or kind = $4)
      order by (merged_into_id is null) desc, created_at asc
      limit 1`,
    [scheme, v, digits, kind ?? null]
  )
  if (!rows.length) return null
  return { entityId: await followMerge(db, rows[0].id), confidence: 1, scheme }
}

/** Try several identifier schemes in precedence order. */
export async function matchByIdentifiers(
  db: Db,
  identifiers: Record<string, string | null | undefined>,
  kind?: string,
  precedence: string[] = ['ein', 'sec_cik', 'fec_id', 'dcca', 'uei', 'tmk', 'fcc_frn', 'olms', 'lda_id', 'csc_reg_no', 'legacy_id']
): Promise<IdentifierMatch | null> {
  const schemes = [...precedence, ...Object.keys(identifiers).filter(k => !precedence.includes(k))]
  for (const scheme of schemes) {
    const hit = await matchByIdentifier(db, scheme, identifiers[scheme], kind)
    if (hit) return hit
  }
  return null
}

export interface FuzzyOptions {
  kind: string
  limit?: number
  /** Minimum trigram similarity for the SQL prefilter. */
  trigram?: number
}

/**
 * Fuzzy fallback over entity.name and entity.aliases filtered by kind. Uses pg_trgm to prefilter
 * candidates in SQL, then scores with the pure matcher.
 */
export async function fuzzyMatch(db: Db, rawName: string, opts: FuzzyOptions): Promise<MatchCandidate[]> {
  const cleaned = rawName.trim()
  if (!cleaned) return []
  const probe = opts.kind === 'org' ? normalizeOrg(cleaned) : normalize(canonicalPersonName(cleaned))
  const limit = opts.limit ?? 25
  const trigram = opts.trigram ?? 0.25
  const rows = await db.many<CandidateRow>(
    `select id, name, aliases from entity
      where kind = $1
        and (similarity(lower(name), $2) >= $3
             or exists (select 1 from unnest(aliases) a where similarity(lower(a), $2) >= $3)
             or lower(name) = $4)
      order by similarity(lower(name), $2) desc
      limit $5`,
    [opts.kind, probe, trigram, cleaned.toLowerCase(), limit]
  )
  return matchEntity(cleaned, rows, opts.kind)
}

export interface ResolveInput {
  kind: string
  rawName: string | null | undefined
  identifiers?: Record<string, string | null | undefined>
}

export interface Resolution {
  entityId: string | null
  status: MatchStatus
  confidence: number | null
  via: 'identifier' | 'fuzzy' | 'none'
  candidate?: MatchCandidate
}

/**
 * Full resolution pipeline: identifier → fuzzy → thresholds. Never creates entities; callers
 * decide whether to create based on `via`/`status` and the presence of an identifier.
 */
/** Kinds whose identity is an identifier, not a name: "SB1234" and "SB1235" are one edit apart but distinct. */
const IDENTIFIER_KINDS: Record<string, string> = { bill: 'measure', docket: 'docket_number', parcel: 'tmk' }

export async function resolveEntity(db: Db, input: ResolveInput): Promise<Resolution> {
  const ids = Object.fromEntries(Object.entries(input.identifiers ?? {}).filter(([, v]) => v != null && String(v).trim() !== '')) as Record<string, string>
  if (Object.keys(ids).length) {
    const hit = await matchByIdentifiers(db, ids, input.kind)
    if (hit) return { entityId: hit.entityId, status: 'matched', confidence: 1, via: 'identifier' }
    // Identifier supplied but unknown: for identifier-keyed kinds this is a new entity, never a fuzzy hit.
    if (IDENTIFIER_KINDS[input.kind]) return { entityId: null, status: 'unmatched', confidence: null, via: 'none' }
  }
  if (!input.rawName?.trim()) return { entityId: null, status: 'unmatched', confidence: null, via: 'none' }
  const candidates = await fuzzyMatch(db, input.rawName, { kind: input.kind })
  for (const best of candidates) {
    // A candidate carrying a *different* value for a supplied identifier scheme is a different entity.
    if (Object.keys(ids).length) {
      const row = await db.one<{ identifiers: Record<string, string> }>(`select identifiers from entity where id = $1`, [best.id])
      const conflict = Object.entries(ids).some(([k, v]) => row?.identifiers?.[k] != null && row.identifiers[k] !== v)
      if (conflict) continue
    }
    let status = autoMatchThreshold(best.confidence)
    // Identifier-keyed kinds matched by name alone need an exact normalized match.
    if (IDENTIFIER_KINDS[input.kind] && best.confidence < 1) status = 'review'
    if (status === 'matched') {
      // Merged entities stay matchable by their old names; resolve to the survivor.
      return { entityId: await followMerge(db, best.id), status, confidence: best.confidence, via: 'fuzzy', candidate: best }
    }
    return { entityId: null, status, confidence: best.confidence, via: 'fuzzy', candidate: best }
  }
  return { entityId: null, status: 'unmatched', confidence: null, via: 'none' }
}

// ---------------------------------------------------------------- legacy compatibility shims

/** @deprecated use matchByIdentifiers(db, { ein, sec_cik, dcca, fec_id }, 'org') */
export async function matchOrganizationByExternalId(
  db: Db,
  ids: { ein?: string | null; sec_cik?: string | null; dcca_file_number?: string | null; fec_committee_id?: string | null }
): Promise<{ orgId: string; confidence: number } | null> {
  const hit = await matchByIdentifiers(db, { ein: ids.ein, sec_cik: ids.sec_cik, dcca: ids.dcca_file_number, fec_id: ids.fec_committee_id }, 'org')
  return hit ? { orgId: hit.entityId, confidence: 1 } : null
}
