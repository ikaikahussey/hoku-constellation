/**
 * Batch recompute of influence scores over the core schema.
 *
 * Prefetches the edge table once per type family, builds in-memory indexes keyed by entity id, and
 * computes all six dimensions in a single pass. Persons with zero signal are skipped. Upserts are chunked.
 */
import type { Db } from '@/lib/db/types'
import { SCORE_WEIGHTS, SCORE_VERSION, TITLE_TIERS } from './score-config'
import { buildAdjacency, degreeCentrality } from '../graph/centrality'

const UPSERT_CHUNK = 500

function cap(x: number): number { return Math.max(0, Math.min(100, x)) }

function percentileRank(sorted: number[], value: number): number {
  if (sorted.length === 0) return 0
  let lo = 0, hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid] < value) lo = mid + 1
    else hi = mid
  }
  return (lo / sorted.length) * 100
}

interface EdgeLite { from_id: string | null; to_id: string | null; type: string; role: string | null; amount: string | null; start_date: string | null; end_date: string | null; attributes: Record<string, unknown> }

const POSITION_TYPES = ['employed_by', 'officer_of', 'director_of', 'member_of', 'appointed_to']

async function fetchEdges(db: Db, types: string[]): Promise<EdgeLite[]> {
  // Keyset pagination by id keeps each statement short on large tables.
  const PAGE = 5000
  const out: EdgeLite[] = []
  let lastId = '00000000-0000-0000-0000-000000000000'
  for (;;) {
    const rows = await db.many<EdgeLite & { id: string }>(
      `select id, from_id, to_id, type, role, amount::text, start_date::text, end_date::text, attributes
         from edge where type = any($1) and id > $2 order by id limit $3`, [types, lastId, PAGE])
    out.push(...rows)
    if (rows.length < PAGE) break
    lastId = rows[rows.length - 1].id
  }
  return out
}

export interface ScoreRowInsert {
  entity_id: string
  composite_score: number
  political_money_score: number
  institutional_position_score: number
  lobbying_score: number
  economic_footprint_score: number
  network_centrality_score: number
  public_visibility_score: number
  rank?: number
  percentile?: number
}

