/**
 * Batch recompute of influence scores.
 *
 * The naive per-person recompute issues ~10 SQL round-trips per person which
 * does not scale (9 min for ~850 scored persons, and will exceed Vercel's
 * 300s maxDuration as the person count grows).
 *
 * This variant prefetches every canonical table once, builds in-memory indexes
 * keyed by person_id, and computes all six dimensions in a single pass.
 * Persons with zero signal are skipped entirely. Upserts are chunked.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { SCORE_WEIGHTS, SCORE_VERSION, TITLE_TIERS } from './score-config'
import { buildAdjacency, degreeCentrality } from '../graph/centrality'

const UPSERT_CHUNK = 500
const RANK_CHUNK = 500

function cap(x: number): number {
  return Math.max(0, Math.min(100, x))
}

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

interface DonationRow { id: string; donor_person_id: string; amount: number; recipient_person_id: string | null; election_period: string | null }
interface RelationshipRow { id: string; source_person_id: string; title: string | null; is_current: boolean | null; relationship_type: string | null; target_org_id: string | null }
interface ContractRow { id: string; vendor_org_id: string; contract_amount: number | null }
interface TestimonyRow { id: string; person_id: string; bill_number: string | null; session: string | null; hearing_date: string | null }

/**
 * Keyset-paginated full-table read. OFFSET-based pagination hits Supabase's
 * 60s statement timeout on large tables; `where id > lastId order by id limit N`
 * stays fast regardless of depth.
 *
 * `columns` MUST include `id` — we append it automatically if missing.
 */
async function fetchAll<T extends { id: string }>(
  supabase: SupabaseClient,
  table: string,
  columns: string
): Promise<T[]> {
  const PAGE = 1000
  const cols = /\bid\b/.test(columns) ? columns : `id, ${columns}`
  const out: T[] = []
  let lastId = '00000000-0000-0000-0000-000000000000'
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(cols)
      .gt('id', lastId)
      .order('id', { ascending: true })
      .limit(PAGE)
    if (error) throw new Error(`fetchAll ${table}: ${error.message}`)
    if (!data || data.length === 0) break
    out.push(...(data as unknown as T[]))
    if (data.length < PAGE) break
    lastId = (data[data.length - 1] as unknown as { id: string }).id
  }
  return out
}

