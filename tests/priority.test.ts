/**
 * Priority entities: name matching, the targeted csc/fec pass (fixtures, idempotent, same record keys as
 * the sweeps), cadence gating, match-review ordering, and the staff setup tool. Names are fictional.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from './helpers/pglite'
import { matchesTarget, searchTerms, targetNames, importPriorityTargets, runPriorityPassIfDue, listPriorityTargets, type PriorityFetchers, type PriorityTarget } from '@/lib/import/priority'
import { listReviewEdges, countReviewEdges } from '@/lib/db/queries'
import { resolvePrioritySpec, markPriority, clearPriority, watchForTeam, userIdForEmail, PRIORITY_WATCHLIST } from '@/lib/ops/priority'
import { createTeam } from '@/lib/teams'
import type { ScheduleA } from '@/lib/import/sources/fec'

let db: TestDb
beforeAll(async () => { db = await createTestDb() })
afterAll(async () => { await db.end() })

const KEOLA: Pick<PriorityTarget, 'kind' | 'name' | 'aliases'> = { kind: 'person', name: 'Keo Makanani', aliases: ['Keola Makanani', 'Keola K. Makanani'] }

describe('priority name matching', () => {
  it('matches first and last name across "Last, First" order, middle initials, and suffixes', () => {
    expect(matchesTarget('MAKANANI, KEOLA K', KEOLA)).toBe(true)
    expect(matchesTarget('Keola Makanani Jr.', KEOLA)).toBe(true)
    expect(matchesTarget('Makanani, Keo', KEOLA)).toBe(true)
    expect(matchesTarget('Makanani, Keoni', KEOLA)).toBe(false)   // same surname, different person
    expect(matchesTarget('Makanani', KEOLA)).toBe(false)          // surname alone is not enough
    expect(matchesTarget(null, KEOLA)).toBe(false)
  })
  it('matches organizations on the suffix-insensitive name', () => {
    const org = { kind: 'org' as const, name: 'Pākela Holdings LLC', aliases: [] }
    expect(matchesTarget('PAKELA HOLDINGS', org)).toBe(true)
    expect(matchesTarget('Pakela Holdings, Inc.', org)).toBe(true)
    expect(matchesTarget('Pakela Partners', org)).toBe(false)
  })
  it('derives search terms: surnames for full-text, LAST, FIRST for OpenFEC', () => {
    const t = { id: 'x', ...KEOLA }
    expect(searchTerms(t).surnames).toEqual(['makanani'])
    expect(searchTerms(t).fullNames.sort()).toEqual(['makanani, keo', 'makanani, keola'])
    expect(targetNames(t)).toContain('keola k makanani')
  })
})

// --------------------------------------------------------------------------- fixtures

const CSC_RESOURCE = { id: 'res-contrib', kind: 'contribution' as const, name: 'Contributions' }
const CSC_ROWS: Record<string, unknown>[] = [
  { _id: 101, 'Candidate Name': 'Lee, Mahina', 'Contributor Name': 'Makanani, Keola K', 'Contributor Type': 'Individual', Amount: '500.00', Date: '2024-05-01T00:00:00', 'Reg No': 'CC99001', Office: 'House' },
  { _id: 102, 'Candidate Name': 'Lee, Mahina', 'Contributor Name': 'Makanani, Keoni', 'Contributor Type': 'Individual', Amount: '250.00', Date: '2024-05-02T00:00:00', 'Reg No': 'CC99001', Office: 'House' },
  { _id: 103, 'Candidate Name': 'Ito, Pua', 'Contributor Name': 'Keola Makanani', 'Contributor Type': 'Individual', Amount: '1,000', Date: '2024-06-10T00:00:00', 'Reg No': 'CC99002', Office: 'Senate' },
]
const FEC_ROWS: ScheduleA[] = [
  { sub_id: '9001', committee_id: 'C00999001', contributor_name: 'MAKANANI, KEOLA', entity_type: 'IND', contribution_receipt_amount: 2900, contribution_receipt_date: '2024-03-01', committee: { name: 'Friends of Example', candidate_ids: ['S0HI00999'] } },
  { sub_id: '9002', committee_id: 'C00999001', contributor_name: 'MAKANANI, KEONI', entity_type: 'IND', contribution_receipt_amount: 100, contribution_receipt_date: '2024-03-02', committee: { name: 'Friends of Example' } },
]

function fixtures(calls: string[] = []): PriorityFetchers {
  return {
    cscResources: async () => [CSC_RESOURCE],
    cscSearch: async (id, q, offset, limit) => {
      calls.push(`csc:${id}:${q}:${offset}`)
      const hits = CSC_ROWS.filter(r => JSON.stringify(r).toLowerCase().includes(q))
      return { records: hits.slice(offset, offset + limit), total: hits.length }
    },
    fecSearch: async (name, state, cursor) => {
      calls.push(`fec:${name}:${state}:${cursor ? 'next' : 'first'}`)
      return { results: FEC_ROWS.filter(r => r.contributor_name!.toLowerCase().startsWith(name.split(',')[0])), next: null }
    },
  }
}

describe('priority import pass', () => {
  let target: PriorityTarget
  beforeAll(async () => {
    const row = await db.one<{ id: string }>(`insert into entity(kind, name, aliases, attributes) values ('person', $1, $2, '{"is_priority": true}') returning id`, [KEOLA.name, KEOLA.aliases])
    target = { id: row!.id, ...KEOLA } as PriorityTarget
  })

  it('lists flagged, unmerged persons and orgs', async () => {
    await db.query(`insert into entity(kind, name, attributes) values ('person', 'Not Flagged', '{}')`)
    expect((await listPriorityTargets(db)).map(t => t.name)).toEqual([KEOLA.name])
  })

  it('keeps only rows naming the target, keyed exactly like the sweeps, and is idempotent', async () => {
    const calls: string[] = []
    const first = await importPriorityTargets(db, { targets: [target], fetchers: fixtures(calls) })
    expect(first.errors).toBe(0)
    expect(first.documents).toBe(3) // csc 101 + 103, fec 9001; the other Makanani rows are skipped
    const docs = await db.many<{ source: string; source_record_id: string }>(`select source, source_record_id from document order by source, source_record_id`)
    expect(docs).toEqual([
      { source: 'csc', source_record_id: 'res-contrib:101' },
      { source: 'csc', source_record_id: 'res-contrib:103' },
      { source: 'fec', source_record_id: 'schedule_a:9001' },
    ])
    expect(first.perTarget.map(p => [p.source, p.matched])).toEqual([['csc', 2], ['fec', 1]])
    // csc: 3 rows returned for the surname; fec: two name forms each return both rows (4). Each counted once.
    expect(first.seen).toBe(3 + 4)
    expect(calls).toContain('fec:makanani, keola:HI:first')

    // Aliases resolve the donor side to the priority entity itself.
    const linked = await db.many(`select 1 from edge where from_id = $1`, [target.id])
    expect(linked.length).toBe(3)

    const second = await importPriorityTargets(db, { targets: [target], fetchers: fixtures() })
    expect(second.documents).toBe(0)
    expect(second.edges).toBe(0)
    expect(second.entitiesCreated).toBe(0)
  })

  it('runs at most once per cadence unless forced, and not at all with nothing flagged', async () => {
    const now = new Date('2026-09-30T00:00:00Z')
    const a = await runPriorityPassIfDue(db, { now, fetchers: fixtures() })
    expect(a?.targets).toBe(1)
    expect(await runPriorityPassIfDue(db, { now: new Date(now.getTime() + 3600e3), fetchers: fixtures() })).toBeNull()
    expect(await runPriorityPassIfDue(db, { force: true, fetchers: fixtures() })).not.toBeNull()
    expect(await runPriorityPassIfDue(db, { force: true, targets: [], fetchers: fixtures() })).toBeNull()
  })
})

describe('match review ordering', () => {
  it('puts edges naming a priority entity first, regardless of amount, and filters to them', async () => {
    const doc = await db.one<{ id: string }>(`insert into document(source, source_record_id, doc_type, raw, checksum) values ('test', 'r1', 'contribution', '{}', 'chk-review') returning id`)
    await db.query(`insert into edge(document_id, type, from_name_raw, to_name_raw, amount, match_status) values
      ($1, 'contributed_to', 'Big Donor Corp', 'Some Committee', 90000, 'review'),
      ($1, 'contributed_to', 'MAKANANI, KEOLA KALANI', 'Some Committee', 5, 'review'),
      ($1, 'contributed_to', 'Unrelated Person', 'Some Committee', 500, 'unmatched')`, [doc!.id])
    const targets = await listPriorityTargets(db)
    const priority = { ids: targets.map(t => t.id), names: targets.flatMap(targetNames) }
    const rows = (await listReviewEdges(db, { priority, limit: 50 })).filter(e => e.document_id === doc!.id)
    expect(rows.map(r => [r.from_name_raw, r.is_priority])).toEqual([
      ['MAKANANI, KEOLA KALANI', true],
      ['Big Donor Corp', false],
      ['Unrelated Person', false],
    ])
    const only = await listReviewEdges(db, { priority, priorityOnly: true, limit: 50 })
    expect(only.every(r => r.is_priority)).toBe(true)
    expect(only.some(r => r.from_name_raw === 'MAKANANI, KEOLA KALANI')).toBe(true)
    expect(await countReviewEdges(db, { priority, priorityOnly: true })).toBe(only.length)
    // Every bound parameter is referenced (real Postgres rejects unused ones; PGlite in-process does not).
    const strict = { ...db, one: async <T,>(text: string, params?: readonly unknown[]) => {
      const used = Math.max(0, ...[...text.matchAll(/\$(\d+)/g)].map(m => Number(m[1])))
      expect(used).toBe(params?.length ?? 0)
      return db.one<T>(text, params)
    } }
    expect(await countReviewEdges(strict, { priority })).toBeGreaterThanOrEqual(3)
    expect(await countReviewEdges(strict, { priority, priorityOnly: true })).toBe(only.length)
    expect(await countReviewEdges(strict, { priority, type: 'contributed_to' })).toBeGreaterThanOrEqual(3)
    // Without priority names the order is by amount, as before.
    const plain = (await listReviewEdges(db, { limit: 50 })).filter(e => e.document_id === doc!.id)
    expect(plain[0].from_name_raw).toBe('Big Donor Corp')
  })
})

describe('staff priority tool', () => {
  it('resolves by alias, reports ambiguity and missing names, and creates only when asked', async () => {
    await db.query(`insert into entity(kind, name, aliases) values ('person', 'Pualani Kekoa', '{"Pua Kekoa"}')`)
    const found = await resolvePrioritySpec(db, { kind: 'person', names: ['Pua Kekoa'] })
    expect(found).toMatchObject({ status: 'found', name: 'Pualani Kekoa' })

    await db.query(`insert into entity(kind, name) values ('person', 'Nalu Akana'), ('person', 'Nalu Akana')`)
    const dup = await resolvePrioritySpec(db, { kind: 'person', names: ['Nalu Akana'] })
    expect(dup.status).toBe('ambiguous')
    expect('candidates' in dup && dup.candidates.length).toBe(2)

    const missing = await resolvePrioritySpec(db, { kind: 'person', names: ['Iolana Zzyzx'] })
    expect(missing.status).toBe('missing')
    const created = await resolvePrioritySpec(db, { kind: 'person', names: ['Iolana Zzyzx', 'Lana Zzyzx'] }, { create: true })
    expect(created.status).toBe('created')
    const row = await db.one<{ aliases: string[] }>(`select aliases from entity where id = $1`, ['entityId' in created ? created.entityId : ''])
    expect(row?.aliases).toEqual(['Lana Zzyzx'])
  })

  it('flags, features, and adds aliases idempotently; clear removes the flag only', async () => {
    const r = await resolvePrioritySpec(db, { kind: 'person', names: ['Pualani Kekoa'] })
    const id = 'entityId' in r ? r.entityId : ''
    await markPriority(db, id, ['Pualani Kekoa', 'Kekoa, Pualani', 'Pua Kekoa'], { feature: true })
    await markPriority(db, id, ['Pualani Kekoa', 'Kekoa, Pualani'], { feature: true })
    const e = await db.one<{ aliases: string[]; attributes: Record<string, unknown> }>(`select aliases, attributes from entity where id = $1`, [id])
    expect(e?.aliases).toEqual(['Kekoa, Pualani', 'Pua Kekoa'])
    expect(e?.attributes).toMatchObject({ is_priority: true, is_featured: true })
    await clearPriority(db, id)
    const after = await db.one<{ attributes: Record<string, unknown> }>(`select attributes from entity where id = $1`, [id])
    expect(after?.attributes.is_priority).toBeUndefined()
    expect(after?.attributes.is_featured).toBe(true)
  })

  it('watches from the member\'s working team with priority-1 items and one email rule', async () => {
    const owner = 'user-priority-owner'
    const team = await createTeam(db, owner, 'Priority Team', { email: 'owner@example.org' })
    await db.query(`update app.team set plan = 'pro', subscription_status = 'active' where id = $1`, [team.id])
    const userId = await userIdForEmail(db, 'OWNER@example.org')
    expect(userId).toBe(owner)
    const ids = (await listPriorityTargets(db)).map(t => t.id)
    const w1 = await watchForTeam(db, ids, { userId: owner })
    expect(w1).toMatchObject({ teamId: team.id, added: ids.length, ruleError: null })
    expect(w1.ruleId).toBeTruthy()
    const w2 = await watchForTeam(db, ids, { userId: owner })
    expect(w2).toMatchObject({ watchlistId: w1.watchlistId, added: 0, ruleId: w1.ruleId })
    const items = await db.many<{ priority: number }>(`select priority from app.watchlist_item where watchlist_id = $1`, [w1.watchlistId])
    expect(items.every(i => i.priority === 1)).toBe(true)
    const wl = await db.one<{ name: string }>(`select name from app.watchlist where id = $1`, [w1.watchlistId])
    expect(wl?.name).toBe(PRIORITY_WATCHLIST)
  })

  it('reports when the plan has no alerts instead of failing the watch', async () => {
    const owner = 'user-priority-free'
    await createTeam(db, owner, 'Free Team', { email: 'free@example.org' })
    const ids = (await listPriorityTargets(db)).map(t => t.id)
    const w = await watchForTeam(db, ids, { userId: owner })
    expect(w.ruleId).toBeNull()
    expect(w.ruleError).toMatch(/not included/)
  })
})
