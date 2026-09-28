import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from './helpers/pglite'
import { listEntities, countEntities, foldToken } from '@/lib/db/queries/entities'
import { EXPLORE_CATEGORIES, categoriesInGroup, categoryListOptions, exploreHref, getExploreCategory } from '@/lib/explore/categories'

let db: TestDb

beforeAll(async () => {
  db = await createTestDb()
  await db.exec(`
    insert into entity (kind, name, attributes) values
      ('person', 'Josh Green',    '{"slug":"josh-green","entity_types":["person","elected_official"],"office_held":"Governor","island":"Oahu"}'),
      ('person', 'Rick Blangiardi','{"slug":"rick-blangiardi","entity_types":["person","elected_official"],"office_held":"Mayor, City and County of Honolulu","island":"Oahu"}'),
      ('person', 'Leo Asuncion',  '{"slug":"leo-asuncion","entity_types":["person","appointed_official"],"office_held":"Chair, Public Utilities Commission","island":"Oʻahu"}'),
      ('person', 'Merged Person', '{"slug":"merged","entity_types":["person","elected_official"]}'),
      ('org', 'Hawaiian Electric', '{"slug":"hawaiian-electric","org_type":"corporation","sector":"Energy","island":"Oahu"}'),
      ('org', 'Alexander & Baldwin','{"slug":"alexander-baldwin","org_type":"corporation","sector":"real_estate","island":"Maui"}'),
      ('org', 'Kauaʻi Realty',      '{"slug":"kauai-realty","org_type":"corporation","sector":"Real-Estate","island":"Kauai"}'),
      ('org', 'Sector-less Org',    '{"slug":"no-sector","org_type":"nonprofit"}'),
      ('org', 'Hawaii Gas',         '{"slug":"hawaii-gas","org_type":"corporation","sector":"Electric Services","island":"Oʻahu"}');
    update entity set merged_into_id = (select id from entity where name = 'Josh Green') where name = 'Merged Person';
  `)
})
afterAll(async () => { await db.end() })

const names = (rows: { name: string }[]) => rows.map(r => r.name).sort()

describe('listEntities attribute filters', () => {
  it('filters people by entity_types and excludes merged rows', async () => {
    const { rows, total } = await listEntities(db, { kind: 'person', entityTypes: ['elected_official'], orderBy: 'name' })
    expect(names(rows)).toEqual(['Josh Green', 'Rick Blangiardi'])
    expect(total).toBe(2)
  })
  it('filters by office_held patterns case-insensitively', async () => {
    expect(names((await listEntities(db, { kind: 'person', officeHeldLike: ['%mayor%'] })).rows)).toEqual(['Rick Blangiardi'])
    expect(names((await listEntities(db, { kind: 'person', officeHeldLike: ['%public utilities commission%', '%puc %'] })).rows)).toEqual(['Leo Asuncion'])
  })
  it('folds sector spelling variants', async () => {
    expect(foldToken('Real Estate')).toBe('real_estate')
    expect(foldToken('real-estate')).toBe('real_estate')
    expect(names((await listEntities(db, { kind: 'org', sector: 'real_estate' })).rows)).toEqual(['Alexander & Baldwin', 'Kauaʻi Realty'])
    expect(names((await listEntities(db, { kind: 'org', sector: 'energy' })).rows)).toEqual(['Hawaiian Electric'])
    expect(names((await listEntities(db, { kind: 'org', sector: ['energy', 'electric services'] })).rows)).toEqual(['Hawaii Gas', 'Hawaiian Electric'])
    expect(await countEntities(db, { kind: 'org', sector: ['energy', 'electric services'] })).toBe(2)
  })
  it('filters by island across kinds and accepts spelling variants', async () => {
    const { rows } = await listEntities(db, { kind: ['person', 'org'], island: ['Oahu', 'Oʻahu'], orderBy: 'name' })
    expect(names(rows)).toEqual(['Hawaii Gas', 'Hawaiian Electric', 'Josh Green', 'Leo Asuncion', 'Rick Blangiardi'])
  })
  it('paginates with a stable total', async () => {
    const first = await listEntities(db, { kind: ['person', 'org'], island: ['Oahu', 'Oʻahu'], orderBy: 'name', limit: 3, offset: 0 })
    const second = await listEntities(db, { kind: ['person', 'org'], island: ['Oahu', 'Oʻahu'], orderBy: 'name', limit: 3, offset: 3 })
    expect(first.rows).toHaveLength(3)
    expect(second.rows).toHaveLength(2)
    expect(first.total).toBe(5)
    expect(second.total).toBe(5)
  })
})

describe('explore categories', () => {
  it('has unique URL-safe slugs and a path under /explore', () => {
    const slugs = EXPLORE_CATEGORIES.map(c => c.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(exploreHref(slug)).toBe(`/explore/${slug}`)
    }
    expect(getExploreCategory('no-such-category')).toBeNull()
  })
  it('covers every group shown on the explore page', () => {
    expect(categoriesInGroup('office').map(c => c.slug)).toEqual(['elected-officials', 'appointed-officials', 'county-mayors', 'puc-commissioners'])
    expect(categoriesInGroup('sector')).toHaveLength(6)
    expect(categoriesInGroup('island').map(c => c.slug)).toEqual(['oahu', 'maui', 'hawaii-island', 'kauai'])
  })
  it('each category resolves to the expected seeded entities', async () => {
    const expected: Record<string, string[]> = {
      'elected-officials': ['Josh Green', 'Rick Blangiardi'],
      'appointed-officials': ['Leo Asuncion'],
      'county-mayors': ['Rick Blangiardi'],
      'puc-commissioners': ['Leo Asuncion'],
      energy: ['Hawaii Gas', 'Hawaiian Electric'],
      'real-estate': ['Alexander & Baldwin', 'Kauaʻi Realty'],
      healthcare: [], tourism: [], construction: [], finance: [],
      oahu: ['Hawaii Gas', 'Hawaiian Electric', 'Josh Green', 'Leo Asuncion', 'Rick Blangiardi'],
      maui: ['Alexander & Baldwin'],
      'hawaii-island': [],
      kauai: ['Kauaʻi Realty'],
    }
    for (const c of EXPLORE_CATEGORIES) {
      const { rows, total } = await listEntities(db, { ...categoryListOptions(c), orderBy: 'name' })
      expect(names(rows), c.slug).toEqual(expected[c.slug])
      expect(await countEntities(db, categoryListOptions(c)), c.slug).toBe(total)
    }
  })
})
