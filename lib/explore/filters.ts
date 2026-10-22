import type { EntityKind } from '@/lib/db/types'
import { foldToken, type ListEntitiesOptions } from '@/lib/db/queries/entities'
import { normalizeToken, tagsForToken, type TagTreeBranch } from '@/lib/entity-tags'

/**
 * /explore filter state. Every filter is a query-string parameter so any view is a shareable URL.
 * Multi-value filters repeat the parameter (`tag=lobbyist&tag=donor`); comma lists are also accepted.
 *   q       name or alias contains
 *   kind    person | org (omitted = both)
 *   tag     tags or taxonomy branches (lib/entity-tags.ts); `role` is accepted as a legacy alias
 *   match   any (default) | all — whether an entity needs any or every selected tag
 *   orgType org.attributes.org_type (folded), any of
 *   sector  org.attributes.sector (folded), any of
 *   island  canonical island keys, any of
 *   status  attributes.status, any of
 *   sort    name (default) | updated | added
 *   page    1-based
 */
export type ExploreKind = 'person' | 'org'
export type ExploreSort = 'name' | 'updated' | 'added'
export type TagMatch = 'any' | 'all'

export interface ExploreFilters {
  q: string
  kind: ExploreKind | null
  tags: string[]
  match: TagMatch
  orgTypes: string[]
  sectors: string[]
  islands: string[]
  statuses: string[]
  sort: ExploreSort
  page: number
}

export type FilterKey = 'tags' | 'orgTypes' | 'sectors' | 'islands' | 'statuses'
export const MULTI_KEYS: readonly FilterKey[] = ['tags', 'orgTypes', 'sectors', 'islands', 'statuses']

export interface FacetOption { value: string; label: string; count: number }

export interface ExploreFacets {
  kind: { person: number; org: number }
  tags: TagTreeBranch[]
  orgTypes: FacetOption[]
  sectors: FacetOption[]
  islands: FacetOption[]
  statuses: FacetOption[]
}

export const EXPLORE_PAGE_SIZE = 50

export const ISLANDS: readonly { key: string; label: string; variants: readonly string[] }[] = [
  { key: 'oahu', label: 'Oʻahu', variants: ['oahu', 'oʻahu', 'o‘ahu', "o'ahu"] },
  { key: 'maui', label: 'Maui', variants: ['maui'] },
  { key: 'hawaii', label: 'Hawaiʻi Island', variants: ['hawaii', 'hawaiʻi', 'hawai‘i', "hawai'i", 'hawaii island', 'hawaiʻi island', 'big island'] },
  { key: 'kauai', label: 'Kauaʻi', variants: ['kauai', 'kauaʻi', 'kaua‘i', "kaua'i"] },
  { key: 'molokai', label: 'Molokaʻi', variants: ['molokai', 'molokaʻi', 'moloka‘i', "moloka'i"] },
  { key: 'lanai', label: 'Lānaʻi', variants: ['lanai', 'lānaʻi', 'lāna‘i', 'lanaʻi', "lana'i"] },
  { key: 'niihau', label: 'Niʻihau', variants: ['niihau', 'niʻihau', 'ni‘ihau', "ni'ihau"] },
  { key: 'statewide', label: 'Statewide', variants: ['statewide'] },
]

/** Lower-cased stored island value → canonical key (unknown values map to themselves). */
export function islandKey(raw: string): string {
  const v = raw.trim().toLowerCase()
  return ISLANDS.find(i => i.variants.includes(v))?.key ?? v
}

export function islandLabel(key: string): string {
  return ISLANDS.find(i => i.key === key)?.label ?? key
}

function islandVariants(key: string): string[] {
  const known = ISLANDS.find(i => i.key === key)
  return known ? [...known.variants] : [key]
}

type RawParams = Record<string, string | string[] | undefined>

function one(p: RawParams, k: string): string {
  const v = p[k]
  return (Array.isArray(v) ? v[0] : v ?? '').trim().slice(0, 200)
}

/** All values of a repeated and/or comma-separated parameter, trimmed and de-duplicated. */
function many(p: RawParams, ...keys: string[]): string[] {
  const out: string[] = []
  for (const k of keys) {
    const v = p[k]
    for (const item of Array.isArray(v) ? v : v ? [v] : []) {
      for (const part of item.split(',')) { const t = part.trim().slice(0, 100); if (t && !out.includes(t)) out.push(t) }
    }
  }
  return out.slice(0, 50)
}

