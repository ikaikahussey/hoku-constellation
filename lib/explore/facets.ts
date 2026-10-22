import type { Db } from '@/lib/db/types'
import { countEntities, entityFacetCounts } from '@/lib/db/queries/entities'
import { humanize, roleOptions } from '@/lib/entity-roles'
import { filtersToListOptions, islandKey, islandLabel, ISLANDS, type ExploreFacets, type ExploreFilters, type FacetOption } from './filters'

function byCountThenLabel(a: FacetOption, b: FacetOption): number {
  return b.count - a.count || a.label.localeCompare(b.label)
}

function plainOptions(counts: Map<string, number>): FacetOption[] {
  return [...counts.entries()].map(([value, count]) => ({ value, label: humanize(value), count })).sort(byCountThenLabel)
}

function islandOptions(counts: Map<string, number>): FacetOption[] {
  const merged = new Map<string, number>()
  for (const [raw, c] of counts) { const k = islandKey(raw); merged.set(k, (merged.get(k) ?? 0) + c) }
  const order = (k: string) => { const i = ISLANDS.findIndex(x => x.key === k); return i < 0 ? ISLANDS.length : i }
  return [...merged.entries()]
    .map(([value, count]) => ({ value, label: islandLabel(value), count }))
    .sort((a, b) => order(a.value) - order(b.value) || a.label.localeCompare(b.label))
}

/**
 * Options and counts for every filter. Each facet is counted under all the other active filters
 * (its own filter is left out), so the counts say how many results choosing that option would give.
 */
export async function exploreFacets(db: Db, f: ExploreFilters): Promise<ExploreFacets> {
  const person = await countEntities(db, filtersToListOptions({ ...f, kind: 'person' }))
  const org = await countEntities(db, filtersToListOptions({ ...f, kind: 'org' }))
  const role = await entityFacetCounts(db, 'entity_types', { ...filtersToListOptions(f, 'role'), kind: 'person' })
  const orgType = await entityFacetCounts(db, 'org_type', { ...filtersToListOptions(f, 'orgType'), kind: 'org' })
  const sector = await entityFacetCounts(db, 'sector', { ...filtersToListOptions(f, 'sector'), kind: 'org' })
  const island = await entityFacetCounts(db, 'island', filtersToListOptions(f, 'island'))
  const status = await entityFacetCounts(db, 'status', filtersToListOptions(f, 'status'))
  return {
    kind: { person, org },
    role: roleOptions(role),
    orgType: plainOptions(orgType),
    sector: plainOptions(sector),
    island: islandOptions(island),
    status: plainOptions(status),
  }
}