/** Compute scores for every person entity with any signal (pure part; no writes). */
export async function computeAllScores(db: Db): Promise<ScoreRowInsert[]> {
  // ── 1. Persons ────────────────────────────────────────────────────────────
  const people = await db.many<{ id: string; office_held: string | null; status: string | null }>(
    `select id, attributes ->> 'office_held' office_held, attributes ->> 'status' status from entity where kind = 'person' and merged_into_id is null`)
  const personOffice = new Map<string, string | null>()
  const personIds = new Set<string>()
  for (const p of people) { personOffice.set(p.id, p.office_held); personIds.add(p.id) }

  // ── 2. Org types (PAC detection) ──────────────────────────────────────────
  const orgs = await db.many<{ id: string; org_type: string | null }>(`select id, attributes ->> 'org_type' org_type from entity where kind = 'org'`)
  const orgType = new Map(orgs.map(o => [o.id, o.org_type]))

  // ── 3. Contributions ──────────────────────────────────────────────────────
  const donations = (await fetchEdges(db, ['contributed_to'])).filter(e => e.from_id)
  const donationsByDonor = new Map<string, EdgeLite[]>()
  const totalsByDonor = new Map<string, number>()
  for (const d of donations) {
    const id = d.from_id!
    if (!donationsByDonor.has(id)) donationsByDonor.set(id, [])
    donationsByDonor.get(id)!.push(d)
    totalsByDonor.set(id, (totalsByDonor.get(id) ?? 0) + Number(d.amount || 0))
  }
  const sortedDonationTotals = [...totalsByDonor.values()].sort((a, b) => a - b)

  // ── 4. Positions ──────────────────────────────────────────────────────────
  const positions = (await fetchEdges(db, POSITION_TYPES)).filter(e => e.from_id && personIds.has(e.from_id))
  const relsByPerson = new Map<string, EdgeLite[]>()
  for (const r of positions) {
    if (!relsByPerson.has(r.from_id!)) relsByPerson.set(r.from_id!, [])
    relsByPerson.get(r.from_id!)!.push(r)
  }
  const isCurrent = (e: EdgeLite) => e.attributes?.is_current !== false && !e.end_date

  // ── 5. Lobbying ───────────────────────────────────────────────────────────
  const lobRegs = (await fetchEdges(db, ['lobbied_for'])).filter(e => e.from_id && personIds.has(e.from_id))
  const registeredLobbyists = new Set(lobRegs.map(r => r.from_id!))
  const lobExps = (await fetchEdges(db, ['spent_with'])).filter(e => e.from_id && personIds.has(e.from_id))
  const lobExpByPerson = new Map<string, number>()
  for (const e of lobExps) lobExpByPerson.set(e.from_id!, (lobExpByPerson.get(e.from_id!) ?? 0) + Number(e.amount || 0))

  // ── 6. Testimony ──────────────────────────────────────────────────────────
  const testimony = (await fetchEdges(db, ['testified_on'])).filter(e => e.from_id && personIds.has(e.from_id))
  const testimonyByPerson = new Map<string, EdgeLite[]>()
  for (const t of testimony) {
    if (!testimonyByPerson.has(t.from_id!)) testimonyByPerson.set(t.from_id!, [])
    testimonyByPerson.get(t.from_id!)!.push(t)
  }

  // ── 7. Property ───────────────────────────────────────────────────────────
  const props = (await fetchEdges(db, ['owns'])).filter(e => e.from_id && personIds.has(e.from_id))
  const propSumByPerson = new Map<string, number>()
  for (const p of props) propSumByPerson.set(p.from_id!, (propSumByPerson.get(p.from_id!) ?? 0) + Number((p.attributes?.assessed_value as number) || 0))

  // ── 8. Contracts by vendor org ────────────────────────────────────────────
  const contracts = (await fetchEdges(db, ['awarded_contract', 'awarded_grant'])).filter(e => e.to_id)
  const contractSumByOrg = new Map<string, number>()
  for (const c of contracts) contractSumByOrg.set(c.to_id!, (contractSumByOrg.get(c.to_id!) ?? 0) + Number(c.amount || 0))

  // ── 9. Mentions ───────────────────────────────────────────────────────────
  const mentions = (await fetchEdges(db, ['mentioned_in'])).filter(e => e.from_id && personIds.has(e.from_id) && e.role !== 'event')
  const mentionCountByPerson = new Map<string, number>()
  for (const m of mentions) mentionCountByPerson.set(m.from_id!, (mentionCountByPerson.get(m.from_id!) ?? 0) + 1)

  // ── 10. Network centrality from ax_relationship_edge ──────────────────────
  const dEdges = await db.many<{ source_entity_id: string; target_entity_id: string }>(`select source_entity_id, target_entity_id from ax_relationship_edge`)
  const nodeSet = new Set<string>()
  for (const e of dEdges) { nodeSet.add(e.source_entity_id); nodeSet.add(e.target_entity_id) }
  const adj = buildAdjacency([...nodeSet], dEdges.map(e => ({ source: e.source_entity_id, target: e.target_entity_id, type: 'derived', value: 1 })))
  const degree = degreeCentrality(adj)
  const centralityScore = new Map<string, number>()
  for (const [id, d] of degree) centralityScore.set(id, cap(d * 100))
  // Preserve betweenness/eigen centrality already stored by rebuild-graph, if present.
  const stored = await db.many<{ entity_id: string; network_centrality_score: string }>(`select entity_id, network_centrality_score::text from ax_influence_score`)
  const storedCentrality = new Map(stored.map(s => [s.entity_id, Number(s.network_centrality_score)]))

  // ── 11. Recent testimony window ───────────────────────────────────────────
  const twoYearsAgo = new Date(); twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
  const twoYearIso = twoYearsAgo.toISOString().slice(0, 10)
  const recentTestimonyByPerson = new Map<string, number>()
  for (const [pid, rows] of testimonyByPerson) {
    const n = rows.filter(r => (r.start_date ?? '') >= twoYearIso).length
    if (n > 0) recentTestimonyByPerson.set(pid, n)
  }

  // ── 12. Per-person compute ────────────────────────────────────────────────
  const rows: ScoreRowInsert[] = []
  for (const pid of personIds) {
    const hasAnySignal =
      totalsByDonor.has(pid) || (relsByPerson.get(pid)?.length ?? 0) > 0 || registeredLobbyists.has(pid) ||
      testimonyByPerson.has(pid) || propSumByPerson.has(pid) || mentionCountByPerson.has(pid) ||
      (centralityScore.get(pid) ?? 0) > 0 || Boolean(personOffice.get(pid))
    if (!hasAnySignal) continue

    // political_money
    let pm = percentileRank(sortedDonationTotals, totalsByDonor.get(pid) ?? 0)
    const byPeriod = new Map<string, Set<string>>()
    for (const d of donationsByDonor.get(pid) ?? []) {
      const period = (d.attributes?.election_period as string) ?? 'na'
      if (!byPeriod.has(period)) byPeriod.set(period, new Set())
      byPeriod.get(period)!.add(d.to_id ?? 'none')
    }
    if ([...byPeriod.values()].some(s => s.size >= 5)) pm += 10
    const myRels = relsByPerson.get(pid) ?? []
    if (myRels.some(r => r.type === 'officer_of' && r.to_id && orgType.get(r.to_id) === 'pac')) pm += 15
    pm = cap(pm)

    // institutional_position
    let best = 0
    const office = (personOffice.get(pid) ?? '').toLowerCase()
    for (const [tier, score] of Object.entries(TITLE_TIERS)) if (office.includes(tier)) best = Math.max(best, score)
    for (const r of myRels) {
      if (!isCurrent(r)) continue
      const title = (r.role ?? '').toLowerCase()
      for (const [tier, score] of Object.entries(TITLE_TIERS)) if (title.includes(tier)) best = Math.max(best, score)
    }
    const currentRoles = myRels.filter(isCurrent).length
    const ip = cap(best + Math.min(20, Math.max(0, currentRoles - 1) * 5))

    // lobbying
    let lb = 0
    if (registeredLobbyists.has(pid)) {
      lb = cap(Math.log10(Math.max(1, lobExpByPerson.get(pid) ?? 0)) * 15)
    } else {
      const t = testimonyByPerson.get(pid) ?? []
      lb = cap((t.length / 20) * 100)
      const perSession = new Map<string, Set<string>>()
      for (const e of t) {
        const key = (e.attributes?.session as string) ?? 'na'
        if (!perSession.has(key)) perSession.set(key, new Set())
        if (e.to_id) perSession.get(key)!.add(e.to_id)
      }
      if ([...perSession.values()].some(s => s.size >= 5)) lb += 10
    }
    lb = cap(lb)

    // economic_footprint
    const propSum = propSumByPerson.get(pid) ?? 0
    let contractSum = 0
    for (const r of myRels) {
      if (['officer_of', 'director_of'].includes(r.type) && r.to_id) contractSum += contractSumByOrg.get(r.to_id) ?? 0
    }
    const propScore = propSum > 0 ? cap(Math.log10(propSum) * 10) : 0
    const contractScore = contractSum > 0 ? cap(Math.log10(contractSum) * 10) : 0
    const ef = cap(propScore * 0.5 + contractScore * 0.5)

    // network_centrality: prefer the richer stored value from rebuild-graph, else degree
    const nc = storedCentrality.get(pid) ?? centralityScore.get(pid) ?? 0

    // public_visibility
    const news = cap(((mentionCountByPerson.get(pid) ?? 0) / 50) * 100)
    const tScore = cap(((recentTestimonyByPerson.get(pid) ?? 0) / 20) * 100)
    const pv = cap(news * 0.6 + tScore * 0.4)

    const composite = cap(
      pm * SCORE_WEIGHTS.political_money + ip * SCORE_WEIGHTS.institutional_position + lb * SCORE_WEIGHTS.lobbying +
      ef * SCORE_WEIGHTS.economic_footprint + nc * SCORE_WEIGHTS.network_centrality + pv * SCORE_WEIGHTS.public_visibility)

    const r1 = (x: number) => Math.round(x * 10) / 10
    rows.push({
      entity_id: pid, composite_score: r1(composite), political_money_score: r1(pm), institutional_position_score: r1(ip),
      lobbying_score: r1(lb), economic_footprint_score: r1(ef), network_centrality_score: r1(nc), public_visibility_score: r1(pv),
    })
  }

  // rank & percentile
  rows.sort((a, b) => b.composite_score - a.composite_score)
  rows.forEach((r, idx) => {
    r.rank = idx + 1
    r.percentile = Math.round(((rows.length - idx) / rows.length) * 10000) / 100
  })
  return rows
}

