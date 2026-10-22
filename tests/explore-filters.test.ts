import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from './helpers/pglite'
import { listEntities, entityFacetCounts, entityTagGroupCounts } from '@/lib/db/queries/entities'
import { exploreUrl, filtersToListOptions, islandKey, parseExploreFilters, sortToOrderBy, toggle } from '@/lib/explore/filters'
import { exploreFacets } from '@/lib/explore/facets'
import { normalizeToken, tagLabel, tagsForToken, tagTree, tokenLabel, visibleTags, TAG_TAXONOMY } from '@/lib/entity-tags'

let db: TestDb

beforeAll(async () => {
  db = await createTestDb()
  await db.exec(`
    insert into entity (kind, name, aliases, attributes) values
      ('person', 'Josh Green',      '{"Green, Josh"}', '{"slug":"josh-green","entity_types":["person","elected_official","donor"],"office_held":"Governor","island":"Oahu","status":"active"}'),
      ('person', 'Pat Hopeful',     '{}', '{"slug":"pat-hopeful","entity_types":["person","candidate","lobbyist","donor"],"island":"Maui","status":"active"}'),
      ('person', 'Casey Candidate', '{}', '{"slug":"casey-candidate","entity_types":["person","candidate"],"island":"Oʻahu","status":"Active"}'),
      ('person', 'Lee Lobby',       '{}', '{"slug":"lee-lobby","entity_types":["person","lobbyist"],"island":"Kauai","status":"inactive"}'),
      ('person', 'Rep Seat',        '{}', '{"slug":"rep-seat","entity_types":["person","legislator","zz_custom"]}'),
      ('org', 'Hawaiian Electric',  '{"HECO"}', '{"slug":"hawaiian-electric","entity_types":["donor","contractor"],"org_type":"corporation","sector":"Energy","island":"Oahu","status":"active"}'),
      ('org', 'Kōkua Fund',         '{}', '{"slug":"kokua-fund","org_type":"nonprofit","sector":"Real Estate","island":"Big Island"}'),
      ('org', 'Merged Co',          '{}', '{"slug":"merged-co","entity_types":["donor"],"org_type":"corporation"}'),
      ('bill', 'SB1 (2026)',        '{}', '{}');
    update entity set merged_into_id = (select id from entity where name = 'Hawaiian Electric') where name = 'Merged Co';
  `)
})
afterAll(async () => { await db.end() })

const names = (rows: { name: string }[]) => rows.map(r => r.name).sort()
const list = async (qs: Record<string, string | string[]>) => {
  const f = parseExploreFilters(qs)
  return names((await listEntities(db, { ...filtersToListOptions(f), orderBy: sortToOrderBy(f.sort), limit: 500 })).rows)
}

