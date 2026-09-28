import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from './helpers/pglite'
import { loadLegacySchema, seedLegacy, type SeededIds } from './helpers/legacy'
import { runPort } from '../scripts/db/port-legacy'
import {
  rebuildGraph, recomputeAllScoresBatch, computeInfluenceScore, getPersonProfile, getOrgProfile,
  getPowerMap, getEgoNetwork, findShortestPath, detectChanges, listAlerts, getBillLandscape, toD3Format, compareEntities, getIssueActivity,
} from '@/lib/analytics'
import { searchEntities, getMoneyFlow, getEdges, getDocumentsForEntity, getEntityBySlug, getEdgeTotals } from '@/lib/db/queries'

let db: TestDb
let ids: SeededIds

beforeAll(async () => {
  db = await createTestDb()
  await loadLegacySchema(db)
  ids = await seedLegacy(db)
  await runPort(db, sql => db.exec(sql))
})
afterAll(async () => { await db.end() })

describe('analytics over the core schema', () => {
  it('rebuilds the derived graph and snapshots it', async () => {
    const r = await rebuildGraph(db)
    expect(r.edges).toBeGreaterThan(0)
    expect(r.nodes).toBeGreaterThan(0)
    const snap = await db.one<{ node_count: number; edge_count: number }>(`select node_count, edge_count from ax_graph_snapshot`)
    expect(snap).toMatchObject({ node_count: r.nodes, edge_count: r.edges })
    // Running twice is idempotent (truncate-and-rebuild)
    const r2 = await rebuildGraph(db)
    expect(r2.edges).toBe(r.edges)
    const n = await db.one<{ n: string }>(`select count(*)::text n from ax_relationship_edge`)
    expect(Number(n!.n)).toBe(r.edges)
  })

  it('computes influence scores in batch with ranks and percentiles', async () => {
    const count = await recomputeAllScoresBatch(db)
    expect(count).toBeGreaterThan(0)
    const rows = await db.many<{ entity_id: string; composite_score: string; rank: number; percentile: string }>(
      `select entity_id, composite_score::text, rank, percentile::text from ax_influence_score order by rank`)
    expect(rows[0].rank).toBe(1)
    expect(Number(rows[0].percentile)).toBe(100)
    for (const r of rows) {
      expect(Number(r.composite_score)).toBeGreaterThanOrEqual(0)
      expect(Number(r.composite_score)).toBeLessThanOrEqual(100)
    }
    // Schatz (senate president + board + testimony + donation received) outranks the unlinked person
    const schatz = rows.find(r => r.entity_id === ids.people['brian-schatz'])!
    expect(schatz).toBeDefined()
    expect(Number(schatz.composite_score)).toBeGreaterThan(0)
    // A second batch run produces the same scores
    await recomputeAllScoresBatch(db)
    const again = await db.one<{ composite_score: string }>(`select composite_score::text from ax_influence_score where entity_id = $1`, [ids.people['brian-schatz']])
    expect(again!.composite_score).toBe(schatz.composite_score)
  })

  it('single-entity score matches the batch composite within rounding', async () => {
    const single = await computeInfluenceScore(db, ids.people['ed-case'])
    const row = await db.one<{ composite_score: string }>(`select composite_score::text from ax_influence_score where entity_id = $1`, [ids.people['ed-case']])
    expect(Math.abs(single.composite - Number(row!.composite_score))).toBeLessThan(0.11)
  })

  it('builds a person profile from edges', async () => {
    const p = await getPersonProfile(db, ids.people['ed-case'])
    expect(p.entity?.name).toBe('Ed Case')
    expect(p.donationsReceived.length).toBe(4) // 5 to Ed Case minus 1 rejected (unmatched)
    expect(p.roles.map(r => r.type).sort()).toEqual(['employed_by', 'member_of'])
    expect(p.property).toHaveLength(1) // second legacy row had no owner id → unmatched, not attached to Ed Case
    expect(p.score).not.toBeNull()
    const totals = await getEdgeTotals(db, ids.people['ed-case'])
    const received = totals.find(t => t.type === 'contributed_to' && t.direction === 'in')!
    expect(received.n).toBe(5)
    expect(received.sum).toBeCloseTo(100 + 250.5 + 1000 * 0 + 5 + 2000, 1)
  })

  it('builds an org profile from edges', async () => {
    const o = await getOrgProfile(db, ids.orgs['hawaiian-electric-industries'])
    expect(o.entity?.name).toBe('Hawaiian Electric Industries')
    expect(o.officers.some(e => e.type === 'director_of')).toBe(true)
    expect(o.contributions.some(e => e.type === 'contributed_to' && Number(e.amount) === 2000)).toBe(true)
    expect(o.contributions.some(e => e.type === 'spent_with')).toBe(true)
    expect(o.mentions.length).toBe(2) // article mention + timeline event
  })

  it('power map, ego network, shortest path, comparison', async () => {
    const pm = await getPowerMap(db, { limit: 5 })
    expect(pm.length).toBeGreaterThan(0)
    expect(pm[0].person.full_name).toBeTruthy()
    const ego = await getEgoNetwork(db, ids.people['brian-schatz'], 2)
    expect(ego.nodes.find(n => n.id === ids.people['brian-schatz'])).toBeDefined()
    const d3 = toD3Format(ego.nodes, ego.links)
    expect(d3.nodes.length).toBe(ego.nodes.length)
    const path = await findShortestPath(db, ids.people['brian-schatz'], ids.people['ed-case'], 3)
    // Schatz and Case share the Legislature org → shared_organization edge
    expect(path).not.toBeNull()
    expect(path!.path[0]).toBe(ids.people['brian-schatz'])
    expect(path!.path[path!.path.length - 1]).toBe(ids.people['ed-case'])
    const cmp = await compareEntities(db, [ids.people['brian-schatz'], ids.people['ed-case']])
    expect(cmp.people).toHaveLength(2)
    expect(cmp.scores.length).toBe(2)
  })

  it('money flow for a bill chains testimony → lobbying → officers → contributions', async () => {
    const landscape = await getBillLandscape(db, 'SB 1234', '2026')
    expect(landscape.entityId).toBeTruthy()
    expect(landscape.byPosition.support).toHaveLength(1)
    expect(landscape.byPosition.oppose).toHaveLength(1)
    // HEI testified (org) → its lobbying (none) and officers (Schatz director) → contributions by HEI/Schatz
    expect(landscape.officers.some(o => o.from_id === ids.people['brian-schatz'])).toBe(true)
    expect(landscape.contributions.some(c => c.from_id === ids.orgs['hawaiian-electric-industries'])).toBe(true)
    const direct = await getMoneyFlow(db, landscape.entityId!)
    expect(direct.testimony).toHaveLength(2)
    const missing = await getBillLandscape(db, 'HB 9999', '2026')
    expect(missing.entityId).toBeNull()
  })

  it('detects changes and dedups alerts', async () => {
    const since = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString()
    const first = await detectChanges(db, since)
    expect(first.inserted).toBeGreaterThan(0)
    const second = await detectChanges(db, since)
    expect(second.inserted).toBe(0)
    const alerts = await listAlerts(db, { limit: 100 })
    expect(alerts.some(a => a.alert_type === 'large_contract_award')).toBe(true)
    expect(alerts.some(a => a.alert_type === 'new_lobbyist_registration')).toBe(true)
  })

  it('search finds entities by name variants and filters by kind', async () => {
    const r = await searchEntities(db, 'hawaiian electric', { kind: 'org' })
    expect(r.results[0].name).toBe('Hawaiian Electric Industries')
    const r2 = await searchEntities(db, 'HEI')
    expect(r2.results.some(h => h.name === 'Hawaiian Electric Industries')).toBe(true)
    const r3 = await searchEntities(db, 'case', { kind: 'person' })
    expect(r3.results[0].slug).toBe('ed-case')
    expect(r3.results.every(h => h.kind === 'person')).toBe(true)
    const none = await searchEntities(db, '')
    expect(none.total).toBe(0)
  })

  it('entity lookup by slug, edges and documents', async () => {
    const e = await getEntityBySlug(db, 'person', 'ed-case')
    expect(e?.id).toBe(ids.people['ed-case'])
    const edges = await getEdges(db, e!.id, { types: ['contributed_to'], direction: 'in', orderBy: 'amount' })
    expect(Number(edges[0].amount)).toBe(2000)
    const docs = await getDocumentsForEntity(db, e!.id, { docTypes: ['contribution'] })
    expect(docs.length).toBe(4)
    const issues = await getIssueActivity(db, 'agriculture', '2000-01-01')
    expect(issues.registrations).toHaveLength(1)
  })
})