/** Compute and upsert ax_influence_score for all persons. Returns the number scored. */
export async function recomputeAllScoresBatch(db: Db): Promise<number> {
  const rows = await computeAllScores(db)
  const now = new Date().toISOString()
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK)
    await db.query(
      `insert into ax_influence_score(entity_id, composite_score, political_money_score, institutional_position_score, lobbying_score,
                                      economic_footprint_score, network_centrality_score, public_visibility_score, rank, percentile, computed_at, score_version)
       select * from unnest($1::uuid[], $2::numeric[], $3::numeric[], $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[], $8::numeric[], $9::int[], $10::numeric[], $11::timestamptz[], $12::int[])
       on conflict (entity_id) do update set
         composite_score = excluded.composite_score, political_money_score = excluded.political_money_score,
         institutional_position_score = excluded.institutional_position_score, lobbying_score = excluded.lobbying_score,
         economic_footprint_score = excluded.economic_footprint_score, network_centrality_score = excluded.network_centrality_score,
         public_visibility_score = excluded.public_visibility_score, rank = excluded.rank, percentile = excluded.percentile,
         computed_at = excluded.computed_at, score_version = excluded.score_version`,
      [chunk.map(r => r.entity_id), chunk.map(r => r.composite_score), chunk.map(r => r.political_money_score), chunk.map(r => r.institutional_position_score),
        chunk.map(r => r.lobbying_score), chunk.map(r => r.economic_footprint_score), chunk.map(r => r.network_centrality_score), chunk.map(r => r.public_visibility_score),
        chunk.map(r => r.rank!), chunk.map(r => r.percentile!), chunk.map(() => now), chunk.map(() => SCORE_VERSION)])
  }
  return rows.length
}