export async function recomputeAllScoresBatch(supabase: SupabaseClient): Promise<number> {
  // ── 1. Active person IDs ────────────────────────────────────────────────
  const { data: people, error: peopleErr } = await supabase
    .from('person')
    .select('id, office_held')
    .eq('status', 'active')
  if (peopleErr) throw new Error(`person fetch: ${peopleErr.message}`)
  const personOffice = new Map<string, string | null>()
  for (const p of people ?? []) personOffice.set(p.id, p.office_held ?? null)

  // ── 2. Contributions ────────────────────────────────────────────────────
  const donations = await fetchAll<DonationRow>(
    supabase,
    'contribution',
    'donor_person_id, amount, recipient_person_id, election_period'
  ).then(rows => rows.filter(r => r.donor_person_id))

  const donationsByDonor = new Map<string, DonationRow[]>()
  const totalsByDonor = new Map<string, number>()
  for (const d of donations) {
    const id = d.donor_person_id
    if (!donationsByDonor.has(id)) donationsByDonor.set(id, [])
    donationsByDonor.get(id)!.push(d)
    totalsByDonor.set(id, (totalsByDonor.get(id) ?? 0) + Number(d.amount || 0))
  }
  const sortedDonationTotals = [...totalsByDonor.values()].sort((a, b) => a - b)

  // ── 3. Organization org_type (for PAC detection) ────────────────────────
  const orgs = await fetchAll<{ id: string; org_type: string | null }>(
    supabase,
    'organization',
    'id, org_type'
  )
  const orgType = new Map<string, string | null>()
  for (const o of orgs) orgType.set(o.id, o.org_type)

  // ── 4. Relationships (source_person_id not null) ───────────────────────
  const relationships = await fetchAll<RelationshipRow>(
    supabase,
    'relationship',
    'source_person_id, title, is_current, relationship_type, target_org_id'
  ).then(rows => rows.filter(r => r.source_person_id))

  const relsByPerson = new Map<string, RelationshipRow[]>()
  for (const r of relationships) {
    if (!relsByPerson.has(r.source_person_id)) relsByPerson.set(r.source_person_id, [])
    relsByPerson.get(r.source_person_id)!.push(r)
  }

  // ── 5. Lobbying ─────────────────────────────────────────────────────────
  const lobRegs = await fetchAll<{ id: string; lobbyist_person_id: string }>(
    supabase,
    'lobbyist_registration',
    'lobbyist_person_id'
  ).then(rows => rows.filter(r => r.lobbyist_person_id))
  const registeredLobbyists = new Set(lobRegs.map(r => r.lobbyist_person_id))

  const lobExps = await fetchAll<{ id: string; lobbyist_person_id: string; amount: number | null }>(
    supabase,
    'lobbyist_expenditure',
    'lobbyist_person_id, amount'
  ).then(rows => rows.filter(r => r.lobbyist_person_id))
  const lobExpByPerson = new Map<string, number>()
  for (const e of lobExps) {
    lobExpByPerson.set(e.lobbyist_person_id, (lobExpByPerson.get(e.lobbyist_person_id) ?? 0) + Number(e.amount || 0))
  }

  // ── 6. Testimony ────────────────────────────────────────────────────────
  const testimony = await fetchAll<TestimonyRow>(
    supabase,
    'legislative_testimony',
    'person_id, bill_number, session, hearing_date'
  ).then(rows => rows.filter(r => r.person_id))
  const testimonyByPerson = new Map<string, TestimonyRow[]>()
  for (const t of testimony) {
    if (!testimonyByPerson.has(t.person_id)) testimonyByPerson.set(t.person_id, [])
    testimonyByPerson.get(t.person_id)!.push(t)
  }

  // ── 7. Property ─────────────────────────────────────────────────────────
  const props = await fetchAll<{ id: string; owner_person_id: string; assessed_value: number | null }>(
    supabase,
    'property_ownership',
    'owner_person_id, assessed_value'
  ).then(rows => rows.filter(r => r.owner_person_id))
  const propSumByPerson = new Map<string, number>()
  for (const p of props) {
    propSumByPerson.set(p.owner_person_id, (propSumByPerson.get(p.owner_person_id) ?? 0) + Number(p.assessed_value || 0))
  }

  // ── 8. Government contracts by vendor org ──────────────────────────────
  const contracts = await fetchAll<ContractRow>(
    supabase,
    'government_contract',
    'vendor_org_id, contract_amount'
  ).then(rows => rows.filter(r => r.vendor_org_id))
  const contractSumByOrg = new Map<string, number>()
  for (const c of contracts) {
    contractSumByOrg.set(c.vendor_org_id, (contractSumByOrg.get(c.vendor_org_id) ?? 0) + Number(c.contract_amount || 0))
  }

  // ── 9. Article mentions ────────────────────────────────────────────────
  const mentions = await fetchAll<{ id: string; person_id: string }>(
    supabase,
    'article_entity_mention',
    'person_id'
  ).then(rows => rows.filter(r => r.person_id))
  const mentionCountByPerson = new Map<string, number>()
  for (const m of mentions) {
    mentionCountByPerson.set(m.person_id, (mentionCountByPerson.get(m.person_id) ?? 0) + 1)
  }

  // ── 10. Network centrality from ax_relationship_edge ───────────────────
  const edges = await fetchAll<{ id: string; source_person_id: string; target_person_id: string }>(
    supabase,
    'ax_relationship_edge',
    'source_person_id, target_person_id'
  ).then(rows => rows.filter(r => r.source_person_id && r.target_person_id))
  const nodeSet = new Set<string>()
  for (const e of edges) { nodeSet.add(e.source_person_id); nodeSet.add(e.target_person_id) }
  const adj = buildAdjacency(
    [...nodeSet],
    edges.map(e => ({ source: e.source_person_id, target: e.target_person_id, type: 'derived', weight: 1, value: 1 }))
  )
  const degree = degreeCentrality(adj)
  // Degree is [0,1]; scale to 0–100 for the dimension score.
  const centralityScore = new Map<string, number>()
  for (const [id, d] of degree) centralityScore.set(id, cap(d * 100))

  // ── 11. Testimony within 2y window for public visibility ───────────────
  const twoYearsAgo = new Date()
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
  const twoYearIso = twoYearsAgo.toISOString().slice(0, 10)
  const recentTestimonyByPerson = new Map<string, number>()
  for (const [pid, rows] of testimonyByPerson) {
    const count = rows.filter(r => (r.hearing_date ?? '') >= twoYearIso).length
    if (count > 0) recentTestimonyByPerson.set(pid, count)
  }

  // ── 12. Per-person compute ─────────────────────────────────────────────
  const allPersonIds = new Set<string>()
  for (const id of personOffice.keys()) allPersonIds.add(id)
  // Include any person with any signal, even if not "active"
  for (const id of totalsByDonor.keys()) allPersonIds.add(id)
  for (const id of relsByPerson.keys()) allPersonIds.add(id)
  for (const id of registeredLobbyists) allPersonIds.add(id)
  for (const id of testimonyByPerson.keys()) allPersonIds.add(id)
  for (const id of propSumByPerson.keys()) allPersonIds.add(id)
  for (const id of mentionCountByPerson.keys()) allPersonIds.add(id)
  for (const id of centralityScore.keys()) allPersonIds.add(id)

  const now = new Date().toISOString()
  const rows: Array<{
    person_id: string
    composite_score: number
    political_money_score: number
    institutional_position_score: number
    lobbying_score: number
    economic_footprint_score: number
    network_centrality_score: number
    public_visibility_score: number
    computed_at: string
    score_version: number
  }> = []

  for (const pid of allPersonIds) {
    // Skip anyone with no signal at all
    const hasAnySignal =
      totalsByDonor.has(pid) ||
      (relsByPerson.get(pid)?.length ?? 0) > 0 ||
      registeredLobbyists.has(pid) ||
      testimonyByPerson.has(pid) ||
      propSumByPerson.has(pid) ||
      mentionCountByPerson.has(pid) ||
      (centralityScore.get(pid) ?? 0) > 0 ||
      Boolean(personOffice.get(pid))
    if (!hasAnySignal) continue

    // political_money
    let pm = 0
    const given = totalsByDonor.get(pid) ?? 0
    pm = percentileRank(sortedDonationTotals, given)
    const myDonations = donationsByDonor.get(pid) ?? []
    const byPeriod = new Map<string, Set<string>>()
    for (const d of myDonations) {
      const period = d.election_period ?? 'na'
      const rec = d.recipient_person_id ?? 'none'
      if (!byPeriod.has(period)) byPeriod.set(period, new Set())
      byPeriod.get(period)!.add(rec)
    }
    if ([...byPeriod.values()].some(s => s.size >= 5)) pm += 10
    const myRels = relsByPerson.get(pid) ?? []
    const isPacOfficer = myRels.some(r =>
      ['officer', 'treasurer'].includes(r.relationship_type ?? '') &&
      r.target_org_id && orgType.get(r.target_org_id) === 'pac'
    )
    if (isPacOfficer) pm += 15
    pm = cap(pm)

    // institutional_position
    let best = 0
    const office = personOffice.get(pid)?.toLowerCase() ?? ''
    for (const [tier, score] of Object.entries(TITLE_TIERS)) {
      if (office.includes(tier)) best = Math.max(best, score)
    }
    for (const r of myRels) {
      if (r.is_current === false) continue
      const title = (r.title ?? '').toLowerCase()
      for (const [tier, score] of Object.entries(TITLE_TIERS)) {
        if (title.includes(tier)) best = Math.max(best, score)
      }
    }
    const currentRoles = myRels.filter(r => r.is_current !== false).length
    const extra = Math.min(20, Math.max(0, currentRoles - 1) * 5)
    const ip = cap(best + extra)

    // lobbying
    let lb = 0
    if (registeredLobbyists.has(pid)) {
      const total = lobExpByPerson.get(pid) ?? 0
      lb = cap(Math.log10(Math.max(1, total)) * 15)
    } else {
      const rows = testimonyByPerson.get(pid) ?? []
      lb = cap((rows.length / 20) * 100)
      const perSession = new Map<string, Set<string>>()
      for (const t of rows) {
        const key = t.session ?? 'na'
        if (!perSession.has(key)) perSession.set(key, new Set())
        if (t.bill_number) perSession.get(key)!.add(t.bill_number)
      }
      if ([...perSession.values()].some(s => s.size >= 5)) lb += 10
    }
    lb = cap(lb)

    // economic_footprint
    const propSum = propSumByPerson.get(pid) ?? 0
    const orgIdsForPerson = myRels
      .filter(r => ['officer', 'director', 'board_member'].includes(r.relationship_type ?? ''))
      .map(r => r.target_org_id)
      .filter((x): x is string => Boolean(x))
    let contractSum = 0
    for (const oid of orgIdsForPerson) contractSum += contractSumByOrg.get(oid) ?? 0
    const propScore = propSum > 0 ? cap(Math.log10(propSum) * 10) : 0
    const contractScore = contractSum > 0 ? cap(Math.log10(contractSum) * 10) : 0
    const ef = cap(propScore * 0.5 + contractScore * 0.5)

    // network_centrality (precomputed)
    const nc = centralityScore.get(pid) ?? 0

    // public_visibility
    const mCount = mentionCountByPerson.get(pid) ?? 0
    const tCount = recentTestimonyByPerson.get(pid) ?? 0
    const news = cap((mCount / 50) * 100)
    const tScore = cap((tCount / 20) * 100)
    const pv = cap(news * 0.6 + tScore * 0.4)

    const composite = cap(
      pm * SCORE_WEIGHTS.political_money +
      ip * SCORE_WEIGHTS.institutional_position +
      lb * SCORE_WEIGHTS.lobbying +
      ef * SCORE_WEIGHTS.economic_footprint +
      nc * SCORE_WEIGHTS.network_centrality +
      pv * SCORE_WEIGHTS.public_visibility
    )

    rows.push({
      person_id: pid,
      composite_score: Math.round(composite * 10) / 10,
      political_money_score: Math.round(pm * 10) / 10,
      institutional_position_score: Math.round(ip * 10) / 10,
      lobbying_score: Math.round(lb * 10) / 10,
      economic_footprint_score: Math.round(ef * 10) / 10,
      network_centrality_score: Math.round(nc * 10) / 10,
      public_visibility_score: Math.round(pv * 10) / 10,
      computed_at: now,
      score_version: SCORE_VERSION,
    })
  }

  // ── 13. Bulk upsert in chunks ──────────────────────────────────────────
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK)
    const { error } = await supabase
      .from('ax_influence_score')
      .upsert(chunk, { onConflict: 'person_id' })
    if (error) throw new Error(`ax_influence_score upsert: ${error.message}`)
  }

  // ── 14. Rank & percentile ──────────────────────────────────────────────
  const sorted = [...rows].sort((a, b) => b.composite_score - a.composite_score)
  const updates = sorted.map((r, idx) => ({
    person_id: r.person_id,
    rank: idx + 1,
    percentile: Math.round(((sorted.length - idx) / sorted.length) * 10000) / 100,
    // carry through required columns so upsert doesn't null them
    composite_score: r.composite_score,
    political_money_score: r.political_money_score,
    institutional_position_score: r.institutional_position_score,
    lobbying_score: r.lobbying_score,
    economic_footprint_score: r.economic_footprint_score,
    network_centrality_score: r.network_centrality_score,
    public_visibility_score: r.public_visibility_score,
    computed_at: now,
    score_version: SCORE_VERSION,
  }))
  for (let i = 0; i < updates.length; i += RANK_CHUNK) {
    const chunk = updates.slice(i, i + RANK_CHUNK)
    const { error } = await supabase
      .from('ax_influence_score')
      .upsert(chunk, { onConflict: 'person_id' })
    if (error) throw new Error(`ax_influence_score rank upsert: ${error.message}`)
  }

  return rows.length
}