describe('tag taxonomy', () => {
  it('labels the legacy elected_official tag without implying election', () => {
    expect(tagLabel('elected_official')).toBe('Candidate or officeholder')
    expect(tokenLabel('politics')).toBe('Politics & government')
    expect(tagLabel('some_new_tag')).toBe('Some new tag')
  })
  it('expands a branch to its tags, keeps a tag as itself, and maps legacy tokens', () => {
    expect(tagsForToken('politics')).toEqual(['candidate', 'elected_official', 'legislator', 'appointed_official'])
    expect(tagsForToken('lobbyist')).toEqual(['lobbyist'])
    expect(normalizeToken('political')).toBe('politics')
  })
  it('every tag appears in exactly one branch', () => {
    const keys = TAG_TAXONOMY.flatMap(b => b.tags.map(t => t.key))
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('orders visible tags by taxonomy and drops kind restatements', () => {
    expect(visibleTags(['person', 'zz', 'donor', 'candidate', 'donor'])).toEqual(['candidate', 'donor', 'zz'])
    expect(visibleTags('nope')).toEqual([])
  })
  it('builds a tree with overlap-aware branch counts and keeps selected empties', () => {
    const tree = tagTree(new Map([['candidate', 2], ['elected_official', 1], ['donor', 3], ['zz_custom', 1]]), new Map([['politics', 2], ['influence', 3], ['business', 0], ['civic', 0]]), ['labor_leader'])
    expect(tree.map(b => [b.value, b.count])).toEqual([['politics', 2], ['influence', 3], ['civic', 0], ['other', -1]])
    expect(tree[0].tags.map(t => t.value)).toEqual(['candidate', 'elected_official'])
    expect(tree[2].tags).toEqual([{ value: 'labor_leader', label: 'Labor leader', count: 0 }])
    expect(tree[3].tags).toEqual([{ value: 'zz_custom', label: 'Zz custom', count: 1 }])
  })
})

describe('explore filters', () => {
  it('lists every unmerged person and organization by default, never bills', async () => {
    expect(await list({})).toEqual(['Casey Candidate', 'Hawaiian Electric', 'Josh Green', 'Kōkua Fund', 'Lee Lobby', 'Pat Hopeful', 'Rep Seat'])
  })
  it('tags are not exclusive: one entity matches several tags, and tags apply to organizations', async () => {
    expect(await list({ tag: 'donor' })).toEqual(['Hawaiian Electric', 'Josh Green', 'Pat Hopeful'])
    expect(await list({ tag: 'lobbyist' })).toEqual(['Lee Lobby', 'Pat Hopeful'])
  })
  it('match=any ORs selected tags; match=all ANDs them', async () => {
    expect(await list({ tag: ['lobbyist', 'donor'] })).toEqual(['Hawaiian Electric', 'Josh Green', 'Lee Lobby', 'Pat Hopeful'])
    expect(await list({ tag: ['lobbyist', 'donor'], match: 'all' })).toEqual(['Pat Hopeful'])
    expect(await list({ tag: 'lobbyist,donor', match: 'all' })).toEqual(['Pat Hopeful'])
  })
  it('a branch token matches any tag in the branch, also under match=all', async () => {
    expect(await list({ tag: 'politics' })).toEqual(['Casey Candidate', 'Josh Green', 'Pat Hopeful', 'Rep Seat'])
    expect(await list({ tag: ['politics', 'donor'], match: 'all' })).toEqual(['Josh Green', 'Pat Hopeful'])
    expect(await list({ role: 'political' })).toEqual(await list({ tag: 'politics' }))
  })
  it('multi-selects islands, statuses, org types, and sectors as OR within a facet', async () => {
    expect(islandKey('Big Island')).toBe('hawaii')
    expect(await list({ island: ['maui', 'kauai'] })).toEqual(['Lee Lobby', 'Pat Hopeful'])
    expect(await list({ island: 'oahu' })).toEqual(['Casey Candidate', 'Hawaiian Electric', 'Josh Green'])
    expect(await list({ status: ['inactive', 'active'], tag: 'candidate' })).toEqual(['Casey Candidate', 'Pat Hopeful'])
    expect(await list({ orgType: ['nonprofit', 'corporation'] })).toEqual(['Hawaiian Electric', 'Kōkua Fund'])
    expect(await list({ sector: 'Real Estate' })).toEqual(['Kōkua Fund'])
  })
  it('combines facets with AND across facets', async () => {
    expect(await list({ tag: 'donor', island: 'oahu' })).toEqual(['Hawaiian Electric', 'Josh Green'])
    expect(await list({ tag: 'donor', orgType: 'corporation' })).toEqual(['Hawaiian Electric'])
    expect(await list({ kind: 'person', orgType: 'corporation' })).toEqual([])
  })
  it('matches names and aliases', async () => {
    expect(await list({ q: 'heco' })).toEqual(['Hawaiian Electric'])
  })
  it('round-trips through the URL', () => {
    const f = parseExploreFilters({ q: 'green', kind: 'person', tag: ['politics', 'donor'], match: 'all', island: ['Oʻahu', 'oahu', 'Maui'], sort: 'added', page: '3' })
    expect(f).toMatchObject({ tags: ['politics', 'donor'], islands: ['oahu', 'maui'], page: 3 })
    expect(exploreUrl(f)).toBe('/explore?q=green&kind=person&tag=politics&tag=donor&match=all&island=oahu&island=maui&sort=added')
    expect(parseExploreFilters(new URLSearchParams(exploreUrl(f).split('?')[1]).entries().reduce((acc, [k, v]) => {
      const cur = acc[k]; acc[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v]; return acc
    }, {} as Record<string, string | string[]>))).toEqual({ ...f, page: 1 })
    expect(exploreUrl(f, { tags: ['donor'] })).not.toContain('match=all') // match only matters with 2+ tags
    expect(parseExploreFilters({ kind: 'nonsense', sort: 'x', page: '-4', match: 'x' })).toMatchObject({ kind: null, sort: 'name', page: 1, match: 'any' })
    expect(toggle(['a', 'b'], 'a')).toEqual(['b'])
    expect(toggle(['a'], 'b')).toEqual(['a', 'b'])
  })
})

describe('explore facets', () => {
  it('counts tag groups by overlap, not by sum', async () => {
    const counts = await entityTagGroupCounts(db, { influence: ['donor', 'lobbyist', 'contractor'] }, { kind: ['person', 'org'] })
    expect(counts.get('influence')).toBe(4) // Green, Hopeful, Lobby, HECO — Hopeful counted once
    expect(Object.fromEntries(await entityFacetCounts(db, 'sector', { kind: 'org' }))).toEqual({ energy: 1, real_estate: 1 })
  })
  it('in match=any, tag counts ignore the tag selection; other facets respect it', async () => {
    const facets = await exploreFacets(db, parseExploreFilters({ tag: 'lobbyist', island: 'maui' }))
    const influence = facets.tags.find(b => b.value === 'influence')!
    expect(influence.tags.map(t => [t.value, t.count])).toEqual([['donor', 1], ['lobbyist', 1]])
    expect(facets.islands.map(o => [o.value, o.count])).toEqual([['maui', 1], ['kauai', 1]])
    expect(facets.kind).toEqual({ person: 1, org: 0 })
  })
  it('in match=all, tag counts are within the current results', async () => {
    const facets = await exploreFacets(db, parseExploreFilters({ tag: ['donor', 'politics'], match: 'all' }))
    const all = facets.tags.flatMap(b => b.tags)
    expect(Object.fromEntries(all.map(t => [t.value, t.count]))).toMatchObject({ donor: 2, candidate: 1, elected_official: 1, lobbyist: 1 })
  })
})