const uniq = (xs: string[]) => [...new Set(xs)]

export function parseExploreFilters(p: RawParams): ExploreFilters {
  const kindRaw = one(p, 'kind')
  const kind: ExploreKind | null = kindRaw === 'person' || kindRaw === 'people' ? 'person'
    : kindRaw === 'org' || kindRaw === 'organization' || kindRaw === 'orgs' ? 'org' : null
  const sortRaw = one(p, 'sort')
  const sort: ExploreSort = sortRaw === 'updated' || sortRaw === 'added' ? sortRaw : 'name'
  const page = Number.parseInt(one(p, 'page') || '1', 10)
  return {
    q: one(p, 'q'),
    kind,
    tags: uniq(many(p, 'tag', 'role').map(normalizeToken)),
    match: one(p, 'match') === 'all' ? 'all' : 'any',
    orgTypes: uniq(many(p, 'orgType').map(foldToken)),
    sectors: uniq(many(p, 'sector').map(foldToken)),
    islands: uniq(many(p, 'island').map(islandKey)),
    statuses: uniq(many(p, 'status').map(s => s.toLowerCase())),
    sort,
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  }
}

/** Tag tokens → `listEntities` tag options for the match mode. */
export function tagOptions(tokens: string[], match: TagMatch): Pick<ListEntitiesOptions, 'entityTypes' | 'tagClauses'> {
  if (!tokens.length) return {}
  if (match === 'all') return { tagClauses: tokens.map(tagsForToken) }
  return { entityTypes: uniq(tokens.flatMap(tagsForToken)) }
}

/**
 * `listEntities` options for the filters, optionally leaving one facet out (for that facet's counts).
 * Tags apply to people and organizations alike. Org-type and sector filters apply to organizations only,
 * so choosing one narrows the kind.
 */
export function filtersToListOptions(f: ExploreFilters, omit?: FilterKey): ListEntitiesOptions {
  const on = (k: FilterKey) => k !== omit
  let kinds: EntityKind[] = f.kind ? [f.kind] : ['person', 'org']
  if ((on('orgTypes') && f.orgTypes.length) || (on('sectors') && f.sectors.length)) kinds = kinds.filter(k => k === 'org')
  return {
    kind: kinds, // empty when kind=person is combined with an org-only filter: no results
    q: f.q || undefined,
    ...(on('tags') ? tagOptions(f.tags, f.match) : {}),
    orgType: on('orgTypes') && f.orgTypes.length ? f.orgTypes : undefined,
    sector: on('sectors') && f.sectors.length ? f.sectors : undefined,
    island: on('islands') && f.islands.length ? f.islands.flatMap(islandVariants) : undefined,
    status: on('statuses') && f.statuses.length ? f.statuses : undefined,
  }
}

export function sortToOrderBy(s: ExploreSort): 'name' | 'updated_at' | 'created_at' {
  return s === 'updated' ? 'updated_at' : s === 'added' ? 'created_at' : 'name'
}

/** URL for a filter state with `patch` applied; changing any filter resets the page. */
export function exploreUrl(f: ExploreFilters, patch: Partial<ExploreFilters> = {}): string {
  const next = { ...f, ...patch }
  if (!('page' in patch)) next.page = 1
  const sp = new URLSearchParams()
  if (next.q) sp.set('q', next.q)
  if (next.kind) sp.set('kind', next.kind)
  for (const t of next.tags) sp.append('tag', t)
  if (next.match === 'all' && next.tags.length > 1) sp.set('match', 'all')
  for (const v of next.orgTypes) sp.append('orgType', v)
  for (const v of next.sectors) sp.append('sector', v)
  for (const v of next.islands) sp.append('island', v)
  for (const v of next.statuses) sp.append('status', v)
  if (next.sort !== 'name') sp.set('sort', next.sort)
  if (next.page > 1) sp.set('page', String(next.page))
  const qs = sp.toString()
  return qs ? `/explore?${qs}` : '/explore'
}

/** `values` with `value` added or removed. */
export function toggle(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter(v => v !== value) : [...values, value]
}

export function hasActiveFilters(f: ExploreFilters): boolean {
  return !!(f.q || f.kind || f.tags.length || f.orgTypes.length || f.sectors.length || f.islands.length || f.statuses.length)
}
