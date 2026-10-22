import type { Db } from '@/lib/db/types'
import { countEntities, entityFacetCounts, entityTagGroupCounts } from '@/lib/db/queries/entities'
import { humanize, TAG_TAXONOMY, tagTree } from '@/lib/entity-tags'
import { filtersToListOptions, islandKey, islandLabel, ISLANDS, type ExploreFacets, type ExploreFilters, type FacetOption } from './filters'

function byCountThenLabel(a: FacetOption, b: FacetOption): number {
  return b.count - a.count || a.label.localeCompare(b.label)
}

/** Count map → options, keeping selected values that currently have no matches. */
function plainOptions(counts: Map<string, number>, selected: readonly string[], label: (v: string) => string = humanize): FacetOption[] {
  const opts = [...counts.entries()].map(([value, count]) => ({ value, label: label(value), count }))
  for (const s of selected) if (!counts.has(s)) opts.push({ value: s, label: label(s), count: 0 })
  return opts.sort(byCountThenLabel)
}

function islandOptions(counts: Map<string, number>, selected: readonly string[]): FacetOption[] {
  const merged = new Map<string, number>()
  for (const [raw, c] of counts) { const k = islandKey(raw); merged.set(k, (merged.get(k) ?? 0) + c) }
  for (const s of selected) if (!merged.has(s)) merged.set(s, 0)
  const order = (k: string) => { const i = ISLANDS.findIndex(x => x.key === k); return i < 0 ? ISLANDS.length : i }
  return [...merged.entries()]
    .map(([value, count]) => ({ value, label: islandLabel(value), count }))
    .sort((a, b) => order(a.value) - order(b.value) || a.label.localeCompare(b.label))
}

const BRANCH_GROUPS = Object.fromEntries(TAG_TAXONOMY.map(b => [b.key, b.tags.map(t => t.key)]))

/**
 * Options and counts for every filter. Within a facet, options are OR'd, so each facet is counted with
 * its own selection left out: a count is how many results that option alone would add. Tags in
 * "match all" mode are AND'd, so their counts keep the tag selection: a count is how many current
 * results also carry that tag.
 */
export async function exploreFacets(db: Db, f: ExploreFilters): Promise<ExploreFacets> {
  const tagBase = filtersToListOptions(f, f.match === 'all' ? undefined : 'tags')
  const person = await countEntities(db, filtersToListOptions({ ...f, kind: 'person' }))
  const org = await countEntities(db, filtersToListOptions({ ...f, kind: 'org' }))
  const tagCounts = await entityFacetCounts(db, 'entity_types', tagBase)
  const branchCounts = await entityTagGroupCounts(db, BRANCH_GROUPS, tagBase)
  const orgType = await entityFacetCounts(db, 'org_type', { ...filtersToListOptions(f, 'orgTypes'), kind: 'org' })
  const sector = await entityFacetCounts(db, 'sector', { ...filtersToListOptions(f, 'sectors'), kind: 'org' })
  const island = await entityFacetCounts(db, 'island', filtersToListOptions(f, 'islands'))
  const status = await entityFacetCounts(db, 'status', filtersToListOptions(f, 'statuses'))
  return {
    kind: { person, org },
    tags: tagTree(tagCounts, branchCounts, f.tags),
    orgTypes: plainOptions(orgType, f.orgTypes),
    sectors: plainOptions(sector, f.sectors),
    islands: islandOptions(island, f.islands),
    statuses: plainOptions(status, f.statuses),
  }
}
