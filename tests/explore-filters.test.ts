import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from './helpers/pglite'
import { listEntities, entityFacetCounts } from '@/lib/db/queries/entities'
import { exploreUrl, filtersToListOptions, islandKey, parseExploreFilters, sortToOrderBy } from '@/lib/explore/filters'
import { exploreFacets } from '@/lib/explore/facets'
import { roleLabel, roleOptions, tagLabel, tagsForRole } from '@/lib/entity-roles'

let db: TestDb

beforeAll(async () => {
  db = await createTestDb()
  await db.exec(`
    insert into entity (kind, name, aliases, attributes) values
      ('person', 'Josh Green',      '{"Green, Josh"}', '{"slug":"josh-green","entity_types":["person","elected_official"],"office_held":"Governor","island":"Oahu","status":"active"}'),
      ('person', 'Pat Hopeful',     '{}', '{"slug":"pat-hopeful","entity_types":["person","elected_official"],"island":"Maui","status":"active"}'),
      ('person', 'Casey Candidate', '{}', '{"slug":"casey-candidate","entity_types":["person","candidate"],"island":"Oʻahu","status":"active"}'),
      ('person', 'Lee Lobby',       '{}', '{"slug":"lee-lobby","entity_types":["person","lobbyist"],"island":"Kauai","status":"inactive"}'),
      ('person', 'Rep Seat',        '{}', '{"slug":"rep-seat","entity_types":["person","legislator"]}'),
      ('org', 'Hawaiian Electric',  '{"HECO"}', '{"slug":"hawaiian-electric","org_type":"corporation","sector":"Energy","island":"Oahu","status":"active"}'),
      ('org', 'Kōkua Fund',         '{}', '{"slug":"kokua-fund","org_type":"nonprofit","sector":"Real Estate","island":"Big Island"}'),
      ('org', 'Merged Co',          '{}', '{"slug":"merged-co","org_type":"corporation"}'),
      ('bill', 'SB1 (2026)',        '{}', '{}');
    update entity set merged_into_id = (select id from entity where name = 'Hawaiian Electric') where name = 'Merged Co';
  `)
})
afterAll(async () => { await db.end() })

const names = (rows: { name: string }[]) => rows.map(r => r.name).sort()
const list = async (qs: Record<string, string>) => {
  const f = parseExploreFilters(qs)
  return names((await listEntities(db, { ...filtersToListOptions(f), orderBy: sortToOrderBy(f.sort), limit: 500 })).rows)
}

describe('role labels', () => {
  it('labels the legacy elected_official tag so it does not claim election', () => {
    expect(tagLabel('elected_official')).toBe('Candidate or officeholder')
    expect(roleLabel('political')).toBe('Candidates & officeholders')
  })
  it('expands the political group and legacy tag links to every political tag', () => {
    expect(tagsForRole('political').sort()).toEqual(['candidate', 'elected_official', 'legislator'])
    expect(tagsForRole('elected_official').sort()).toEqual(['candidate', 'elected_official', 'legislator'])
    expect(tagsForRole('some_new_tag')).toEqual(['some_new_tag'])
  })
  it('folds tag counts into grouped options and keeps unknown tags', () => {
    const opts = roleOptions(new Map([['person', 9], ['elected_official', 2], ['candidate', 1], ['lobbyist', 1], ['zz_custom', 1]]))
    expect(opts).toEqual([
      { value: 'political', label: 'Candidates & officeholders', count: 3 },
      { value: 'lobbyist', label: 'Lobbyists', count: 1 },
      { value: 'zz_custom', label: 'Zz custom', count: 1 },
    ])
  })
})

describe('explore filters', () => {
  it('lists every unmerged person and organization by default, never bills', async () => {
    expect(await list({})).toEqual(['Casey Candidate', 'Hawaiian Electric', 'Josh Green', 'Kōkua Fund', 'Lee Lobby', 'Pat Hopeful', 'Rep Seat'])
  })
  it('filters by kind', async () => {
    expect(await list({ kind: 'org' })).toEqual(['Hawaiian Electric', 'Kōkua Fund'])
    expect(await list({ kind: 'person' })).toHaveLength(5)
  })
  it('role=political includes candidates who were never elected', async () => {
    expect(await list({ role: 'political' })).toEqual(['Casey Candidate', 'Josh Green', 'Pat Hopeful', 'Rep Seat'])
  })
  it('matches names and aliases', async () => {
    expect(await list({ q: 'heco' })).toEqual(['Hawaiian Electric'])
    expect(await list({ q: 'green' })).toEqual(['Josh Green'])
  })
  it('combines island variants, org type, sector, and status', async () => {
    expect(islandKey('Big Island')).toBe('hawaii')
    expect(await list({ island: 'oahu' })).toEqual(['Casey Candidate', 'Hawaiian Electric', 'Josh Green'])
    expect(await list({ island: 'hawaii' })).toEqual(['Kōkua Fund'])
    expect(await list({ orgType: 'nonprofit' })).toEqual(['Kōkua Fund'])
    expect(await list({ sector: 'real_estate' })).toEqual(['Kōkua Fund'])
    expect(await list({ status: 'inactive' })).toEqual(['Lee Lobby'])
    expect(await list({ role: 'political', island: 'oahu' })).toEqual(['Casey Candidate', 'Josh Green'])
  })
  it('people-only and organization-only filters together return nothing', async () => {
    expect(await list({ role: 'lobbyist', orgType: 'corporation' })).toEqual([])
  })
  it('round-trips through the URL and resets the page on filter change', () => {
    const f = parseExploreFilters({ q: 'green', kind: 'person', role: 'political', island: 'Oʻahu', sort: 'added', page: '3' })
    expect(f).toMatchObject({ island: 'oahu', page: 3 })
    expect(exploreUrl(f)).toBe('/explore?q=green&kind=person&role=political&island=oahu&sort=added')
    expect(exploreUrl(f, { page: 2 })).toContain('page=2')
    expect(parseExploreFilters({ kind: 'nonsense', sort: 'x', page: '-4' })).toMatchObject({ kind: null, sort: 'name', page: 1 })
  })
})

describe('explore facets', () => {
  it('counts raw facet values', async () => {
    const sectors = await entityFacetCounts(db, 'sector', { kind: 'org' })
    expect(Object.fromEntries(sectors)).toEqual({ energy: 1, real_estate: 1 })
  })
  it('counts each facet under the other filters only', async () => {
    const f = parseExploreFilters({ role: 'political', island: 'oahu' })
    const facets = await exploreFacets(db, f)
    expect(facets.kind).toEqual({ person: 2, org: 0 })
    // role options ignore the role filter but respect the island filter
    expect(facets.role).toEqual([{ value: 'political', label: 'Candidates & officeholders', count: 2 }])
    // island options ignore the island filter but respect the role filter
    expect(facets.island.map(o => [o.value, o.count])).toEqual([['oahu', 2], ['maui', 1]])
  })
})
