import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from './helpers/pglite'
import { loadLegacySchema, seedLegacy, type SeededIds } from './helpers/legacy'
import { runPort, reconcile, checkReconciliation, toMarkdown, type CoreCounts } from '../scripts/db/port-legacy'

let db: TestDb
let ids: SeededIds
let first: CoreCounts
let second: CoreCounts

beforeAll(async () => {
  db = await createTestDb()
  await loadLegacySchema(db)
  ids = await seedLegacy(db)
  first = (await runPort(db, sql => db.exec(sql))).inserted
  second = (await runPort(db, sql => db.exec(sql))).inserted
})
afterAll(async () => { await db.end() })

describe('legacy → core port', () => {
  it('inserts rows on the first run and zero rows on the second run', () => {
    expect(first.entity).toBeGreaterThan(0)
    expect(first.document).toBeGreaterThan(0)
    expect(first.edge).toBeGreaterThan(0)
    expect(second).toEqual({ entity: 0, document: 0, edge: 0, user_account: 0, import_cursor: 0 })
  })

  it('reconciles with zero unexplained differences', async () => {
    const rows = await reconcile(db)
    const problems = checkReconciliation(rows)
    expect(problems).toEqual([])
    const md = toMarkdown(rows, { inserted: first, secondRun: second, problems, generatedAt: 'test' })
    expect(md).toContain('| contribution |')
    expect(md).toContain('None.')
  })

  it('keeps legacy ids for people and orgs and carries identifiers/attributes', async () => {
    const heco = await db.one<{ kind: string; identifiers: Record<string, string>; attributes: Record<string, unknown>; aliases: string[] }>(
      `select kind, identifiers, attributes, aliases from entity where id = $1`, [ids.orgs['hawaiian-electric-industries']])
    expect(heco).toMatchObject({ kind: 'org' })
    expect(heco!.identifiers).toMatchObject({ ein: '99-0208097', sec_cik: '0000354707' })
    expect(heco!.attributes).toMatchObject({ slug: 'hawaiian-electric-industries', legacy_table: 'organization' })
    expect(heco!.aliases).toContain('HEI')
    const ed = await db.one<{ attributes: Record<string, unknown> }>(`select attributes from entity where id = $1`, [ids.people['ed-case']])
    expect(ed!.attributes).toMatchObject({ slug: 'ed-case', is_featured: true, entity_types: ['person', 'elected_official'] })
  })

  it('maps relationship types to the vocabulary and preserves the original', async () => {
    const rows = await db.many<{ type: string; role: string | null; attributes: Record<string, unknown> }>(
      `select e.type, e.role, e.attributes from edge e join document d on d.id = e.document_id where d.source = 'legacy_relationship' order by e.attributes ->> 'legacy_relationship_type'`)
    const byLegacy = Object.fromEntries(rows.map(r => [r.attributes.legacy_relationship_type as string, r.type]))
    expect(byLegacy).toEqual({
      former_member: 'member_of', leadership: 'officer_of', board_member: 'director_of', lobbyist_for: 'lobbied_for',
      donor_to: 'contributed_to', affiliated_with: 'member_of', counsel: 'member_of', employee: 'employed_by',
    })
    expect(rows.find(r => r.attributes.legacy_relationship_type === 'counsel')?.role).toBe('Legal representation')
  })

  it('ports contributions with amounts, dates, and status mapping', async () => {
    const rows = await db.many<{ from_id: string | null; to_id: string | null; amount: string; match_status: string; start_date: string; attributes: Record<string, unknown> }>(
      `select from_id, to_id, amount, match_status, start_date::text, attributes from edge where type = 'contributed_to' and document_id in (select id from document where source_record_id like 'contribution:%') order by amount`)
    expect(rows).toHaveLength(6)
    const sum = rows.reduce((s, r) => s + Number(r.amount), 0)
    expect(sum).toBeCloseTo(100 + 250.5 + 25 + 1000 + 5 + 2000, 2)
    const statuses = rows.map(r => r.match_status).sort()
    expect(statuses).toEqual(['matched', 'matched', 'review', 'review', 'unmatched', 'unmatched'])
    const orgDonor = rows.find(r => Number(r.amount) === 2000)!
    expect(orgDonor.from_id).toBe(ids.orgs['hawaiian-electric-industries'])
    expect(orgDonor.to_id).toBe(ids.people['ed-case'])
    const rejected = rows.find(r => Number(r.amount) === 5)!
    expect(rejected.match_status).toBe('unmatched')
    expect(rejected.attributes.legacy_match_status).toBe('rejected')
  })

  it('creates bill, docket and parcel entities deterministically and links edges', async () => {
    const bills = await db.many<{ name: string; attributes: Record<string, unknown> }>(`select name, attributes from entity where kind = 'bill' order by name`)
    expect(bills.map(b => b.attributes.measure_number)).toEqual(['HB10', 'SB1234'])
    const sb = bills.find(b => b.attributes.measure_number === 'SB1234')!
    expect(sb.attributes).toMatchObject({ session: '2026', jurisdiction: 'state' })
    const testified = await db.many<{ role: string; from_id: string | null; match_status: string }>(
      `select e.role, e.from_id, e.match_status from edge e join entity b on b.id = e.to_id where e.type = 'testified_on' and b.attributes ->> 'measure_number' = 'SB1234' order by role`)
    expect(testified.map(t => t.role)).toEqual(['oppose', 'support'])
    expect(testified.every(t => t.match_status === 'matched')).toBe(true)

    const parcels = await db.many<{ identifiers: Record<string, string> }>(`select identifiers from entity where kind = 'parcel'`)
    expect(parcels).toHaveLength(1)
    expect(parcels[0].identifiers.tmk).toBe('150010010001')
    const owns = await db.many<{ match_status: string }>(`select match_status from edge where type = 'owns'`)
    expect(owns.map(o => o.match_status).sort()).toEqual(['matched', 'review'])

    const dockets = await db.many<{ attributes: Record<string, unknown> }>(`select attributes from entity where kind = 'docket' order by name`)
    expect(dockets).toHaveLength(2)
    const party = await db.many<{ role: string }>(`select role from edge where type = 'party_to' order by role`)
    expect(party.map(p => p.role)).toEqual(['regulated_entity', 'regulator'])
  })

  it('splits contracts vs grants and resolves agencies by exact name', async () => {
    const rows = await db.many<{ type: string; from_id: string | null; to_id: string | null; match_status: string }>(
      `select type, from_id, to_id, match_status from edge where type in ('awarded_contract','awarded_grant') order by type`)
    expect(rows.map(r => r.type)).toEqual(['awarded_contract', 'awarded_grant'])
    expect(rows[0].from_id).toBe(ids.orgs['department-of-defense'])
    expect(rows[0].to_id).toBe(ids.orgs['hawaiian-dredging'])
    expect(rows[0].match_status).toBe('matched')
    expect(rows[1].match_status).toBe('unmatched')
  })

  it('turns timeline events into event documents with mentioned_in edges', async () => {
    const rows = await db.many<{ role: string; doc_type: string; body_text: string | null }>(
      `select e.role, d.doc_type, d.body_text from edge e join document d on d.id = e.document_id where d.source = 'legacy_timeline' order by role`)
    expect(rows.map(r => [r.role, r.doc_type])).toEqual([['announcement', 'event'], ['appointment', 'event']])
    expect(rows[1].body_text).toBe('Appointed by Gov.')
  })

  it('preserves data_source_record checksums and cursor state', async () => {
    const dsr = await db.many<{ checksum: string; source: string }>(`select checksum, source from document where doc_type = 'source_record' order by source`)
    expect(dsr.map(d => d.checksum)).toEqual(['b'.repeat(64), 'a'.repeat(64)])
    const cur = await db.many<{ source: string; cursor_offset: number }>(`select source, cursor_offset from import_cursor order by source`)
    expect(cur).toEqual([{ source: 'fec', cursor_offset: 0 }, { source: 'hawaii_csc', cursor_offset: 122344 }])
  })

  it('ports mapped users with tier, Stripe id, watchlist and staff flag', async () => {
    const accounts = await db.many<{ user_id: string; subscription_tier: string; subscription_status: string; stripe_customer_id: string; watch_entity_ids: string[]; is_staff: boolean }>(`select * from user_account`)
    expect(accounts).toHaveLength(1)
    expect(accounts[0]).toMatchObject({ user_id: 'neon_user_a', subscription_tier: 'professional', subscription_status: 'active', stripe_customer_id: 'cus_A', is_staff: true })
    expect(accounts[0].watch_entity_ids).toEqual([ids.people['ed-case']])
  })

  it('every edge cites a document and every document has a unique checksum', async () => {
    const orphan = await db.one<{ n: string }>(`select count(*)::text n from edge e left join document d on d.id = e.document_id where d.id is null`)
    expect(Number(orphan!.n)).toBe(0)
    const dup = await db.one<{ n: string }>(`select count(*)::text n from (select checksum from document group by checksum having count(*) > 1) x`)
    expect(Number(dup!.n)).toBe(0)
  })
})
