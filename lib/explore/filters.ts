import type { EntityKind } from '@/lib/db/types'
import type { ListEntitiesOptions } from '@/lib/db/queries/entities'
import { tagsForRole } from '@/lib/entity-roles'

/**
 * /explore filter state. Every filter is a query-string parameter so any view is a shareable URL.
 *   q       name or alias contains
 *   kind    person | org (omitted = both)
 *   role    person role group key or raw entity_types tag (lib/entity-roles.ts)
 *   orgType org.attributes.org_type (folded)
 *   sector  org.attributes.sector (folded)
 *   island  canonical island key (oahu, maui, hawaii, kauai, molokai, lanai, niihau, statewide) or a raw value
 *   status  attributes.status
 *   sort    name (default) | updated | added
 *   page    1-based
 */
export type ExploreKind = 'person' | 'org'
export type ExploreSort = 'name' | 'updated' | 'added'

export interface ExploreFilters {
  q: string
  kind: ExploreKind | null
  role: string
  orgType: string
  sector: string
  island: string
  status: string
  sort: ExploreSort
  page: number
}

export const FILTER_KEYS = ['q', 'kind', 'role', 'orgType', 'sector', 'island', 'status', 'sort', 'page'] as const
export type FilterKey = (typeof FILTER_KEYS)[number]

export interface FacetOption { value: string; label: string; count: number }

export interface ExploreFacets {
  kind: { person: number; org: number }
  role: FacetOption[]
  orgType: FacetOption[]
  sector: FacetOption[]
  island: FacetOption[]
  status: FacetOption[]
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
    role: one(p, 'role'),
    orgType: one(p, 'orgType'),
    sector: one(p, 'sector'),
    island: one(p, 'island') ? islandKey(one(p, 'island')) : '',
    status: one(p, 'status').toLowerCase(),
    sort,
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  }
}

/**
 * `listEntities` options for the filters. Role filters apply to people only and org-type/sector filters to
 * organizations only, so choosing one narrows the kind.
 */
export function filtersToListOptions(f: ExploreFilters, omit?: FilterKey): ListEntitiesOptions {
  const on = (k: FilterKey) => k !== omit
  let kinds: EntityKind[] = f.kind ? [f.kind] : ['person', 'org']
  if (on('role') && f.role) kinds = kinds.filter(k => k === 'person')
  if ((on('orgType') && f.orgType) || (on('sector') && f.sector)) kinds = kinds.filter(k => k === 'org')
  return {
    kind: kinds, // empty when people-only and org-only filters are combined: no results
    q: f.q || undefined,
    entityTypes: on('role') && f.role ? tagsForRole(f.role) : undefined,
    orgType: on('orgType') && f.orgType ? [f.orgType] : undefined,
    sector: on('sector') && f.sector ? f.sector : undefined,
    island: on('island') && f.island ? islandVariants(f.island) : undefined,
    status: on('status') && f.status ? f.status : undefined,
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
  if (next.role) sp.set('role', next.role)
  if (next.orgType) sp.set('orgType', next.orgType)
  if (next.sector) sp.set('sector', next.sector)
  if (next.island) sp.set('island', next.island)
  if (next.status) sp.set('status', next.status)
  if (next.sort !== 'name') sp.set('sort', next.sort)
  if (next.page > 1) sp.set('page', String(next.page))
  const qs = sp.toString()
  return qs ? `/explore?${qs}` : '/explore'
}

export function hasActiveFilters(f: ExploreFilters): boolean {
  return !!(f.q || f.kind || f.role || f.orgType || f.sector || f.island || f.status)
}
